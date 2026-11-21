import { jobMarketByKey, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { mapMarketSnapshotJobs } from '../../../application/auto-job/market-mapper.js';
import type { AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { JobMarketSync, JobMarketSyncEntry } from './job-market-sync.js';

export interface JobSnapshotSyncDeps {
    readonly markets: Pick<JobMarketSync, 'syncAll' | 'syncOne' | 'reconcileMarketSnapshot'>;
    readonly snapshot: () => AutoJobsSnapshot | null;
    readonly publishSnapshot: (update: AutoJobsSnapshot) => void;
    readonly now: () => number;
}

export async function syncAllJobMarkets(
    deps: JobSnapshotSyncDeps,
    owner: string,
    reason: string,
    targets?: readonly JobMarketDefinition[],
): Promise<{ readonly jobs: readonly JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] }> {
    const synced = await deps.markets.syncAll(owner, reason, targets);
    deps.publishSnapshot({ at: deps.now(), jobs: synced.jobs, markets: synced.markets });
    return synced;
}

export async function syncJobMarket(
    deps: JobSnapshotSyncDeps,
    request: {
        readonly marketId: string;
        readonly marketKey: string;
        readonly serverId: string;
        readonly owner: string;
        readonly reason: string;
    },
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
    const result = await deps.markets.syncOne(request.marketId, request.serverId, request.owner, request.reason);
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
    const market = jobMarketByKey(request.marketKey);
    const completionServerId = market ? market.completionServerId ?? request.serverId : request.serverId;
    const mapped = mapMarketSnapshotJobs(result.value.market, request.marketId, request.marketKey, completionServerId);
    const reconciliation = await deps.markets.reconcileMarketSnapshot({
        marketKey: request.marketKey,
        resetAt: mapped.resetAt ?? null,
        observedAt: deps.now(),
        jobs: mapped.jobs,
        skippedJobs: mapped.skippedJobs,
    });
    const previous = deps.snapshot();
    deps.publishSnapshot({
        at: deps.now(),
        jobs: [
            ...(previous?.jobs.filter((job) => job.marketKey !== request.marketKey) ?? []),
            ...mapped.jobs,
        ],
        markets: [
            ...(previous?.markets.filter((entry) => entry.marketKey !== request.marketKey) ?? []),
            {
                marketKey: request.marketKey,
                label: market?.label ?? request.marketKey,
                ok: true,
                skipped: mapped.skipped,
                failed: mapped.failed,
                expired: mapped.expired,
                skippedJobs: mapped.skippedJobs,
                resetAt: mapped.resetAt ?? null,
                updatedAt: deps.now(),
                stale: false,
                ...(reconciliation ? { reconciliationStatus: reconciliation.storeStatus } : {}),
            },
        ],
    });
    return {
        ok: true,
        value: {
            route: result.value.route,
            jobs: mapped.jobs,
            skipped: mapped.skipped,
            failed: mapped.failed,
            skippedJobs: mapped.skippedJobs,
            resetAt: mapped.resetAt ?? null,
            ...(reconciliation ? { reconciliationStatus: reconciliation.storeStatus } : {}),
        },
    };
}
