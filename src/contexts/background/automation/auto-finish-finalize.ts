import type { AutoFinishFailure, AutoFinishLastRun, AutoFinishMarketResult, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import { UNKNOWN_RESET } from '../../../application/auto-job/completion.js';
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
    readonly completedJobs: Readonly<Record<string, string>>;
    readonly nextRetryAt: number | null;
    readonly retryReason: string | null;
    readonly result: AutoFinishRunResult;
}

/** Persists the run report, emits the done event and schedules the retry. */
export async function finalizeAutoFinish(
    deps: FinalizeAutoFinishDeps,
    input: FinalizeAutoFinishInput,
): Promise<FinalizedAutoFinish> {
    const completedMarketResets = { ...input.completedResets };
    const completedJobResets = { ...input.completedJobs };
    for (const market of input.markets) {
        const resetAt = market.resetAt ?? UNKNOWN_RESET;
        if (market.ok && market.resetAt) {
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
        for (const job of market.jobs ?? []) {
            if (job.status === 'done') completedJobResets[job.jobId] = resetAt;
        }
    }
    const now = deps.now();
    for (const [jobId, resetAt] of Object.entries(completedJobResets)) {
        if (resetAt === UNKNOWN_RESET) continue;
        const resetTime = Date.parse(resetAt);
        if (!Number.isFinite(resetTime) || resetTime <= now) delete completedJobResets[jobId];
    }
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
    await deps.store.set({ last, completedResets: completedMarketResets, completedJobs: completedJobResets });
    deps.onPersisted?.(last, completedMarketResets, completedJobResets);
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
    return { last, completedResets: completedMarketResets, completedJobs: completedJobResets, nextRetryAt, retryReason, result };
}
