import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import { mapMarketSnapshotJobs } from '../../../application/auto-job/market-mapper.js';
import type { DismissFailedJobsService } from '../../../application/auto-job/dismiss.js';
import type { MarketSyncService } from '../../../application/network/market-sync.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { RunLogSink } from '../../../application/automation/ports.js';
import { withSnapshotEndpoint, type NetworkSnapshot } from '../../../domains/network/model.js';
import { asServerId } from '../../../kernel/ids.js';

export interface DismissFailedJobsSummary {
    readonly dismissed: number;
    readonly failed: number;
    readonly markets: readonly string[];
    readonly errors: readonly string[];
}

export interface DismissFailedJobsDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly marketSync: MarketSyncService;
    readonly service: DismissFailedJobsService;
    readonly publishSnapshot: (update: AutoJobsSnapshot) => void;
    readonly runLogs: RunLogSink;
    readonly now?: () => number;
}

/** Dismisses game-reported failed/expired jobs and refreshes the affected markets. */
export class FailedJobDismisser {
    private readonly now: () => number;

    constructor(private readonly deps: DismissFailedJobsDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    async run(
        owner: string,
        reason: string,
        marketKeys?: readonly string[],
        shouldStop: () => boolean = () => false,
        runId?: string,
        skipIds: ReadonlySet<string> = new Set(),
    ): Promise<DismissFailedJobsSummary> {
        const selected = marketKeys && marketKeys.length > 0
            ? JOB_MARKETS.filter((market) => marketKeys.includes(market.key))
            : JOB_MARKETS;
        const networkSnapshot = await this.deps.snapshots.get();
        let currentSnapshot: NetworkSnapshot | undefined = networkSnapshot.ok ? networkSnapshot.value : undefined;
        let dismissed = 0;
        let failed = 0;
        const markets: string[] = [];
        const errors: string[] = [];
        for (const market of selected) {
            if (shouldStop()) break;
            const serverId = market.completionServerId ?? market.routeServerId;
            const synced = await this.deps.marketSync.sync({
                marketId: market.marketId,
                serverId: asServerId(serverId),
                owner,
                reason: `${reason}:${market.key}:scan`,
                ...(currentSnapshot ? { snapshot: currentSnapshot } : {}),
            });
            if (!synced.ok) {
                // A failed route still reports the last confirmed endpoint, so
                // the next market starts from where this one actually stopped.
                if (synced.error.finalEndpoint && currentSnapshot) {
                    currentSnapshot = withSnapshotEndpoint(currentSnapshot, synced.error.finalEndpoint);
                }
                errors.push(`${market.label}: ${synced.error.message}`);
                this.deps.publishSnapshot({
                    at: this.now(),
                    jobs: [],
                    markets: [{
                        marketKey: market.key,
                        label: market.label,
                        ok: false,
                        skipped: 0,
                        failed: 0,
                        skippedJobs: [],
                        error: synced.error.message,
                        errorCode: synced.error.code,
                    }],
                });
                continue;
            }
            currentSnapshot = synced.value.finalEndpoint
                ? withSnapshotEndpoint(synced.value.snapshot, synced.value.finalEndpoint)
                : synced.value.snapshot;
            const mapped = mapMarketSnapshotJobs(synced.value.market, market.marketId, market.key, serverId);
            this.deps.publishSnapshot({
                at: this.now(),
                jobs: mapped.jobs,
                markets: [{
                    marketKey: market.key,
                    label: market.label,
                    ok: true,
                    skipped: mapped.skipped,
                    failed: mapped.failed,
                    expired: mapped.expired,
                    skippedJobs: mapped.skippedJobs,
                    resetAt: mapped.resetAt ?? null,
                }],
            });
            const failedJobs = mapped.skippedJobs.filter((job) =>
                (job.status === 'failed' || job.expired === true) && !skipIds.has(job.id));
            if (failedJobs.length === 0) continue;
            const outcome = await this.deps.service.run(failedJobs.map((job) => ({
                id: job.id,
                name: job.name,
                marketId: market.marketId,
                marketKey: market.key,
            })), {
                shouldStop,
                onResult: (job, result) => {
                    this.deps.runLogs.add(runId ?? `${reason}-${this.now()}`, result.ok ? 'info' : 'warn', 'dismiss-failed',
                        result.ok
                            ? `Dismissed ${job.name} (${market.label})`
                            : `Failed to dismiss ${job.name} (${market.label}): ${result.error.message}`);
                },
            });
            dismissed += outcome.dismissed.length;
            failed += outcome.failed.length;
            markets.push(market.label);
            const refreshed = await this.deps.marketSync.sync({
                marketId: market.marketId,
                serverId: asServerId(serverId),
                owner,
                reason: `${reason}:${market.key}:refresh`,
                ...(currentSnapshot ? { snapshot: currentSnapshot } : {}),
            });
            if (refreshed.ok) {
                currentSnapshot = refreshed.value.finalEndpoint
                    ? withSnapshotEndpoint(refreshed.value.snapshot, refreshed.value.finalEndpoint)
                    : refreshed.value.snapshot;
                const after = mapMarketSnapshotJobs(refreshed.value.market, market.marketId, market.key, serverId);
                this.deps.publishSnapshot({
                    at: this.now(),
                    jobs: after.jobs,
                    markets: [{
                        marketKey: market.key,
                        label: market.label,
                        ok: true,
                        skipped: after.skipped,
                        failed: after.failed,
                        skippedJobs: after.skippedJobs,
                        resetAt: after.resetAt ?? null,
                    }],
                });
            } else {
                if (refreshed.error.finalEndpoint && currentSnapshot) {
                    currentSnapshot = withSnapshotEndpoint(currentSnapshot, refreshed.error.finalEndpoint);
                }
                errors.push(`${market.label} refresh: ${refreshed.error.message}`);
            }
        }
        return { dismissed, failed, markets, errors };
    }
}
