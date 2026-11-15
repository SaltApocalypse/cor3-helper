import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import type { Result } from '../../kernel/result.js';
import { ok } from '../../kernel/result.js';
import { asServerId } from '../../kernel/ids.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';
import type { GameError } from '../game/ports.js';
import type { NetworkSnapshotService } from '../network/snapshot-service.js';
import type { RouteExecutor } from '../network/route-executor.js';
import { filterValuableFiles, filterValuableLogs, type ValuableFile, type ValuableLog } from '../../domains/valuable/model.js';

export interface ValuableSearchHit {
    readonly id: string;
    readonly basePrice: number;
}

export interface ValuableSearchResult {
    readonly found: readonly ValuableSearchHit[];
    readonly searchPowerUsed?: number;
}

export interface SellableItem {
    readonly itemType: string;
    readonly itemId: string;
    readonly price: number;
    readonly reputation: number;
}

export interface SellableSnapshot {
    readonly items: readonly SellableItem[];
    readonly totalPrice: number;
    readonly totalRepGain: number;
}

export interface ValuableSaleOutcome {
    readonly sold: number;
    readonly credits: number;
    readonly reputation: number;
}

export interface ValuableServerPort {
    searchFiles(serverId: string): Promise<Result<ValuableSearchResult, GameError>>;
    searchLogs(serverId: string): Promise<Result<ValuableSearchResult, GameError>>;
    getFiles(serverId: string): Promise<Result<readonly ValuableFile[], GameError>>;
    getLogs(serverId: string): Promise<Result<readonly ValuableLog[], GameError>>;
    downloadFile(serverId: string, fileId: string): Promise<Result<void, GameError>>;
    downloadLog(serverId: string, seq: number): Promise<Result<void, GameError>>;
}

export interface ValuableMarketPort {
    getSellableItems(marketId: string): Promise<Result<SellableSnapshot, GameError>>;
    sellItems(marketId: string, items: readonly SellableItem[]): Promise<Result<ValuableSaleOutcome, GameError>>;
}

export interface ValuableServerAccessPort {
    ensureAccess(serverId: string, context?: { readonly serverTypeName?: string }): Promise<Result<void, GameError>>;
}

export interface ValuableMarketTarget {
    readonly label: string;
    readonly marketId: string;
    readonly routeServerId: string | null;
}

export interface ValuableSearchRequest {
    readonly owner: string;
    readonly reason?: string;
}

export interface ValuableSellRequest {
    readonly markets: readonly ValuableMarketTarget[];
    readonly owner: string;
    readonly reason?: string;
}

export interface ValuableFailure {
    readonly target: string;
    readonly message: string;
}

export type ValuablePhase = 'server' | 'download' | 'market' | 'sell';

export interface ValuableProgress {
    readonly phase: ValuablePhase;
    readonly target: string;
    readonly index: number;
    readonly total: number;
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
    readonly soldItems: number;
}

export interface ValuableSearchSummary {
    readonly stopped: boolean;
    readonly serversScanned: number;
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
    readonly failedDownloads: number;
    readonly serverFailures: readonly ValuableFailure[];
}

export interface ValuableSaleSummary {
    readonly stopped: boolean;
    readonly marketsChecked: number;
    readonly soldItems: number;
    readonly credits: number;
    readonly reputation: number;
    readonly marketFailures: readonly ValuableFailure[];
}

export type ValuablePreSearchHook = (serverId: string, serverTypeName: string | null) => Promise<Result<void, GameError>>;

export interface ValuableRunControl {
    readonly shouldStop?: () => boolean;
    readonly onProgress?: (progress: ValuableProgress) => void;
}

function routeLength(graph: NetworkGraph, serverId: string): number {
    const route = graph.findRoute(asServerId(serverId));
    return route.ok ? route.value.nodes.length : 0;
}

export class ValuableSellerService {
    constructor(
        private readonly snapshots: Pick<NetworkSnapshotService, 'get'>,
        private readonly executor: RouteExecutor,
        private readonly servers: ValuableServerPort,
        private readonly markets: ValuableMarketPort,
        private readonly clock: Clock = new SystemClock(),
        private readonly beforeSearch?: ValuablePreSearchHook,
        private readonly control: ValuableRunControl = {},
        private readonly access?: ValuableServerAccessPort,
    ) {}

