import { JOB_MARKETS, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { MarketView } from '../../../domains/markets/model.js';
import { mapMarketSnapshotJobs, type SkippedJob } from '../../../application/auto-job/market-mapper.js';
import { mapMarketView } from '../../../application/markets/map.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
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
        const markets: JobMarketSyncEntry[] = [];
        const networkSnapshot = await this.deps.snapshots.get();
        for (const market of selected) {
            if (shouldStop?.()) break;
            const synced = await this.deps.marketSync.sync({
                marketId: market.marketId,
                serverId: asServerId(market.routeServerId),
                owner,
                reason: `${reason}:${market.key}`,
                ...(networkSnapshot.ok ? { snapshot: networkSnapshot.value } : {}),
            });
            if (!synced.ok) {
                this.deps.logger.warn('auto-jobs', 'Market refresh failed', {
                    market: market.key,
                    label: market.label,
                    code: synced.error.code,
                    message: synced.error.message,
                });
                markets.push({ marketKey: market.key, label: market.label, ok: false, skipped: 0, error: synced.error.message });
            } else {
                const mapped = mapMarketSnapshotJobs(synced.value.market, market.marketId, market.key, market.completionServerId ?? market.routeServerId);
                const view = mapMarketView(synced.value.market);
                if (view) {
                    await this.deps.marketCache.set(market.marketId, view);
                    this.deps.events.publish('market.reputation.updated', { marketId: market.marketId, credits: view.credits, reputation: view.reputation });
                }
                jobs.push(...mapped.jobs);
                this.deps.logger.info('auto-jobs', 'Market refresh complete', {
                    market: market.key,
                    label: market.label,
                    jobs: mapped.jobs.length,
                    skipped: mapped.skipped,
                    failed: mapped.failed,
                    expired: mapped.expired,
                    resetAt: mapped.resetAt ?? null,
                    route: synced.value.route.map((node) => node.name).join(' > '),
                });
                markets.push({
                    marketKey: market.key,
                    label: market.label,
                    ok: true,
                    skipped: mapped.skipped,
                    failed: mapped.failed,
                    expired: mapped.expired,
                    skippedJobs: mapped.skippedJobs,
                    resetAt: mapped.resetAt ?? null,
                });
            }
            onMarket?.({ jobs: [...jobs], markets: [...markets] });
            if (selected.indexOf(market) < selected.length - 1) await this.humanDelay(350, 700);
        }
        return { jobs, markets };
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
