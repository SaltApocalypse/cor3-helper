import type { AutoFinishFailure, AutoFinishJobResult, AutoFinishLastRun, AutoFinishMarketResult, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import type { AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import { isServerlessJob, type JobOffer } from '../../../domains/jobs/model.js';
import { JOB_MARKETS, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { classifyJobFailure, type JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobProgress } from '../../../application/auto-job/queue.js';
import { AUTO_FINISH_RETRY_ALARM } from './alarm-ids.js';
import { buildFinalMarkets, buildLiveMarkets, recalcLiveMarkets } from './auto-finish-view.js';
import { runDeferredRetryPass } from './auto-finish-deferred.js';
import { logAutoFinishJobs } from './auto-finish-log.js';
import { finalizeAutoFinish } from './auto-finish-finalize.js';
import { humanDelay as defaultHumanDelay } from './delay.js';
import { failureOf, jobLocation, outcomeInputOf, countsAgainstRetryBudget } from './job-outcome.js';
import { resolveAutoFinishRunState, shouldUsePrefetched, type AutoFinishRunOptions } from './auto-finish-options.js';
import { isCompletedForReset } from '../../../application/auto-job/completion.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { buildServerPriority } from './server-priority.js';
import type { AutoFinishDeps, AutoFinishLiveRun, AutoFinishStatus, AutoJobsSink } from './auto-finish-types.js';

export type { AutoFinishDeps, AutoFinishLiveRun, AutoFinishStatus, AutoJobsSink } from './auto-finish-types.js';

/** Claim-only jobs may use a short-lived snapshot when their market failed. */
const CLAIM_ONLY_CACHE_MAX_AGE_MS = 5 * 60_000;

export class AutoFinishCoordinator {
    private running = false;
    private last: AutoFinishLastRun | null = null;
    private nextRetryAt: number | null = null;
    private retryReason: string | null = null;
    private live: AutoFinishLiveRun | null = null;
    private progress: AutoJobProgress | null = null;
    private completedResets: Readonly<Record<string, string>> = {};
    private completedJobs: Readonly<Record<string, string>> = {};
    private cancelRequested = false;
    private autoJobs: AutoJobsSink | null = null;
    private readonly humanDelay: (minMs?: number, maxMs?: number) => Promise<void>;

    constructor(private readonly deps: AutoFinishDeps) {
        this.humanDelay = deps.humanDelay ?? defaultHumanDelay;
    }

    attachAutoJobs(sink: AutoJobsSink): void {
        this.autoJobs = sink;
    }

    isRunning(): boolean {
        return this.running;
    }

    isCancelRequested(): boolean {
        return this.cancelRequested;
    }

    lastRun(): AutoFinishLastRun | null {
        return this.last;
    }

    completedResetsSnapshot(): Readonly<Record<string, string>> {
        return this.completedResets;
    }

    completedJobsSnapshot(): Readonly<Record<string, string>> {
        return this.completedJobs;
    }

    progressValue(): AutoJobProgress | null {
        return this.progress;
    }

    requestCancel(): void {
        if (this.running) this.cancelRequested = true;
    }

    async restore(): Promise<void> {
        const state = await this.deps.store.get();
        this.last = state.last;
        this.completedResets = state.completedResets;
        this.completedJobs = state.completedJobs;
        await this.scheduleNextRefresh();
    }

    async status(): Promise<AutoFinishStatus> {
        const current = await this.deps.settings.get();
        return {
            enabled: current.autoFinishEnabled,
            running: this.running,
            currentRunId: this.live?.runId ?? null,
            live: this.live,
            last: this.last,
            progress: this.progress,
            nextRetryAt: this.nextRetryAt,
            retryReason: this.retryReason,
            completedJobs: this.completedJobs,
        };
    }

    async enable(): Promise<SettingsV1> {
        return this.deps.settings.update({ autoFinishEnabled: true });
    }

    async disable(): Promise<SettingsV1> {
        this.requestCancel();
        const next = await this.deps.settings.update({ autoFinishEnabled: false });
        await this.deps.scheduler.clear(AUTO_FINISH_RETRY_ALARM);
        void this.scheduleNextRefresh();
        return next;
    }

    async cancel(): Promise<void> {
        this.requestCancel();
    }

    async runExclusive(owner: string, options: AutoFinishRunOptions = {}): Promise<{ readonly ok: true; readonly value: AutoFinishRunResult } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
        const helperMode = (await this.deps.settings.get()).helperMode;
        if (helperMode) return { ok: false, error: { code: 'HELPER_MODE', message: 'Disable Helper Mode in Settings before starting automation' } };
        const result = await this.deps.networkOps.enqueue({ owner, reason: 'auto-jobs', priority: options.forceRefresh ? 80 : 50 }, async () => {
            const finished = await this.run(owner, options);
            if ('busy' in finished) {
                return { ok: false as const, error: { code: 'AUTO_FINISH_BUSY', message: 'Auto Finish is already running' } };
            }
            return { ok: true as const, value: finished };
        });
        if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'AUTO_FINISH_FAILED', message: result.error?.message ?? 'Auto Finish failed' } };
        const value = result.value as unknown;
        if (!value || typeof value !== 'object' || !('ok' in value)) {
            return { ok: false, error: { code: 'AUTO_FINISH_FAILED', message: 'Auto Finish returned no result' } };
        }
        return value as { readonly ok: true; readonly value: AutoFinishRunResult } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
    }

    async run(
        owner: string,
        options: AutoFinishRunOptions = {},
        prefetched?: { readonly jobs: readonly JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] },
    ): Promise<AutoFinishRunResult | { readonly busy: true }> {
        if (this.running) return { busy: true };
        if (prefetched && shouldUsePrefetched(options, prefetched)) {
            const preSettings = await this.deps.settings.get();
            const preStored = await this.deps.store.get();
            const preState = resolveAutoFinishRunState(options, preStored);
            const preAllowed = new Set(preSettings.autoCompleteJobTypes);
            const preResets = new Map<string, string>();
            for (const market of prefetched.markets) {
                if (market.ok && typeof market.resetAt === 'string' && market.resetAt.length > 0) {
                    preResets.set(market.marketKey, market.resetAt);
                }
            }
            if (preState.clearAttempts) this.deps.locks.clearAttempts();
            if (preState.clearLocks) this.deps.locks.clearLocks();
            const preJobs = this.withCachedClaimOnly(prefetched).jobs;
            const preRunnable = preJobs.filter((job) => {
                // A taken job that is already claimable only needs
                // `job.complete`; it does not need a target server or an
                // enabled job type, and a stale minigame lock must not strand
                // it as claimable.
                if (job.alreadyTaken && job.canComplete) {
                    this.deps.locks.deleteLock(job.id);
                    return true;
                }
                if (job.serverId === null && !isServerlessJob(job.type)) return false;
                if (!preAllowed.has(job.type)) return false;
                if (this.deps.locks.isRetryExhausted(job.id)) return false;
                if (this.deps.locks.isLocked(job.id)) return false;
                const resetAt = preResets.get(job.marketKey) ?? null;
                return !isCompletedForReset(job.id, preState.completedJobs, resetAt);
            });
            if (preRunnable.length === 0) {
                const preRunnableIds = new Set(preRunnable.map((job) => job.id));
                const preSkipped = { noServer: 0, typeDisabled: 0, locked: 0, retryExhausted: 0, completed: 0 };
                const preBlocked: Array<{ jobId: string; name: string; marketKey: string; reason: string; lockExpiresAt?: number; resetAt?: string }> = [];
                for (const job of preJobs) {
                    if (preRunnableIds.has(job.id)) continue;
                    const resetAt = preResets.get(job.marketKey) ?? null;
                    if (job.serverId === null && !isServerlessJob(job.type)) {
                        preSkipped.noServer += 1;
                        preBlocked.push({ jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'no-server' });
                    } else if (!preAllowed.has(job.type)) {
                        preSkipped.typeDisabled += 1;
                        preBlocked.push({ jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'type-disabled' });
                    } else if (this.deps.locks.isLocked(job.id)) {
                        preSkipped.locked += 1;
                        const lockUntil = this.deps.locks.lockUntil(job.id);
                        preBlocked.push({
                            jobId: job.id,
                            name: job.name,
                            marketKey: job.marketKey,
                            reason: 'minigame-lock',
                            ...(lockUntil !== undefined ? { lockExpiresAt: lockUntil } : {}),
                        });
                    } else if (this.deps.locks.isRetryExhausted(job.id)) {
                        preSkipped.retryExhausted += 1;
                        preBlocked.push({ jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'retry-exhausted' });
                    } else {
                        preSkipped.completed += 1;
                        preBlocked.push({ jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'completed', ...(resetAt ? { resetAt } : {}) });
                    }
                }
                this.deps.logger.info('auto-jobs', preJobs.length === 0 ? 'Auto Finish: no jobs to run' : 'Auto Finish selection skipped every job', {
                    jobs: preJobs.length,
                    allowedTypes: [...preAllowed],
                    completedJobs: Object.keys(preState.completedJobs).length,
                    skipped: preSkipped,
                    blocked: preBlocked.slice(0, 10),
                });
                // Even when nothing can run, publish a persisted report. Without
                // it the UI kept the previous run's statuses and showed newly
                // claimable jobs with no tag at all.
                const markets = this.mergePreviousMarkets(buildLiveMarkets({ jobs: preJobs, markets: prefetched.markets }, preRunnable, preAllowed, this.deps.locks, this.now(), {
                    completedJobs: preState.completedJobs,
                    resetByMarket: preResets,
                }));
                const totalRetry = markets.reduce((sum, market) => sum + (market.retry ?? 0), 0);
                const totalSkipped = markets.reduce((sum, market) => sum + (market.skipped ?? 0), 0);
                const totalExpired = markets.reduce((sum, market) => sum + (market.expired ?? 0), 0);
                const retryFailuresForSchedule = markets
                    .flatMap((market) => market.jobs ?? [])
                    .filter((job) => job.status === 'retry' || job.lockExpiresAt !== undefined || job.retryAt !== undefined)
                    .map((job) => ({
                        jobId: job.jobId,
                        name: job.name,
                        serverName: job.serverName,
                        code: job.code ?? 'RETRY',
                        message: job.error ?? 'Retry scheduled',
                        ...(job.retryAt !== undefined ? { retryAt: job.retryAt } : {}),
                        ...(job.lockExpiresAt !== undefined ? { lockExpiresAt: job.lockExpiresAt } : {}),
                    }));
                const runId = `auto-finish-${this.now()}`;
                this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Selection blocked ${preJobs.length} job(s)`, {
                    skipped: preSkipped,
                    blocked: preBlocked.slice(0, 10),
                });
                const finalized = await finalizeAutoFinish(this.finalizeDeps(), {
                    runId,
                    owner,
                    syncedJobs: prefetched.jobs.length,
                    markets,
                    failures: [],
                    retryEntries: [],
                    retryFailuresForSchedule,
                    completedResets: preState.completedResets,
                    completedJobs: preState.completedJobs,
                    runDoneCount: 0,
                    runnableCount: 0,
                    totalRetry,
                    totalSkipped,
                    totalExpired,
                    stopped: false,
                    currentSettings: preSettings,
                    cancelRequested: () => false,
                    dismiss: false,
                });
                this.last = finalized.last;
                this.completedResets = finalized.completedResets;
                this.completedJobs = finalized.completedJobs;
                this.nextRetryAt = finalized.nextRetryAt;
                this.retryReason = finalized.retryReason;
                this.deps.locks.pruneExpiredLocks();
                void this.deps.locks.persist('idle');
                return finalized.result;
            }
        }
        this.running = true;
        this.cancelRequested = false;
        this.nextRetryAt = null;
        this.retryReason = null;
        const runId = `auto-finish-${this.now()}`;
        this.live = { runId, startedAt: this.now(), markets: [] };
        this.broadcastLive();
        this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Run started (owner: ${owner}, forceRefresh: ${options.forceRefresh === true}, retryFailed: ${options.retryFailed === true})`, { runId, owner, options });
        await this.deps.scheduler.clear(AUTO_FINISH_RETRY_ALARM);
        try {
            const synced = prefetched && shouldUsePrefetched(options, prefetched)
                ? prefetched
                : await this.deps.markets.syncAll(
                    owner,
                    'auto-finish',
                    owner === 'auto-finish-retry' ? this.retryMarkets() : undefined,
                );
            const runJobs = this.withCachedClaimOnly(synced).jobs;
            this.publishSnapshot({ at: this.now(), jobs: synced.jobs, markets: synced.markets });
            this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Synced ${synced.jobs.length} job(s) from ${synced.markets.filter((market) => market.ok).length} market(s)`, {
                jobs: synced.jobs.length,
                markets: synced.markets.filter((market) => market.ok).map((market) => market.marketKey),
            });
            const currentSettings = await this.deps.settings.get();
            const allowedTypes = new Set(currentSettings.autoCompleteJobTypes);
            const stored = await this.deps.store.get();
            const state = resolveAutoFinishRunState(options, stored);
            const completedResets = state.completedResets;
            const completedJobs = state.completedJobs;
            const resetByMarket = new Map<string, string>();
            for (const market of synced.markets) {
                if (market.ok && typeof market.resetAt === 'string' && market.resetAt.length > 0) {
                    resetByMarket.set(market.marketKey, market.resetAt);
                }
            }
            if (state.clearAttempts) this.deps.locks.clearAttempts();
            if (state.clearLocks) this.deps.locks.clearLocks();
            this.deps.locks.reconcileResets(resetByMarket);
            const runnable = runJobs.filter((job) => {
                // Claim-only jobs bypass locks, server/type checks and the
                // retry/completion budgets: the decryption/minigame is already
                // finished, only completion remains.
                if (job.alreadyTaken && job.canComplete) {
                    this.deps.locks.deleteLock(job.id);
                    return true;
                }
                if (job.serverId === null && !isServerlessJob(job.type)) return false;
                if (!allowedTypes.has(job.type)) return false;
                if (this.deps.locks.isRetryExhausted(job.id)) return false;
                if (this.deps.locks.isLocked(job.id)) return false;
                const resetAt = resetByMarket.get(job.marketKey) ?? null;
                return !isCompletedForReset(job.id, completedJobs, resetAt);
            });
            const runnableIds = new Set(runnable.map((job) => job.id));
            const skipped = { noServer: 0, typeDisabled: 0, locked: 0, retryExhausted: 0, completed: 0 };
            for (const job of runJobs) {
                if (runnableIds.has(job.id)) continue;
                if (!job.serverId && !isServerlessJob(job.type)) skipped.noServer += 1;
                else if (!allowedTypes.has(job.type)) skipped.typeDisabled += 1;
                else if (this.deps.locks.isLocked(job.id)) skipped.locked += 1;
                else if (this.deps.locks.isRetryExhausted(job.id)) skipped.retryExhausted += 1;
                else skipped.completed += 1;
            }
            if (runnable.length < runJobs.length) {
                const blocked = runJobs
                    .filter((job) => !runnableIds.has(job.id))
                    .slice(0, 10)
                    .map((job) => {
                        const lockUntil = this.deps.locks.lockUntil(job.id);
                        if (lockUntil !== undefined && lockUntil > this.now()) {
                            return { jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'minigame-lock', lockExpiresAt: lockUntil };
                        }
                        if (this.deps.locks.isRetryExhausted(job.id)) {
                            return { jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'retry-exhausted' };
                        }
                        if (job.serverId === null && !isServerlessJob(job.type)) {
                            return { jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'no-server' };
                        }
                        if (!allowedTypes.has(job.type)) {
                            return { jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'type-disabled' };
                        }
                        return { jobId: job.id, name: job.name, marketKey: job.marketKey, reason: 'completed' };
                    });
                this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Selection: ${runnable.length}/${runJobs.length} runnable; skipped ${runJobs.length - runnable.length}`, {
                    ...skipped,
                    allowedTypes: [...allowedTypes],
                    blocked,
                });
            }
            this.live = {
                ...(this.live ?? { runId, startedAt: this.now() }),
                markets: this.mergePreviousMarkets(buildLiveMarkets(synced, runnable, allowedTypes, this.deps.locks, this.now(), {
                    completedJobs,
                    resetByMarket,
                })),
            };
            this.broadcastLive();
            const priority = await buildServerPriority(this.deps.snapshots);
            this.progress = null;
            const completedMarketIds = new Set<string>();
            const runQueue = (jobs: readonly JobOffer[]) => this.deps.queue.run(jobs, {
                owner,
                serverPriority: priority,
                shouldStop: () => this.cancelRequested,
                betweenJobs: () => this.humanDelay(2000, 3500),
                onProgress: (progress) => {
                    this.progress = progress;
                    this.updateLiveJob(progress.jobId, { status: 'running' });
                    this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Running ${jobLocation(progress.jobName, progress.serverName)} (${progress.index}/${progress.total})`, {
                        jobId: progress.jobId,
                        index: progress.index,
                        total: progress.total,
                    });
                    this.deps.events.publish('auto.jobs.progress', progress);
                },
                onJobResult: (job, jobResult) => {
                    if (jobResult.ok) {
                        this.deps.locks.deleteLock(job.id);
                        void this.deps.locks.persist('running');
                        this.updateLiveJob(job.id, { status: 'done' });
                        this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Completed ${jobLocation(job.name, job.serverName)}`, { jobId: job.id, marketKey: job.marketKey });
                        completedMarketIds.add(job.marketId);
                    } else {
                        const jobError = jobResult.error ?? {
                            code: 'JOB_FAILED' as const,
                            message: 'Job failed without error details',
                        };
                        if (jobError.lockExpiresAt !== undefined && jobError.lockExpiresAt > this.now()) {
                            this.deps.locks.setLock(
                                job.id,
                                jobError.lockExpiresAt,
                                job.marketKey,
                                resetByMarket.get(job.marketKey) ?? null,
                            );
                            void this.deps.locks.persist('running');
                        }
                        const outcome = classifyJobFailure({
                            code: jobError.code,
                            ...(jobError.detailCode !== undefined ? { detailCode: jobError.detailCode } : {}),
                            message: jobError.message,
                            ...(jobError.stage !== undefined ? { stage: jobError.stage } : {}),
                            ...(jobError.retryable !== undefined ? { retryable: jobError.retryable } : {}),
                            ...(jobError.retryAt !== undefined ? { retryAt: jobError.retryAt } : {}),
                            ...(jobError.lockExpiresAt !== undefined ? { lockExpiresAt: jobError.lockExpiresAt } : {}),
                        });
                        this.updateLiveJob(job.id, {
                            status: outcome.status === 'expired' ? 'expired' : outcome.status,
                            error: jobError.message,
                            code: jobError.detailCode ?? jobError.code,
                            ...(jobError.retryable !== undefined ? { retryable: jobError.retryable } : {}),
                            ...(jobError.retryAt !== undefined ? { retryAt: jobError.retryAt } : {}),
                            ...(jobError.lockExpiresAt !== undefined ? { lockExpiresAt: jobError.lockExpiresAt } : {}),
                            ...(jobError.stage !== undefined ? { stage: jobError.stage } : {}),
                        });
                    }
                },
            });
            const result = await runQueue(runnable);
            const deferredOutcome = await runDeferredRetryPass({
                owner,
                runId,
                done: result.done,
                failed: result.failed,
                cancelRequested: () => result.stopped || this.cancelRequested,
                markets: this.deps.markets,
                publishSnapshot: (update) => this.publishSnapshot(update),
                runQueue,
                runLogs: this.deps.runLogs,
                now: () => this.now(),
                humanDelay: this.humanDelay,
            });
            const runDone = [...deferredOutcome.runDone];
            const failedById = deferredOutcome.failedById;
            const deferredExpiredIds = deferredOutcome.deferredExpiredIds;

            const doneIds = new Set(runDone.map((job) => job.id));
            const effectiveFailed = [...failedById.values()].filter((entry) => !doneIds.has(entry.job.id));
            const outcomes = new Map<string, JobOutcome>();
            for (const entry of effectiveFailed) outcomes.set(entry.job.id, classifyJobFailure(outcomeInputOf(entry)));
            for (const id of deferredExpiredIds) outcomes.set(id, { status: 'expired', reason: 'expired' });

            const terminalEntries = effectiveFailed.filter((entry) => outcomes.get(entry.job.id)?.status === 'failed');
            const retryEntries = effectiveFailed.filter((entry) => outcomes.get(entry.job.id)?.status === 'retry');
            for (const entry of retryEntries) {
                const outcome = outcomes.get(entry.job.id);
                // Network, maintenance and game-lock failures are time based:
                // they retry on the next scheduled pass instead of consuming the
                // per-job budget. Otherwise one bad network batch hid jobs until
                // the next market reset.
                if (outcome && !countsAgainstRetryBudget(outcome)) continue;
                const resetAt = resetByMarket.get(entry.job.marketKey) ?? null;
                this.deps.locks.recordRetry(entry.job.id, entry.job.marketKey, resetAt);
            }
            await this.deps.history.record(runDone, terminalEntries, retryEntries);
            this.deps.locks.pruneExpiredLocks();
            void this.deps.locks.persist('idle');
            for (const [index, marketId] of [...completedMarketIds].entries()) {
                await this.deps.markets.refreshCachedOptions(marketId);
                if (index < completedMarketIds.size - 1) await this.humanDelay(350, 700);
            }

            let markets = buildFinalMarkets({
                synced,
                allowedTypes,
                doneIds,
                completedJobs,
                resetByMarket,
                locks: this.deps.locks,
                outcomes,
                failedById,
                stopped: result.stopped,
                now: this.now(),
                previousMarkets: this.last?.markets ?? [],
                doneJobs: runDone,
            });

            const failures: AutoFinishFailure[] = terminalEntries.map(failureOf);
            const retryFailuresForSchedule: AutoFinishFailure[] = retryEntries.map(failureOf);
            // Jobs skipped by a per-job minigame lock are not part of
            // `retryEntries`, but they still need a wake-up when the lock
            // expires instead of waiting for the next market reset.
            for (const job of synced.jobs) {
                const until = this.deps.locks.lockUntil(job.id);
                if (until === undefined || until <= this.now()) continue;
                if (retryFailuresForSchedule.some((entry) => entry.jobId === job.id)) continue;
                retryFailuresForSchedule.push({
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    code: 'MINIGAME_FAILED',
                    message: 'Minigame is locked',
                    lockExpiresAt: until,
                });
            }
            if (this.live) markets = recalcLiveMarkets(this.live.markets);
            logAutoFinishJobs({
                runId,
                failures,
                retryEntries,
                effectiveFailed,
                outcomes,
                locks: this.deps.locks,
                runLogs: this.deps.runLogs,
                logger: this.deps.logger,
            });
            const totalRetry = markets.reduce((sum, market) => sum + (market.retry ?? 0), 0);
            const totalSkipped = markets.reduce((sum, market) => sum + (market.skipped ?? 0), 0);
            const totalExpired = markets.reduce((sum, market) => sum + (market.expired ?? 0), 0);
            this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Run finished: ${runDone.length} done, ${totalRetry} retrying, ${totalSkipped} skipped, ${totalExpired} expired, ${failures.length} failed, ${runnable.length} total${result.stopped ? ' (stopped)' : ''}`, {
                done: runDone.length,
                retry: totalRetry,
                skipped: totalSkipped,
                expired: totalExpired,
                failed: failures.length,
                total: runnable.length,
                stopped: result.stopped,
            });
            this.live = null;
            const finalized = await finalizeAutoFinish(this.finalizeDeps(), {
                runId,
                owner,
                syncedJobs: runJobs.length,
                markets,
                failures,
                retryEntries,
                retryFailuresForSchedule,
                completedResets,
                completedJobs,
                runDoneCount: runDone.length,
                runnableCount: runnable.length,
                totalRetry,
                totalSkipped,
                totalExpired,
                stopped: result.stopped,
                currentSettings,
                cancelRequested: () => this.cancelRequested,
            });
            this.last = finalized.last;
            this.completedResets = finalized.completedResets;
            this.completedJobs = finalized.completedJobs;
            this.nextRetryAt = finalized.nextRetryAt;
            this.retryReason = finalized.retryReason;
            return finalized.result;
        } finally {
            this.progress = null;
            this.live = null;
            this.cancelRequested = false;
            this.running = false;
        }
    }

    private now(): number {
        return this.deps.clock.now();
    }

    /**
     * When a market fetch fails, keep only claim-only jobs from the short-lived
     * Auto Jobs snapshot. Completing an already-finished job is safe; no other
     * cached action is ever used for execution.
     */
    private withCachedClaimOnly(synced: {
        readonly jobs: readonly JobOffer[];
        readonly markets: readonly JobMarketSyncEntry[];
    }): { readonly jobs: readonly JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] } {
        const failedKeys = new Set(synced.markets.filter((market) => !market.ok).map((market) => market.marketKey));
        if (failedKeys.size === 0) return synced;
        const snapshot = this.autoJobs?.snapshotView();
        if (!snapshot) return synced;
        const seen = new Set(synced.jobs.map((job) => job.id));
        const cached = snapshot.jobs.filter((job) => {
            if (!failedKeys.has(job.marketKey) || !job.alreadyTaken || !job.canComplete || seen.has(job.id)) return false;
            const cachedMarket = snapshot.markets.find((market) => market.marketKey === job.marketKey);
            const updatedAt = cachedMarket?.updatedAt ?? snapshot.at;
            return this.now() - updatedAt <= CLAIM_ONLY_CACHE_MAX_AGE_MS;
        });
        if (cached.length === 0) return synced;
        return { jobs: [...synced.jobs, ...cached], markets: synced.markets };
    }

    /**
     * A per-market refresh only contains the markets that were stale. Keep the
     * previous rows of markets that were not refreshed.
     */
    private mergePreviousMarkets(markets: readonly AutoFinishMarketResult[]): AutoFinishMarketResult[] {
        const previous = this.last?.markets ?? [];
        if (previous.length === 0) return [...markets];
        const seen = new Set(markets.map((market) => market.marketKey));
        return [...markets, ...previous.filter((market) => !seen.has(market.marketKey))];
    }

    /** Markets that still have retryable work; the retry alarm refreshes only these. */
    private retryMarkets(): readonly JobMarketDefinition[] | undefined {
        const last = this.last;
        if (!last) return undefined;
        const keys = new Set<string>();
        for (const market of last.markets) {
            for (const job of market.jobs ?? []) {
                if (job.status === 'retry') keys.add(market.marketKey);
            }
        }
        if (keys.size === 0) return undefined;
        return JOB_MARKETS.filter((market) => keys.has(market.key));
    }

    private finalizeDeps() {
        return {
            store: this.deps.store,
            events: this.deps.events,
            runLogs: this.deps.runLogs,
            settings: this.deps.settings,
            scheduler: this.deps.scheduler,
            snapshots: this.deps.snapshots,
            autoJobs: this.autoJobs!,
            now: () => this.now(),
            onPersisted: (
                last: import('../../../contracts/auto-finish.js').AutoFinishLastRun,
                completedResets: Readonly<Record<string, string>>,
                completedJobs: Readonly<Record<string, string>>,
            ) => {
                this.last = last;
                this.completedResets = completedResets;
                this.completedJobs = completedJobs;
                void this.scheduleNextRefresh();
            },
        };
    }

    private publishSnapshot(update: AutoJobsSnapshot): void {
        this.autoJobs?.publishSnapshot(update);
    }

    private async scheduleNextRefresh(): Promise<void> {
        await this.autoJobs?.scheduleNextRefresh();
    }

    private broadcastLive(): void {
        if (this.live) this.deps.events.publish('auto.jobs.live', this.live);
    }

    private updateLiveJob(jobId: string, patch: Partial<AutoFinishJobResult>): void {
        if (!this.live) return;
        this.live = {
            ...this.live,
            markets: recalcLiveMarkets(this.live.markets.map((market) => ({
                ...market,
                jobs: (market.jobs ?? []).map((job) => job.jobId === jobId ? { ...job, ...patch } : job),
            }))),
        };
        this.broadcastLive();
    }
}
