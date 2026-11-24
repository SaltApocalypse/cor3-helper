import type { AutoJobsMarket, AutoJobsSnapshot } from '../../contracts/auto-jobs.js';
import { jobIdentityKey } from '../../contracts/jobs.js';

/**
 * Merges an Auto Jobs snapshot update into the previous snapshot.
 *
 * Market information is fetched one market at a time. A partial update must not
 * erase jobs from markets that have not been refreshed yet, and a market that is
 * temporarily unreachable keeps its last known jobs, reset countdown and
 * freshness timestamp. The row is marked `stale` so the UI can say how old the
 * data is instead of silently showing it as current.
 */
export function mergeAutoJobsSnapshot(
    previous: AutoJobsSnapshot | null,
    update: AutoJobsSnapshot,
): AutoJobsSnapshot {
    const updatedMarkets = new Map(update.markets.map((market) => [market.marketKey, market]));
    const failedMarkets = new Set(update.markets.filter((market) => !market.ok).map((market) => market.marketKey));

    const refreshedJobs = update.jobs.filter((job) => !failedMarkets.has(job.marketKey));
    const seenJobKeys = new Set(refreshedJobs.map((job) => jobIdentityKey(job.marketKey, job.id)));
    const keptJobs = (previous?.jobs ?? []).filter((job) =>
        (!updatedMarkets.has(job.marketKey) || failedMarkets.has(job.marketKey))
        && !seenJobKeys.has(jobIdentityKey(job.marketKey, job.id)),
    );

    const markets: AutoJobsMarket[] = update.markets.map((market) => {
        if (market.ok) {
            // A successful payload without `nextJobsResetAt` must not erase a
            // known reset: the scheduler uses it to pick the next wake-up and
            // the completion state is keyed by it.
            const previousMarket = previous?.markets.find((entry) => entry.marketKey === market.marketKey);
            return {
                ...market,
                resetAt: market.resetAt ?? previousMarket?.resetAt ?? null,
                updatedAt: market.updatedAt ?? update.at,
                stale: false,
            };
        }
        const previousMarket = previous?.markets.find((entry) => entry.marketKey === market.marketKey);
        const updatedAt = market.updatedAt ?? previousMarket?.updatedAt ?? previous?.at;
        return {
            ...market,
            resetAt: market.resetAt ?? previousMarket?.resetAt ?? null,
            failed: market.failed ?? previousMarket?.failed ?? 0,
            expired: market.expired ?? previousMarket?.expired ?? 0,
            skippedJobs: market.skippedJobs?.length ? market.skippedJobs : previousMarket?.skippedJobs ?? [],
            ...(updatedAt !== undefined ? { updatedAt } : {}),
            stale: true,
        };
    });
    for (const market of previous?.markets ?? []) {
        if (!updatedMarkets.has(market.marketKey)) markets.push(market);
    }

    return {
        at: update.at,
        jobs: [...refreshedJobs, ...keptJobs],
        markets,
    };
}
