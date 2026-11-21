import type { AutoFinishJobResult, AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import { isServerlessJob, type JobOffer } from '../../../domains/jobs/model.js';
import { jobIdentityKey } from '../../../contracts/jobs.js';
import { isCompletedForMarketReset } from '../../../application/auto-job/market-completion.js';
import { EMPTY_MARKET_COMPLETED_JOBS, type MarketCompletedJobsState } from '../../../contracts/market-completed-jobs.js';
import type { JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { codeForOutcome, outcomeReasonText } from './job-outcome.js';

export function autoFinishMarketBase(market: JobMarketSyncEntry): Omit<JobMarketSyncEntry, 'skippedJobs' | 'expired' | 'errorCode'> {
    // Auto Finish has its own market schema and does not expose Auto Jobs'
    // short error codes. Keeping errorCode here makes the persisted
    // auto-finish state fail validation and aborts the whole Auto Jobs cycle.
    const { skippedJobs, expired, errorCode, ...base } = market;
    void skippedJobs;
    void expired;
    void errorCode;
    return base;
}

export function recalcLiveMarkets(markets: readonly AutoFinishMarketResult[]): AutoFinishMarketResult[] {
    return markets.map((market) => {
        const jobs = market.jobs ?? [];
        const count = (status: AutoFinishJobResult['status']) => jobs.filter((job) => job.status === status).length;
        return {
            ...market,
            jobTotal: jobs.length,
            success: count('done'),
            retry: count('retry'),
            skipped: count('skipped'),
            expired: count('expired'),
            failed: count('failed'),
            pending: count('pending') + count('running'),
        };
    });
}

/**
 * Overlays the live market snapshot onto the final execution report.
 *
 * The final report is authoritative for every market/job it contains. Live
 * data is used only to keep rows that the final report does not know about
 * (for example a market that was refreshed after the final report was
 * assembled). This prevents a live snapshot from deleting failed markets,
 * cached claim-only rows or final outcomes, while still preserving genuinely
 * new live-only rows.
 */
export function mergeFinalWithLive(
    finalMarkets: readonly AutoFinishMarketResult[],
    liveMarkets: readonly AutoFinishMarketResult[],
): AutoFinishMarketResult[] {
    const liveByMarket = new Map(liveMarkets.map((market) => [market.marketKey, market]));
    const seenMarkets = new Set<string>();
    const merged: AutoFinishMarketResult[] = [];

    for (const finalMarket of finalMarkets) {
        seenMarkets.add(finalMarket.marketKey);
        const live = liveByMarket.get(finalMarket.marketKey);
        if (!live) {
            merged.push(recalcLiveMarkets([finalMarket])[0] ?? finalMarket);
            continue;
        }
        const finalJobs = finalMarket.jobs ?? [];
        const finalJobIds = new Set(finalJobs.map((job) => job.jobId));
        const liveOnlyJobs = (live.jobs ?? []).filter((job) => !finalJobIds.has(job.jobId));
        merged.push(recalcLiveMarkets([{
            ...finalMarket,
            jobs: [...liveOnlyJobs, ...finalJobs],
        }])[0] ?? finalMarket);
    }

    for (const live of liveMarkets) {
        if (seenMarkets.has(live.marketKey)) continue;
        merged.push(recalcLiveMarkets([live])[0] ?? live);
    }

    return merged;
}

export function buildLiveMarkets(
    synced: { jobs: readonly JobOffer[]; markets: readonly JobMarketSyncEntry[] },
    runnable: readonly JobOffer[],
    allowedTypes: ReadonlySet<JobOffer['type']>,
    locks: JobLockRegistry,
    now: number,
    completed?: {
        readonly completedJobsByMarket?: MarketCompletedJobsState;
        readonly resetByMarket?: ReadonlyMap<string, string>;
    },
): AutoFinishMarketResult[] {
    const runnableIds = new Set(runnable.map((job) => jobIdentityKey(job.marketKey, job.id)));
    const completedByMarket = completed?.completedJobsByMarket ?? EMPTY_MARKET_COMPLETED_JOBS;
    const resetByMarket = completed?.resetByMarket;
    return synced.markets.map((market) => {
        const base = autoFinishMarketBase(market);
        if (!market.ok) return { ...base, jobs: [] };
        const jobs = synced.jobs
            .filter((job) => job.marketKey === market.marketKey)
            .map((job): AutoFinishJobResult => {
                const claimOnly = job.alreadyTaken && job.canComplete;
                const typeBlocked = !claimOnly && !allowedTypes.has(job.type);
                const needsServer = !claimOnly && !isServerlessJob(job.type);
                const lockUntil = locks.lockUntil(job.marketKey, job.id);
                const locked = lockUntil !== undefined && lockUntil > now;
                const exhausted = locks.isRetryExhausted(job.marketKey, job.id);
                const resetAt = resetByMarket?.get(job.marketKey) ?? null;
                // Jobs completed earlier in this reset stay done instead of
                // reappearing as "already completed" (and losing their tag).
                const completedForReset = isCompletedForMarketReset(completedByMarket, job.marketKey, job.id, resetAt);
                const blocked = (needsServer && !job.serverId) || typeBlocked || locked || exhausted || !runnableIds.has(jobIdentityKey(job.marketKey, job.id));
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: completedForReset ? 'done' : exhausted ? 'retry' : blocked ? 'skipped' : 'pending',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    ...(completedForReset
                        ? {}
                        : needsServer && !job.serverId
                            ? { error: 'No target server for this job', code: 'NO_SERVER', stage: 'route' }
                            : typeBlocked
                                ? { error: 'Job type disabled for auto completion', code: 'TYPE_DISABLED', stage: 'select' }
                                : locked
                                    ? { error: 'Minigame is locked', code: 'MINIGAME_FAILED', stage: 'minigame', lockExpiresAt: lockUntil }
                                    : exhausted
                                        ? { error: 'Retry budget exhausted for this market reset', code: 'RETRY_EXHAUSTED', stage: 'retry', retryExhausted: true }
                                        : !runnableIds.has(jobIdentityKey(job.marketKey, job.id))
                                            ? { error: 'Already completed for this market reset', code: 'ALREADY_COMPLETED' }
                                            : {}),
                };
            });
        const count = (status: AutoFinishJobResult['status']) => jobs.filter((job) => job.status === status).length;
        return {
            ...base,
            jobTotal: jobs.length,
            success: count('done'),
            retry: count('retry'),
            skipped: count('skipped'),
            expired: count('expired'),
            failed: count('failed'),
            pending: count('pending') + count('running'),
            jobs,
        };
    });
}

export interface FinalMarketInput {
    readonly synced: { jobs: readonly JobOffer[]; markets: readonly JobMarketSyncEntry[] };
    readonly allowedTypes: ReadonlySet<JobOffer['type']>;
    readonly doneIds: ReadonlySet<string>;
    readonly completedJobsByMarket: MarketCompletedJobsState;
    readonly resetByMarket: ReadonlyMap<string, string>;
    readonly locks: JobLockRegistry;
    readonly outcomes: ReadonlyMap<string, JobOutcome>;
    readonly failedById: ReadonlyMap<string, AutoJobQueueFailure>;
    readonly stopped: boolean;
    readonly now: number;
    /** Previous report: failed markets keep their job rows and are marked stale. */
    readonly previousMarkets?: readonly AutoFinishMarketResult[];
    /** Jobs completed in this run, including cached claim-only jobs. */
    readonly doneJobs?: readonly JobOffer[];
}

/** Builds the per-market report shown by Auto Finish after a run. */
export function buildFinalMarkets(params: FinalMarketInput): AutoFinishMarketResult[] {
    const { synced, allowedTypes, doneIds, completedJobsByMarket, resetByMarket, locks, outcomes, failedById, stopped, now, previousMarkets } = params;
    const markets: AutoFinishMarketResult[] = synced.markets.map((market) => {
        const base = autoFinishMarketBase(market);
        if (!market.ok) {
            const previous = previousMarkets?.find((entry) => entry.marketKey === market.marketKey);
            const doneHere = (params.doneJobs ?? []).filter((job) => job.marketKey === market.marketKey);
            const previousJobs = (previous?.jobs ?? []).filter((job) => !doneIds.has(jobIdentityKey(job.marketKey, job.jobId)));
            const jobs: AutoFinishJobResult[] = [
                ...previousJobs,
                ...doneHere.map((job): AutoFinishJobResult => ({
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'done',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                })),
            ];
            return {
                ...base,
                stale: true,
                resetAt: previous?.resetAt ?? null,
                jobs,
                jobTotal: jobs.length,
                success: jobs.filter((job) => job.status === 'done').length,
                retry: jobs.filter((job) => job.status === 'retry').length,
                skipped: jobs.filter((job) => job.status === 'skipped').length,
                expired: jobs.filter((job) => job.status === 'expired').length,
                failed: jobs.filter((job) => job.status === 'failed').length,
                pending: jobs.filter((job) => job.status === 'pending' || job.status === 'running').length,
                ...(previous?.updatedAt !== undefined ? { updatedAt: previous.updatedAt } : {}),
            };
        }
        const marketJobs = synced.jobs.filter((job) => job.marketKey === market.marketKey);
        const jobs: AutoFinishJobResult[] = marketJobs.map((job): AutoFinishJobResult => {
            const failure = failedById.get(jobIdentityKey(job.marketKey, job.id));
            const failureError = failure?.error;
            const outcome = outcomes.get(jobIdentityKey(job.marketKey, job.id));
            const resetAt = resetByMarket.get(job.marketKey) ?? null;
            const completedForReset = isCompletedForMarketReset(completedJobsByMarket, job.marketKey, job.id, resetAt);
            // Report a job as done when it completed in this run or earlier in
            // the same reset. This keeps the Done tag after claim-only passes
            // and after a market refresh failed in a later cycle.
            if (doneIds.has(jobIdentityKey(job.marketKey, job.id)) || completedForReset) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'done',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                };
            }
            if (!job.serverId && !isServerlessJob(job.type) && !(job.alreadyTaken && job.canComplete)) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'skipped',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: 'No target server for this job',
                    code: 'NO_SERVER',
                    stage: 'route',
                };
            }
            if (!allowedTypes.has(job.type) && !(job.alreadyTaken && job.canComplete)) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'skipped',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: 'Job type disabled for auto completion',
                    code: 'TYPE_DISABLED',
                    stage: 'select',
                };
            }
            const lockUntil = locks.lockUntil(job.marketKey, job.id);
            if (lockUntil !== undefined && lockUntil > now) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'retry',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: 'Minigame is locked',
                    code: 'MINIGAME_FAILED',
                    lockExpiresAt: lockUntil,
                    stage: 'minigame',
                };
            }
            if (outcome?.status === 'expired') {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'expired',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: failureError?.message ?? 'Job expired before completion',
                    code: 'EXPIRED',
                    stage: 'expire',
                };
            }
            if (outcome?.status === 'retry' && failure) {
                const exhausted = locks.isRetryExhausted(job.marketKey, job.id);
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'retry',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: exhausted ? 'Retry budget exhausted for this market reset' : failureError?.message ?? 'Job failed',
                    code: exhausted ? 'RETRY_EXHAUSTED' : failureError?.detailCode ?? failureError?.code ?? 'JOB_FAILED',
                    ...(exhausted ? { retryExhausted: true } : {}),
                    ...(failureError?.retryable !== undefined ? { retryable: failureError.retryable } : {}),
                    ...(failureError?.retryAt !== undefined ? { retryAt: failureError.retryAt } : {}),
                    ...(failureError?.lockExpiresAt !== undefined ? { lockExpiresAt: failureError.lockExpiresAt } : {}),
                    ...(failureError?.stage !== undefined ? { stage: failureError.stage } : {}),
                };
            }
            if (outcome?.status === 'failed' && failure) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'failed',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: failureError?.message ?? 'Job failed',
                    code: failureError?.detailCode ?? failureError?.code ?? 'JOB_FAILED',
                    ...(failureError?.retryable !== undefined ? { retryable: failureError.retryable } : {}),
                    ...(failureError?.retryAt !== undefined ? { retryAt: failureError.retryAt } : {}),
                    ...(failureError?.lockExpiresAt !== undefined ? { lockExpiresAt: failureError.lockExpiresAt } : {}),
                    ...(failureError?.stage !== undefined ? { stage: failureError.stage } : {}),
                };
            }
            if (outcome?.status === 'skipped') {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'skipped',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: failureError?.message ?? outcomeReasonText(outcome),
                    code: codeForOutcome(outcome, failureError?.detailCode ?? failureError?.code ?? 'SKIPPED'),
                    stage: failureError?.stage ?? 'select',
                };
            }
            return {
                jobId: job.id,
                name: job.name,
                serverName: job.serverName,
                marketKey: job.marketKey,
                status: stopped ? 'skipped' : 'pending',
                rewardCredits: job.rewardCredits,
                rewardReputation: job.rewardReputation,
            };
        });
        const count = (status: AutoFinishJobResult['status']) => jobs.filter((job) => job.status === status).length;
        return {
            ...base,
            jobTotal: marketJobs.length,
            success: count('done'),
            retry: count('retry'),
            skipped: count('skipped'),
            expired: count('expired'),
            failed: count('failed'),
            pending: count('pending') + count('running'),
            jobs,
        };
    });
    // A per-market refresh only contains the markets that were stale. Keep the
    // rows of markets that were not refreshed so their statuses do not vanish.
    if (previousMarkets) {
        for (const previous of previousMarkets) {
            if (!synced.markets.some((market) => market.marketKey === previous.marketKey)) markets.push(previous);
        }
    }
    return markets;
}
