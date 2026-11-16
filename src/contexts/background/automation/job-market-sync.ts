import { JOB_MARKETS, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { MarketView } from '../../../domains/markets/model.js';
import { mapMarketSnapshotJobs, type SkippedJob } from '../../../application/auto-job/market-mapper.js';
import { mapMarketView } from '../../../application/markets/map.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { NetworkSnapshot } from '../../../domains/network/model.js';
import type { MarketSyncService } from '../../../application/network/market-sync.js';
import type { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import type { AutomationLogger, EventPublisher } from '../../../application/automation/ports.js';
import { asServerId } from '../../../kernel/ids.js';
import type { TabRequestPort } from './job-routing.js';

export interface JobMarketSyncEntry {
    readonly marketKey: string;
    readonly label: string;
    readonly ok: boolean;
    readonly skipped: number;
    readonly skippedJobs?: readonly SkippedJob[];
    readonly resetAt?: string | null;
    readonly jobTotal?: number;
    readonly success?: number;
    readonly failed?: number;
    readonly expired?: number;
    readonly pending?: number;
    readonly jobs?: readonly import('../../../contracts/auto-finish.js').AutoFinishJobResult[];
    readonly error?: string;
    readonly errorCode?: string;
}

export interface JobMarketSyncDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly marketSync: MarketSyncService;
    readonly marketCache: MarketCacheStore;
    readonly routing: { setEndpointIfNeeded(serverId: string, owner: string, reason: string): Promise<import('../../../kernel/result.js').Result<void, { readonly code: string; readonly message: string }>> };
    readonly tabs: TabRequestPort;
    readonly events: EventPublisher;
    readonly logger: AutomationLogger;
    readonly now?: () => number;
    readonly humanDelay?: (minMs?: number, maxMs?: number) => Promise<void>;
}

function defaultHumanDelay(minMs = 450, maxMs = 900): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs + 1))));
}

/**
 * A failed market is retried once in the same queued Auto Jobs operation.
 * Maintenance and other terminal states are not retried immediately; they are
 * left to the next scheduled cycle.
 */
export function isRetryableMarketFailure(entry: Pick<JobMarketSyncEntry, 'ok' | 'error' | 'errorCode'> | undefined): boolean {
    if (!entry || entry.ok) return false;
    const code = entry.errorCode ?? '';
    const message = entry.error ?? '';
    if (code === 'TARGET_IN_MAINTENANCE' || code === 'MAINTENANCE_BLOCKED' || /maintenance/i.test(message)) return false;
    return code === 'MARKET_FETCH_FAILED'
        || code === 'ROUTE_FAILED'
        || code === 'SNAPSHOT_FAILED'
        || code === 'NO_COR3_TAB'
        || /market-not-reachable|not[-\s]?reachable|timeout|timed out|socket|websocket|busy|processing|rate[\s-]?limit|connection|network|bridge/i.test(`${code} ${message}`);
}

export class JobMarketSync {
    private readonly now: () => number;
    private readonly humanDelay: (minMs?: number, maxMs?: number) => Promise<void>;

    constructor(private readonly deps: JobMarketSyncDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.humanDelay = deps.humanDelay ?? defaultHumanDelay;
    }

    syncOne(marketId: string, serverId: string, owner: string, reason: string) {
        return this.deps.marketSync.sync({
            marketId,
            serverId: asServerId(serverId),
            owner,
            reason,
        });
    }

