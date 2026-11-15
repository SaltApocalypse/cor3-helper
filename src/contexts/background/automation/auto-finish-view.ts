import type { AutoFinishJobResult, AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import { isServerlessJob, type JobOffer } from '../../../domains/jobs/model.js';
import type { JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { codeForOutcome, outcomeReasonText } from './job-outcome.js';

export function autoFinishMarketBase(market: JobMarketSyncEntry): Omit<JobMarketSyncEntry, 'skippedJobs' | 'expired'> {
    const { skippedJobs, expired, ...base } = market;
    void skippedJobs;
    void expired;
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

export function buildLiveMarkets(
    synced: { jobs: readonly JobOffer[]; markets: readonly JobMarketSyncEntry[] },
    runnable: readonly JobOffer[],
    allowedTypes: ReadonlySet<JobOffer['type']>,
    locks: JobLockRegistry,
    now: number,
): AutoFinishMarketResult[] {
    const runnableIds = new Set(runnable.map((job) => job.id));
    return synced.markets.map((market) => {
        const base = autoFinishMarketBase(market);
        if (!market.ok) return { ...base, jobs: [] };
        const jobs = synced.jobs
            .filter((job) => job.marketKey === market.marketKey)
            .map((job): AutoFinishJobResult => {
                const typeBlocked = !allowedTypes.has(job.type);
                const needsServer = !isServerlessJob(job.type);
                const lockUntil = locks.lockUntil(job.id);
                const locked = lockUntil !== undefined && lockUntil > now;
                const exhausted = locks.isRetryExhausted(job.id);
                const blocked = (needsServer && !job.serverId) || typeBlocked || locked || exhausted || !runnableIds.has(job.id);
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: exhausted ? 'retry' : blocked ? 'skipped' : 'pending',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    ...(needsServer && !job.serverId
                        ? { error: 'No target server for this job', code: 'NO_SERVER', stage: 'route' }
                        : typeBlocked
                            ? { error: 'Job type disabled for auto completion', code: 'TYPE_DISABLED', stage: 'select' }
                            : locked
                                ? { error: 'Minigame is locked', code: 'MINIGAME_FAILED', stage: 'minigame', lockExpiresAt: lockUntil }
                                : exhausted
                                    ? { error: 'Retry budget exhausted for this market reset', code: 'RETRY_EXHAUSTED', stage: 'retry', retryExhausted: true }
                                    : !runnableIds.has(job.id)
                                        ? { error: 'Already completed for this market reset', code: 'ALREADY_COMPLETED' }
                                        : {}),
                };
            });
        return {
            ...base,
            jobTotal: jobs.length,
            success: 0,
            failed: 0,
            pending: jobs.filter((job) => job.status === 'pending').length,
            jobs,
        };
    });
}

export interface FinalMarketInput {
    readonly synced: { jobs: readonly JobOffer[]; markets: readonly JobMarketSyncEntry[] };
    readonly allowedTypes: ReadonlySet<JobOffer['type']>;
    readonly doneIds: ReadonlySet<string>;
    readonly completedResets: Readonly<Record<string, string>>;
    readonly resetByMarket: ReadonlyMap<string, string | null>;
    readonly locks: JobLockRegistry;
    readonly outcomes: ReadonlyMap<string, JobOutcome>;
    readonly failedById: ReadonlyMap<string, AutoJobQueueFailure>;
    readonly stopped: boolean;
    readonly now: number;
}

/** Builds the per-market report shown by Auto Finish after a run. */
export function buildFinalMarkets(params: FinalMarketInput): AutoFinishMarketResult[] {
    const { synced, allowedTypes, doneIds, completedResets, resetByMarket, locks, outcomes, failedById, stopped, now } = params;
    return synced.markets.map((market) => {
        const base = autoFinishMarketBase(market);
        if (!market.ok) return { ...base, jobs: [] };
        const marketJobs = synced.jobs.filter((job) => job.marketKey === market.marketKey);
        const jobs: AutoFinishJobResult[] = marketJobs.map((job): AutoFinishJobResult => {
            const failure = failedById.get(job.id);
            const outcome = outcomes.get(job.id);
            if (!job.serverId && !isServerlessJob(job.type)) {
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
            if (!allowedTypes.has(job.type)) {
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
            if (doneIds.has(job.id)) {
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
            const resetAt = resetByMarket.get(job.marketKey) ?? null;
            if (resetAt !== null && completedResets[job.marketKey] === resetAt) {
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'skipped',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: 'Already completed for this market reset',
                    code: 'ALREADY_COMPLETED',
                    stage: 'select',
                };
            }
            const lockUntil = locks.lockUntil(job.id);
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
                    error: failure?.error.message ?? 'Job expired before completion',
                    code: 'EXPIRED',
                    stage: 'expire',
                };
            }
            if (outcome?.status === 'retry' && failure) {
                const exhausted = locks.isRetryExhausted(job.id);
                return {
                    jobId: job.id,
                    name: job.name,
                    serverName: job.serverName,
                    marketKey: job.marketKey,
                    status: 'retry',
                    rewardCredits: job.rewardCredits,
                    rewardReputation: job.rewardReputation,
                    error: exhausted ? 'Retry budget exhausted for this market reset' : failure.error.message,
                    code: exhausted ? 'RETRY_EXHAUSTED' : failure.error.detailCode ?? failure.error.code,
                    ...(exhausted ? { retryExhausted: true } : {}),
                    ...(failure.error.retryable !== undefined ? { retryable: failure.error.retryable } : {}),
                    ...(failure.error.retryAt !== undefined ? { retryAt: failure.error.retryAt } : {}),
                    ...(failure.error.lockExpiresAt !== undefined ? { lockExpiresAt: failure.error.lockExpiresAt } : {}),
                    ...(failure.error.stage !== undefined ? { stage: failure.error.stage } : {}),
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
                    error: failure.error.message,
                    code: failure.error.detailCode ?? failure.error.code,
                    ...(failure.error.retryable !== undefined ? { retryable: failure.error.retryable } : {}),
                    ...(failure.error.retryAt !== undefined ? { retryAt: failure.error.retryAt } : {}),
                    ...(failure.error.lockExpiresAt !== undefined ? { lockExpiresAt: failure.error.lockExpiresAt } : {}),
                    ...(failure.error.stage !== undefined ? { stage: failure.error.stage } : {}),
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
                    error: failure?.error.message ?? outcomeReasonText(outcome),
                    code: codeForOutcome(outcome, failure?.error.detailCode ?? failure?.error.code ?? 'SKIPPED'),
                    stage: failure?.error.stage ?? 'select',
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
}
