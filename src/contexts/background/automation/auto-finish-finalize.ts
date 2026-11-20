import type { AutoFinishFailure, AutoFinishLastRun, AutoFinishMarketResult, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import { UNKNOWN_RESET } from '../../../application/auto-job/completion.js';
import { CompletionRecordWriter } from '../../../application/auto-job/completion-record.js';
import type { MarketCompletionStorePort } from '../../../application/auto-job/market-completion.js';
import { EMPTY_MARKET_COMPLETED_JOBS, type MarketCompletedJobsState } from '../../../contracts/market-completed-jobs.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import type { AutoFinishStateStore } from '../../../infrastructure/storage/auto-finish-state-store.js';
import type { EventPublisher, RunLogSink, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import { AUTO_FINISH_RETRY_ALARM } from './alarm-ids.js';
import type { AutoJobsSink } from './auto-finish-types.js';
import { computeAutoFinishRetry } from './auto-finish-retry.js';

export interface FinalizeAutoFinishDeps {
    readonly store: AutoFinishStateStore;
    readonly completions: MarketCompletionStorePort;
    readonly events: EventPublisher;
    readonly runLogs: RunLogSink;
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly autoJobs: AutoJobsSink;
    readonly now: () => number;
    readonly onPersisted?: (
        last: AutoFinishLastRun,
        completedResets: Readonly<Record<string, string>>,
        completedJobs: Readonly<Record<string, string>>,
        completedJobsByMarket: MarketCompletedJobsState,
        completionStateAvailable: boolean,
    ) => void;
}

export interface FinalizeAutoFinishInput {
    readonly runId: string;
    readonly owner: string;
    readonly syncedJobs: number;
    readonly markets: readonly AutoFinishMarketResult[];
    readonly failures: readonly AutoFinishFailure[];
    readonly retryEntries: readonly AutoJobQueueFailure[];
    readonly retryFailuresForSchedule: readonly AutoFinishFailure[];
    readonly completedResets: Readonly<Record<string, string>>;
    /** Legacy jobId-only map. Preserved verbatim; never written from this path. */
    readonly completedJobs: Readonly<Record<string, string>>;
    readonly runDoneCount: number;
    readonly runnableCount: number;
    readonly totalRetry: number;
    readonly totalSkipped: number;
    readonly totalExpired: number;
    readonly stopped: boolean;
    readonly currentSettings: SettingsV1;
    readonly cancelRequested: () => boolean;
    /**
     * Skip the auto-dismiss scan. Used by the "nothing runnable" report pass,
     * which must not send extra market traffic.
     */
    readonly dismiss?: boolean;
}

export interface FinalizedAutoFinish {
    readonly last: AutoFinishLastRun;
    readonly completedResets: Readonly<Record<string, string>>;
    /** Legacy map, unchanged from the input. */
    readonly completedJobs: Readonly<Record<string, string>>;
    readonly completedJobsByMarket: MarketCompletedJobsState;
    readonly completionWriteFailures: number;
    /** False when the sidecar could not be read; state must not be treated as empty. */
    readonly completionStateAvailable: boolean;
    readonly nextRetryAt: number | null;
    readonly retryReason: string | null;
    readonly result: AutoFinishRunResult;
}

interface CompletionWriteOutcome {
    readonly state: MarketCompletedJobsState;
    readonly failures: number;
    readonly available: boolean;
}

function updateLocalCompletion(
    state: MarketCompletedJobsState,
    marketKey: string,
    jobId: string,
    resetAt: string,
): MarketCompletedJobsState {
    const existing = state.byMarket[marketKey];
    return {
        byMarket: {
            ...state.byMarket,
            [marketKey]: {
                ...existing,
                [jobId]: resetAt,
            },
        },
    };
}

/**
 * Writes done jobs to the market-scoped sidecar only. Legacy completedJobs is
 * preserved by the caller and never updated here.
 */
async function writeMarketCompletions(
    deps: FinalizeAutoFinishDeps,
    input: FinalizeAutoFinishInput,
): Promise<CompletionWriteOutcome> {
    let state: MarketCompletedJobsState = EMPTY_MARKET_COMPLETED_JOBS;
    let stateKnown = false;
    try {
        state = await deps.completions.getState();
        stateKnown = true;
    } catch (error) {
        deps.runLogs.add(input.runId, 'warn', 'completion', `Unable to read market-scoped completions: ${error instanceof Error ? error.message : String(error)}`);
        // Unavailable is not empty: skip all writes and keep the coordinator's
        // previous cache instead of claiming a clean state.
        return { state, failures: 0, available: false };
    }

    const writer = new CompletionRecordWriter(deps.completions);
    let failures = 0;
    let written = 0;
    let already = 0;
    let skipped = 0;

    for (const market of input.markets) {
        if (!market.ok || market.stale === true) continue;
        const resetAt = market.resetAt;
        const doneJobs = (market.jobs ?? []).filter((job) => job.status === 'done');
        if (doneJobs.length === 0) continue;
        if (!resetAt || resetAt === UNKNOWN_RESET) {
            skipped += doneJobs.length;
            deps.runLogs.add(input.runId, 'warn', 'completion',
                `Skipped ${doneJobs.length} completion record(s) for ${market.marketKey}: reset is unknown`);
            continue;
        }

        for (const job of doneJobs) {
            let attempt = 0;
            let recorded = false;
            while (attempt < 3 && !recorded) {
                attempt += 1;
                const current = stateKnown
                    ? state.byMarket[market.marketKey]?.[job.jobId]
                    : undefined;
                let expected: string | null | undefined;
                if (stateKnown) {
                    if (current === resetAt) {
                        state = updateLocalCompletion(state, market.marketKey, job.jobId, resetAt);
                        already += 1;
                        recorded = true;
                        break;
                    }
                    if (current !== undefined) {
                        const currentTime = Date.parse(current);
                        const nextTime = Date.parse(resetAt);
                        if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime) || nextTime < currentTime) {
                            skipped += 1;
                            deps.runLogs.add(input.runId, 'warn', 'completion',
                                `Skipped completion write for ${market.marketKey}/${job.jobId}: existing reset ${current} is not older than ${resetAt}`);
                            recorded = true;
                            break;
                        }
                        expected = current;
                    } else {
                        expected = null;
                    }
                }

                const result = await writer.record({
                    marketKey: market.marketKey,
                    jobId: job.jobId,
                    resetAt,
                    ...(expected !== undefined ? { expectedExistingResetAt: expected } : {}),
                });
                if (result.ok) {
                    state = updateLocalCompletion(state, market.marketKey, job.jobId, resetAt);
                    if (result.value.status === 'written') written += 1;
                    else already += 1;
                    recorded = true;
                    break;
                }
                if (result.error.code === 'COMPLETION_RESET_MISMATCH' && attempt < 3) {
                    // Another writer advanced the record. Re-read and evaluate
                    // against the latest state instead of overwriting blindly.
                    try {
                        state = await deps.completions.getState();
                        stateKnown = true;
                        continue;
                    } catch (error) {
                        deps.runLogs.add(input.runId, 'warn', 'completion',
                            `Unable to re-read market completions for ${market.marketKey}/${job.jobId}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
                failures += 1;
                deps.runLogs.add(input.runId, 'warn', 'completion',
                    `Failed to record completion for ${market.marketKey}/${job.jobId}: ${result.error.code} ${result.error.message}`);
                recorded = true;
            }
        }
    }

    try {
        state = await deps.completions.getState();
    } catch {
        // Keep the in-memory result; the failure was already logged above when
        // the initial read failed. The run report still persists.
    }
    if (written + already + skipped + failures > 0) {
        deps.runLogs.add(input.runId, 'info', 'completion',
            `Completion records: ${written} written, ${already} already recorded, ${skipped} skipped, ${failures} failed`);
    }
    return { state, failures, available: true };
}

/** Persists the run report, sidecar completions, emits the done event and schedules the retry. */
export async function finalizeAutoFinish(
    deps: FinalizeAutoFinishDeps,
    input: FinalizeAutoFinishInput,
): Promise<FinalizedAutoFinish> {
    const completedMarketResets = { ...input.completedResets };
    for (const market of input.markets) {
        if (!market.ok || !market.resetAt) continue;
        const total = market.jobTotal ?? 0;
        const success = market.success ?? 0;
        // Do not mark a market complete just because every remaining job was
        // skipped/expired/retrying: that would hide newly claimable work in
        // the same market reset until the next reset. A zero-job market is not
        // complete either; new jobs can appear later in the same reset.
        if (total > 0 && (market.pending ?? 0) === 0 && (market.failed ?? 0) === 0 && (market.retry ?? 0) === 0 && success === total) {
            completedMarketResets[market.marketKey] = market.resetAt;
        }
    }

    const completionWrite = await writeMarketCompletions(deps, input);
    const last: AutoFinishLastRun = {
        runId: input.runId,
        finishedAt: deps.now(),
        jobs: input.syncedJobs,
        done: input.runDoneCount,
        retry: input.totalRetry,
        skipped: input.totalSkipped,
        expired: input.totalExpired,
        failed: input.failures.length,
        stopped: input.stopped,
        markets: [...input.markets],
        failures: [...input.failures],
    };
    // Legacy completedJobs is intentionally preserved verbatim. The sidecar is
    // the authoritative completion record for the new automation path.
    await deps.store.set({
        last,
        completedResets: completedMarketResets,
        completedJobs: input.completedJobs,
    });
    deps.onPersisted?.(last, completedMarketResets, input.completedJobs, completionWrite.state, completionWrite.available);
    deps.events.publish('auto.jobs.done', last);
    if (input.dismiss !== false && input.currentSettings.autoDismissFailedJobsEnabled && !input.stopped) {
        try {
            // Only dismiss jobs the game reports as failed/expired. A job
            // that failed inside the extension (minigame lock, timeout,
            // conditions) may still be completable manually, so it must not
            // be sent to dismiss.
            // Do not dismiss jobs the extension skipped for a capability or
            // selection reason; those are still completable manually.
            const skippedIds = new Set<string>();
            for (const market of input.markets) {
                for (const job of market.jobs ?? []) {
                    if (job.status === 'skipped') skippedIds.add(job.jobId);
                }
            }
            const remaining = await deps.autoJobs.dismissFailedJobs(
                input.owner,
                'auto-dismiss',
                undefined,
                input.cancelRequested,
                input.runId,
                skippedIds,
            );
            deps.runLogs.add(input.runId, 'info', 'dismiss-failed',
                `Auto dismiss complete: ${remaining.dismissed} dismissed, ${remaining.failed} failed${remaining.errors.length ? `, ${remaining.errors.length} market error(s)` : ''}`);
        } catch (error) {
            deps.runLogs.add(input.runId, 'error', 'dismiss-failed', `Auto dismiss crashed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    let nextRetryAt: number | null = null;
    let retryReason: string | null = null;
    if (!input.stopped) {
        const maintenanceFailure = input.retryEntries.some((entry) =>
            entry.error?.code === 'ROUTE_FAILED'
            || /maintenance|unreachable|no route/i.test(entry.error?.message ?? ''),
        );
        const decision = await computeAutoFinishRetry(deps.settings, deps.snapshots, deps.now(), input.retryFailuresForSchedule, maintenanceFailure);
        if (decision) {
            nextRetryAt = decision.at;
            retryReason = decision.reason;
            deps.scheduler.create(AUTO_FINISH_RETRY_ALARM, { when: nextRetryAt });
        }
    }
    const result: AutoFinishRunResult = {
        jobs: input.syncedJobs,
        done: input.runDoneCount,
        retry: input.totalRetry,
        skipped: input.totalSkipped,
        expired: input.totalExpired,
        failed: input.failures.length,
        stopped: input.stopped,
        markets: [...input.markets],
        failures: [...input.failures],
    };
    return {
        last,
        completedResets: completedMarketResets,
        completedJobs: input.completedJobs,
        completedJobsByMarket: completionWrite.state,
        completionWriteFailures: completionWrite.failures,
        completionStateAvailable: completionWrite.available,
        nextRetryAt,
        retryReason,
        result,
    };
}