    /**
     * Search every endpoint-capable, non-home server for valuable files and
     * logs, then download what the SEARCH ability reveals. Servers are visited
     * furthest-first, matching v1, so a closer server entering maintenance does
     * not invalidate the whole route late in the run.
     */
    async search(request: ValuableSearchRequest, control: ValuableRunControl = this.control): Promise<Result<ValuableSearchSummary, GameError>> {
        let stopped = false;
        let serversScanned = 0;
        let downloadedFiles = 0;
        let downloadedLogs = 0;
        let failedDownloads = 0;
        const serverFailures: ValuableFailure[] = [];

        const snapshot = await this.snapshots.get(true);
        if (!snapshot.ok) return { ok: false, error: { code: 'SNAPSHOT_FAILED', message: snapshot.error.message } };
        const graph = new NetworkGraph(snapshot.value);
        const targets = this.searchTargets(graph, snapshot.value);

        for (let index = 0; index < targets.length; index++) {
            if (control.shouldStop?.()) { stopped = true; break; }
            const server = targets[index]!;
            control.onProgress?.({
                phase: 'server', target: server.name, index: index + 1, total: targets.length,
                downloadedFiles, downloadedLogs, soldItems: 0,
            });
            const reached = await this.executor.execute(graph, server.id, {
                owner: request.owner,
                reason: request.reason ?? `valuable-search:${server.id}`,
                now: this.clock.now(),
            });
            if (!reached.ok) {
                serverFailures.push({ target: server.name, message: reached.error?.message ?? 'No route' });
                continue;
            }
            if (this.access) {
                const access = await this.access.ensureAccess(server.id, {
                    ...(server.typeName ? { serverTypeName: server.typeName } : {}),
                });
                if (!access.ok) {
                    serverFailures.push({ target: server.name, message: access.error.message });
                    continue;
                }
            }
            if (this.beforeSearch) {
                const ready = await this.beforeSearch(server.id, server.typeName);
                if (!ready.ok) {
                    serverFailures.push({ target: server.name, message: ready.error.message });
                    continue;
                }
            }
            serversScanned += 1;

            const fileSearch = await this.servers.searchFiles(server.id);
            const logSearch = await this.servers.searchLogs(server.id);
            if (!fileSearch.ok && !logSearch.ok) {
                serverFailures.push({
                    target: server.name,
                    message: `${fileSearch.error.message}; ${logSearch.error.message}`,
                });
                continue;
            }

            const files = await this.servers.getFiles(server.id);
            if (files.ok) {
                const found = new Set(fileSearch.ok
                    ? fileSearch.value.found.filter((hit) => hit.basePrice > 0).map((hit) => hit.id)
                    : []);
                const selected = filterValuableFiles(files.value).filter((file) => found.size === 0 || found.has(file.fileId));
                for (let fileIndex = 0; fileIndex < selected.length; fileIndex++) {
                    if (control.shouldStop?.()) { stopped = true; break; }
                    const file = selected[fileIndex]!;
                    control.onProgress?.({
                        phase: 'download', target: file.name, index: fileIndex + 1, total: selected.length,
                        downloadedFiles, downloadedLogs, soldItems: 0,
                    });
                    const downloaded = await this.servers.downloadFile(server.id, file.fileId);
                    if (downloaded.ok) downloadedFiles += 1;
                    else failedDownloads += 1;
                }
            } else {
                serverFailures.push({ target: server.name, message: files.error.message });
            }
            if (stopped) break;

            const logs = await this.servers.getLogs(server.id);
            if (logs.ok) {
                const found = new Set(logSearch.ok
                    ? logSearch.value.found.filter((hit) => hit.basePrice > 0).map((hit) => hit.id)
                    : []);
                const selected = filterValuableLogs(logs.value).filter((log) => found.size === 0 || found.has(String(log.seq)));
                for (let logIndex = 0; logIndex < selected.length; logIndex++) {
                    if (control.shouldStop?.()) { stopped = true; break; }
                    const log = selected[logIndex]!;
                    control.onProgress?.({
                        phase: 'download', target: log.message, index: logIndex + 1, total: selected.length,
                        downloadedFiles, downloadedLogs, soldItems: 0,
                    });
                    const downloaded = await this.servers.downloadLog(server.id, log.seq);
                    if (downloaded.ok) downloadedLogs += 1;
                    else failedDownloads += 1;
                }
            } else {
                serverFailures.push({ target: server.name, message: logs.error.message });
            }
            if (stopped) break;
        }

        return ok({
            stopped,
            serversScanned,
            downloadedFiles,
            downloadedLogs,
            failedDownloads,
            serverFailures,
        });
    }