    async syncAll(
        owner: string,
        reason: string,
        targets?: readonly JobMarketDefinition[],
        onMarket?: (partial: { readonly jobs: readonly JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] }) => void,
        shouldStop?: () => boolean,
    ): Promise<{ jobs: JobOffer[]; markets: JobMarketSyncEntry[] }> {
        const selected = targets ?? JOB_MARKETS;
        const jobs: JobOffer[] = [];
        const marketEntries = new Map<string, JobMarketSyncEntry>();
        const networkSnapshot = await this.deps.snapshots.get();
        const failed: JobMarketDefinition[] = [];
        const publish = (): void => {
            onMarket?.({ jobs: [...jobs], markets: [...marketEntries.values()] });
        };

        for (const market of selected) {
            if (shouldStop?.()) break;
            const synced = await this.syncMarketEntry(
                market,
                owner,
                reason,
                networkSnapshot.ok ? networkSnapshot.value : undefined,
                'initial',
            );
            jobs.push(...synced.jobs);
            marketEntries.set(market.key, synced.entry);
            if (!synced.entry.ok) failed.push(market);
            publish();
            if (selected.indexOf(market) < selected.length - 1) await this.humanDelay(350, 700);
        }

        // Retry a failed market once inside the same queued operation. The
        // initial pass deliberately keeps going when one market is slow, so a
        // transient timeout does not leave the UI stuck on "fetch failed".
        const retryable = failed.filter((market) => isRetryableMarketFailure(marketEntries.get(market.key)));
        if (retryable.length > 0 && !shouldStop?.()) {
            this.deps.logger.info('auto-jobs', `Retrying ${retryable.length} market(s) after fetch failure`, {
                markets: retryable.map((market) => market.key),
            });
            await this.humanDelay(1_500, 2_500);
            const refreshed = await this.deps.snapshots.get(true);
            const retrySnapshot = refreshed.ok ? refreshed.value : undefined;
            for (const market of retryable) {
                if (shouldStop?.()) break;
                const synced = await this.syncMarketEntry(
                    market,
                    owner,
                    `${reason}:retry`,
                    retrySnapshot,
                    'retry',
                );
                jobs.push(...synced.jobs);
                marketEntries.set(market.key, synced.entry);
                publish();
                if (retryable.indexOf(market) < retryable.length - 1) await this.humanDelay(350, 700);
            }
        }

        return { jobs, markets: [...marketEntries.values()] };
    }

    private async syncMarketEntry(
        market: JobMarketDefinition,
        owner: string,
        reason: string,
        snapshot: NetworkSnapshot | undefined,
        phase: 'initial' | 'retry',
    ): Promise<{ readonly entry: JobMarketSyncEntry; readonly jobs: readonly JobOffer[] }> {
        const synced = await this.deps.marketSync.sync({
            marketId: market.marketId,
            serverId: asServerId(market.routeServerId),
            owner,
            reason: `${reason}:${market.key}`,
            ...(snapshot ? { snapshot } : {}),
        });
        if (!synced.ok) {
            this.deps.logger.warn('auto-jobs', phase === 'retry' ? 'Market retry failed' : 'Market refresh failed', {
                market: market.key,
                label: market.label,
                code: synced.error.code,
                message: synced.error.message,
                attempt: phase,
            });
            return {
                entry: {
                    marketKey: market.key,
                    label: market.label,
                    ok: false,
                    skipped: 0,
                    error: synced.error.message,
                    errorCode: synced.error.code,
                },
                jobs: [],
            };
        }
        const mapped = mapMarketSnapshotJobs(synced.value.market, market.marketId, market.key, market.completionServerId ?? market.routeServerId);
        const view = mapMarketView(synced.value.market);
        if (view) {
            await this.deps.marketCache.set(market.marketId, view);
            this.deps.events.publish('market.reputation.updated', { marketId: market.marketId, credits: view.credits, reputation: view.reputation });
        }
        this.deps.logger.info('auto-jobs', phase === 'retry' ? 'Market retry complete' : 'Market refresh complete', {
            market: market.key,
            label: market.label,
            jobs: mapped.jobs.length,
            skipped: mapped.skipped,
            failed: mapped.failed,
            expired: mapped.expired,
            resetAt: mapped.resetAt ?? null,
            direct: synced.value.direct,
            ...(synced.value.directError ? {
                directError: `${synced.value.directError.code}: ${synced.value.directError.message}`,
            } : {}),
            route: synced.value.route.map((node) => node.name).join(' > '),
            attempt: phase,
        });
        return {
            entry: {
                marketKey: market.key,
                label: market.label,
                ok: true,
                skipped: mapped.skipped,
                failed: mapped.failed,
                expired: mapped.expired,
                skippedJobs: mapped.skippedJobs,
                resetAt: mapped.resetAt ?? null,
            },
            jobs: mapped.jobs,
        };
    }

    async fetchOptionsView(marketId: string): Promise<{ ok: true; value: Omit<MarketView, 'lots' | 'jobs' | 'recentJobs' | 'nextJobsResetAt'> } | { ok: false; error: { code: string; message: string } }> {
        const market = JOB_MARKETS.find((entry) => entry.marketId === marketId);
        if (market && market.key !== 'home') {
            const routed = await this.deps.routing.setEndpointIfNeeded(market.routeServerId, 'market-options', `market-options:${market.key}`);
            if (!routed.ok) return { ok: false, error: routed.error };
        }
        const tabId = await this.deps.tabs.findCor3Tab();
        if (tabId === null) return { ok: false, error: { code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' } };
        const response = await this.deps.tabs.send(tabId, { type: 'V2_MARKET_OPTIONS', marketId });
        const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } } | null;
        if (!candidate || candidate.ok !== true) {
            return {
                ok: false,
                error: {
                    code: typeof candidate?.error?.code === 'string' ? candidate.error.code : 'MARKET_OPTIONS_FAILED',
                    message: typeof candidate?.error?.message === 'string' ? candidate.error.message : 'Market options failed',
                },
            };
        }
        const view = mapMarketView({ options: candidate.value, lots: [], jobs: [] });
        if (!view) return { ok: false, error: { code: 'MARKET_INVALID', message: 'Market options failed schema validation' } };
        return {
            ok: true,
            value: {
                marketId: view.marketId,
                marketName: view.marketName,
                credits: view.credits,
                reputation: view.reputation,
            },
        };
    }

    async refreshCachedOptions(marketId: string): Promise<void> {
        const result = await this.fetchOptionsView(marketId);
        if (!result.ok) {
            this.deps.logger.warn('auto-jobs', 'Market options refresh failed', {
                marketId,
                code: result.error.code,
                message: result.error.message,
            });
            return;
        }
        const cached = await this.deps.marketCache.get(marketId);
        const view: MarketView = cached
            ? { ...cached.view, ...result.value }
            : {
                ...result.value,
                lots: [],
                jobs: [],
                recentJobs: [],
                nextJobsResetAt: null,
            };
        await this.deps.marketCache.set(marketId, view);
        this.deps.events.publish('market.reputation.updated', {
            marketId,
            credits: result.value.credits,
            reputation: result.value.reputation,
        });
    }
}
