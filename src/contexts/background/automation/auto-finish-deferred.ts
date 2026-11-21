import type { JobOffer } from '../../../domains/jobs/model.js';
import { jobIdentityKey } from '../../../contracts/jobs.js';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import type { AutoJobQueueFailure, AutoJobQueueResult } from '../../../application/auto-job/queue.js';
import { classifyJobFailure } from '../../../application/auto-job/outcome.js';
import type { RunLogSink } from '../../../application/automation/ports.js';
import { outcomeInputOf } from './job-outcome.js';
import type { JobMarketSync } from './job-market-sync.js';

export interface DeferredRetryDeps {
    readonly owner: string;
    readonly runId: string;
    readonly done: readonly JobOffer[];
    readonly failed: readonly AutoJobQueueFailure[];
    readonly cancelRequested: () => boolean;
    readonly markets: Pick<JobMarketSync, 'syncAll'>;
    readonly publishSnapshot: (update: { readonly at: number; readonly jobs: readonly JobOffer[]; readonly markets: readonly import('../../../contracts/auto-jobs.js').AutoJobsMarket[] }) => void;
    readonly runQueue: (jobs: readonly JobOffer[]) => Promise<AutoJobQueueResult>;
    readonly runLogs: RunLogSink;
    readonly now: () => number;
    readonly humanDelay: (minMs?: number, maxMs?: number) => Promise<void>;
}

export interface DeferredRetryOutcome {
    readonly runDone: readonly JobOffer[];
    readonly failedById: ReadonlyMap<string, AutoJobQueueFailure>;
    readonly deferredExpiredIds: ReadonlySet<string>;
}

/**
 * Second pass that turns transient completion/minigame/server-state failures
 * into retries instead of surfacing them as failed.
 */
export async function runDeferredRetryPass(deps: DeferredRetryDeps): Promise<DeferredRetryOutcome> {
    const runDone: JobOffer[] = [...deps.done];
    const failedById = new Map<string, AutoJobQueueFailure>();
    const deferredExpiredIds = new Set<string>();
    for (const entry of deps.failed) failedById.set(jobIdentityKey(entry.job.marketKey, entry.job.id), entry);
    if (deps.cancelRequested()) return { runDone, failedById, deferredExpiredIds };

    const deferredNow = deps.now();
    const retryCandidates = deps.failed.filter((entry) => {
        if (entry.error.unconfirmed === true) return false;
        const outcome = classifyJobFailure(outcomeInputOf(entry));
        if (outcome.status !== 'retry') return false;
        const notBefore = entry.error.lockExpiresAt ?? entry.error.retryAt;
        return notBefore === undefined || notBefore <= deferredNow;
    });
    if (retryCandidates.length === 0) return { runDone, failedById, deferredExpiredIds };

    deps.runLogs.add(deps.runId, 'info', 'auto-jobs', `Deferred retry pass: ${retryCandidates.length} job(s)`, {
        candidates: retryCandidates.map((entry) => entry.job.id),
    });
    await deps.humanDelay(8_000, 12_000);
    if (deps.cancelRequested()) {
        deps.runLogs.add(deps.runId, 'info', 'auto-jobs', 'Deferred retry pass skipped: run cancelled');
        return { runDone, failedById, deferredExpiredIds };
    }
    try {
        // Only refresh the markets that still have retry candidates. Refreshing
        // all four markets here made every retry pass move the endpoint three
        // times more than necessary.
        const retryMarketKeys = new Set(retryCandidates.map((entry) => entry.job.marketKey));
        const retryTargets = JOB_MARKETS.filter((market) => retryMarketKeys.has(market.key));
        const retrySynced = await deps.markets.syncAll(deps.owner, 'auto-jobs-retry', retryTargets, undefined, deps.cancelRequested);
        deps.publishSnapshot({ at: deps.now(), jobs: retrySynced.jobs, markets: retrySynced.markets });
        const freshById = new Map(retrySynced.jobs.map((job) => [jobIdentityKey(job.marketKey, job.id), job]));
        const syncedMarketKeys = new Set(retrySynced.markets.filter((market) => market.ok).map((market) => market.marketKey));
        const skippedById = new Map<string, { readonly expired?: boolean; readonly status: string }>();
        for (const market of retrySynced.markets) {
            for (const skipped of market.skippedJobs ?? []) skippedById.set(jobIdentityKey(market.marketKey, skipped.id), skipped);
        }
        const retryJobs: JobOffer[] = [];
        for (const entry of retryCandidates) {
            if (entry.error.unconfirmed === true) continue;
            const fresh = freshById.get(jobIdentityKey(entry.job.marketKey, entry.job.id));
            if (fresh) {
                retryJobs.push(fresh);
                continue;
            }
            // Only trust a disappearance when that market synced
            // successfully; otherwise keep the job as retry.
            if (!syncedMarketKeys.has(entry.job.marketKey)) continue;
            const skipped = skippedById.get(jobIdentityKey(entry.job.marketKey, entry.job.id));
            if (skipped && /complete/i.test(skipped.status)) {
                // The game already considers this job completed even
                // though our completion reply was lost. Align the
                // report with the game instead of calling it failed.
                runDone.push(entry.job);
                continue;
            }
            if (skipped?.expired || /expire|failed/i.test(skipped?.status ?? '') || skipped === undefined) {
                deferredExpiredIds.add(jobIdentityKey(entry.job.marketKey, entry.job.id));
            }
        }
        deps.runLogs.add(deps.runId, 'info', 'auto-jobs', `Deferred retry sync: ${retryJobs.length} runnable, ${deferredExpiredIds.size} expired`, {
            runnable: retryJobs.map((job) => job.id),
            expired: [...deferredExpiredIds],
        });
        if (retryJobs.length > 0) {
            const deferred = await deps.runQueue(retryJobs);
            runDone.push(...deferred.done);
            for (const entry of deferred.failed) failedById.set(jobIdentityKey(entry.job.marketKey, entry.job.id), entry);
        }
    } catch (error) {
        deps.runLogs.add(deps.runId, 'warn', 'auto-jobs', `Deferred retry pass failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { runDone, failedById, deferredExpiredIds };
}