    /**
     * Sell downloaded valuables market-by-market. Each market is queried once
     * and all of its sellable items are sold together, instead of walking every
     * downloaded file through every market.
     */
    async sell(request: ValuableSellRequest, control: ValuableRunControl = this.control): Promise<Result<ValuableSaleSummary, GameError>> {
        let stopped = false;
        let marketsChecked = 0;
        let soldItems = 0;
        let credits = 0;
        let reputation = 0;
        const marketFailures: ValuableFailure[] = [];

        const snapshot = await this.snapshots.get();
        if (!snapshot.ok) return { ok: false, error: { code: 'SNAPSHOT_FAILED', message: snapshot.error.message } };
        const graph = new NetworkGraph(snapshot.value);

        for (let marketIndex = 0; marketIndex < request.markets.length; marketIndex++) {
            if (control.shouldStop?.()) { stopped = true; break; }
            const market = request.markets[marketIndex]!;
            control.onProgress?.({
                phase: 'market', target: market.label, index: marketIndex + 1, total: request.markets.length,
                downloadedFiles: 0, downloadedLogs: 0, soldItems,
            });
            if (market.routeServerId) {
                const reached = await this.executor.execute(graph, asServerId(market.routeServerId), {
                    owner: request.owner,
                    reason: request.reason ?? `valuable-sell:${market.label}`,
                    now: this.clock.now(),
                });
                if (!reached.ok) {
                    marketFailures.push({ target: market.label, message: reached.error?.message ?? 'No route' });
                    continue;
                }
            }
            const sellable = await this.markets.getSellableItems(market.marketId);
            if (!sellable.ok) {
                marketFailures.push({ target: market.label, message: sellable.error.message });
                continue;
            }
            marketsChecked += 1;
            if (sellable.value.items.length === 0) continue;

            const fallbackCredits = sellable.value.items.length > 0
                ? sellable.value.totalPrice / sellable.value.items.length
                : 0;
            const fallbackReputation = sellable.value.items.length > 0
                ? sellable.value.totalRepGain / sellable.value.items.length
                : 0;

            for (let itemIndex = 0; itemIndex < sellable.value.items.length; itemIndex++) {
                if (control.shouldStop?.()) { stopped = true; break; }
                const item = sellable.value.items[itemIndex]!;
                control.onProgress?.({
                    phase: 'sell', target: item.itemId, index: itemIndex + 1, total: sellable.value.items.length,
                    downloadedFiles: 0, downloadedLogs: 0, soldItems,
                });
                const sold = await this.markets.sellItems(market.marketId, [item]);
                if (sold.ok && sold.value.sold > 0) {
                    soldItems += sold.value.sold;
                    credits += sold.value.credits > 0 ? sold.value.credits : item.price > 0 ? item.price : fallbackCredits;
                    reputation += sold.value.reputation > 0 ? sold.value.reputation : item.reputation > 0 ? item.reputation : fallbackReputation;
                }
            }
            if (stopped) break;
        }

        return ok({
            stopped,
            marketsChecked,
            soldItems,
            credits,
            reputation,
            marketFailures,
        });
    }

    private searchTargets(graph: NetworkGraph, snapshot: NetworkSnapshot): readonly NetworkServer[] {
        return [...snapshot.servers.values()]
            .filter((server) =>
                server.id !== snapshot.homeId
                && server.typeName !== 'Home'
                && server.endpointCapable
                && !server.maintenance.active)
            .sort((left, right) =>
                routeLength(graph, right.id) - routeLength(graph, left.id)
                || left.name.localeCompare(right.name));
    }
}
