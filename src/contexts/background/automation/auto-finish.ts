import type { AutoFinishFailure, AutoFinishJobResult, AutoFinishLastRun, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import type { AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import { isServerlessJob, type JobOffer } from '../../../domains/jobs/model.js';
import { classifyJobFailure, type JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobProgress } from '../../../application/auto-job/queue.js';
import { AUTO_FINISH_RETRY_ALARM } from './alarm-ids.js';
import { buildFinalMarkets, buildLiveMarkets, recalcLiveMarkets } from './auto-finish-view.js';
import { runDeferredRetryPass } from './auto-finish-deferred.js';
import { logAutoFinishJobs } from './auto-finish-log.js';
import { finalizeAutoFinish } from './auto-finish-finalize.js';
import { humanDelay as defaultHumanDelay } from './delay.js';
import { failureOf, jobLocation, outcomeInputOf } from './job-outcome.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { buildServerPriority } from './server-priority.js';
import type { AutoFinishDeps, AutoFinishLiveRun, AutoFinishStatus, AutoJobsSink } from './auto-finish-types.js';

export type { AutoFinishDeps, AutoFinishLiveRun, AutoFinishStatus, AutoJobsSink } from './auto-finish-types.js';

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

    async runExclusive(owner: string, force = false): Promise<{ readonly ok: true; readonly value: AutoFinishRunResult } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
        const helperMode = (await this.deps.settings.get()).helperMode;
        if (helperMode) return { ok: false, error: { code: 'HELPER_MODE', message: 'Disable Helper Mode in Settings before starting automation' } };
        const result = await this.deps.networkOps.enqueue({ owner, reason: 'auto-jobs', priority: force ? 80 : 50 }, async () => {
            const finished = await this.run(owner, force);
            if ('busy' in finished) {
                return { ok: false as const, error: { code: 'AUTO_FINISH_BUSY', message: 'Auto Finish is already running' } };
            }
            return { ok: true as const, value: finished };
        });
        if (!result.ok) return { ok: false, error: { code: result.error?.code ?? 'AUTO_FINISH_FAILED', message: result.error?.message ?? 'Auto Finish failed' } };
        return result.value as unknown as { readonly ok: true; readonly value: AutoFinishRunResult };
    }

    async run(
        owner: string,
        force = false,
        prefetched?: { readonly jobs: readonly JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] },
    ): Promise<AutoFinishRunResult | { readonly busy: true }> {
        if (this.running) return { busy: true };
        if (prefetched && !force) {
            const preSettings = await this.deps.settings.get();
            const preStored = await this.deps.store.get();
            const preAllowed = new Set(preSettings.autoCompleteJobTypes);
            const preResets = new Map(prefetched.markets.filter((market) => market.ok).map((market) => [market.marketKey, market.resetAt ?? null]));
            const preRunnable = prefetched.jobs.filter((job) => {
                if (job.serverId === null && !isServerlessJob(job.type)) return false;
                if (!preAllowed.has(job.type)) return false;
                // A taken job that is already claimable only needs `job.complete`;
                // do not let a minigame lock or a stale retry/completion cache
                // leave it unclaimed.
                if (job.alreadyTaken && job.canComplete) return true;
                if (this.deps.locks.isRetryExhausted(job.id)) return false;
                if (this.deps.locks.isLocked(job.id)) return false;
                const resetAt = preResets.get(job.marketKey) ?? null;
                return !(resetAt !== null && preStored.completedJobs[job.id] === resetAt);
            });
            if (preRunnable.length === 0) {
                const preRunnableIds = new Set(preRunnable.map((job) => job.id));
                const preSkipped = { noServer: 0, typeDisabled: 0, locked: 0, retryExhausted: 0, completed: 0 };
                const preBlocked: Array<{ jobId: string; name: string; marketKey: string; reason: string; lockExpiresAt?: number; resetAt?: string }> = [];
                for (const job of prefetched.jobs) {
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
                this.deps.logger.info('auto-jobs', prefetched.jobs.length === 0 ? 'Auto Finish: no jobs to run' : 'Auto Finish selection skipped every job', {
                    jobs: prefetched.jobs.length,
                    allowedTypes: [...preAllowed],
                    completedJobs: Object.keys(preStored.completedJobs).length,
                    skipped: preSkipped,
                    blocked: preBlocked.slice(0, 10),
                });
                return {
                    jobs: prefetched.jobs.length,
                    done: 0,
                    failed: 0,
                    stopped: false,
                    markets: buildLiveMarkets(prefetched, preRunnable, preAllowed, this.deps.locks, this.now()),
                    failures: [],
                };
            }
        }
        this.running = true;
        this.cancelRequested = false;
        this.nextRetryAt = null;
        this.retryReason = null;
        const runId = `auto-finish-${this.now()}`;
        this.live = { runId, startedAt: this.now(), markets: [] };
        this.broadcastLive();
        this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Run started (owner: ${owner}, force: ${force})`, { runId, owner, force });
        await this.deps.scheduler.clear(AUTO_FINISH_RETRY_ALARM);
        try {
            const synced = prefetched ?? await this.deps.markets.syncAll(owner, 'auto-finish');
            this.publishSnapshot({ at: this.now(), jobs: synced.jobs, markets: synced.markets });
            this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Synced ${synced.jobs.length} job(s) from ${synced.markets.filter((market) => market.ok).length} market(s)`, {
                jobs: synced.jobs.length,
                markets: synced.markets.filter((market) => market.ok).map((market) => market.marketKey),
            });
            const currentSettings = await this.deps.settings.get();
            const allowedTypes = new Set(currentSettings.autoCompleteJobTypes);
            const stored = await this.deps.store.get();
            const completedResets = force ? {} : stored.completedResets;
            const completedJobs = force ? {} : stored.completedJobs;
            const resetByMarket = new Map(synced.markets.filter((market) => market.ok).map((market) => [market.marketKey, market.resetAt ?? null]));
            if (force) this.deps.locks.clearAttempts();
            this.deps.locks.reconcileResets(resetByMarket);
            const runnable = synced.jobs.filter((job) => {
                if (job.serverId === null && !isServerlessJob(job.type)) return false;
                if (!allowedTypes.has(job.type)) return false;
                // Claim-only jobs bypass locks and retry/completion budgets:
                // the decryption/minigame is already finished, only completion
                // remains, so a stale lock must not strand them as claimable.
                if (job.alreadyTaken && job.canComplete) return true;
                if (this.deps.locks.isRetryExhausted(job.id)) return false;
                if (this.deps.locks.isLocked(job.id)) return false;
                const resetAt = resetByMarket.get(job.marketKey) ?? null;
                return !(resetAt !== null && completedJobs[job.id] === resetAt);
            });
            const runnableIds = new Set(runnable.map((job) => job.id));
            const skipped = { noServer: 0, typeDisabled: 0, locked: 0, retryExhausted: 0, completed: 0 };
            for (const job of synced.jobs) {
                if (runnableIds.has(job.id)) continue;
                if (!job.serverId && !isServerlessJob(job.type)) skipped.noServer += 1;
                else if (!allowedTypes.has(job.type)) skipped.typeDisabled += 1;
                else if (this.deps.locks.isLocked(job.id)) skipped.locked += 1;
                else if (this.deps.locks.isRetryExhausted(job.id)) skipped.retryExhausted += 1;
                else skipped.completed += 1;
            }
            if (runnable.length < synced.jobs.length) {
                const blocked = synced.jobs
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
                this.deps.runLogs.add(runId, 'info', 'auto-jobs', `Selection: ${runnable.length}/${synced.jobs.length} runnable; skipped ${synced.jobs.length - runnable.length}`, {
                    ...skipped,
                    allowedTypes: [...allowedTypes],
                    blocked,
                });
            }
            this.live = {
                ...(this.live ?? { runId, startedAt: this.now() }),
                markets: buildLiveMarkets(synced, runnable, allowedTypes, this.deps.locks, this.now()),
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
                            this.deps.locks.setLock(job.id, jobError.lockExpiresAt);
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
            });

            const failures: AutoFinishFailure[] = terminalEntries.map(failureOf);
            const retryFailuresForSchedule: AutoFinishFailure[] = retryEntries
                .filter((entry) => !this.deps.locks.isRetryExhausted(entry.job.id))
                .map(failureOf);
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
            const finalized = await finalizeAutoFinish({
                store: this.deps.store,
                events: this.deps.events,
                runLogs: this.deps.runLogs,
                settings: this.deps.settings,
                scheduler: this.deps.scheduler,
                snapshots: this.deps.snapshots,
                autoJobs: this.autoJobs!,
                now: () => this.now(),
                onPersisted: (last, completedResets, completedJobs) => {
                    this.last = last;
                    this.completedResets = completedResets;
                    this.completedJobs = completedJobs;
                    void this.scheduleNextRefresh();
                },
            }, {
                runId,
                owner,
                syncedJobs: synced.jobs.length,
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
