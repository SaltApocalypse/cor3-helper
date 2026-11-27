import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import type { Result } from '../../kernel/result.js';
import { ok } from '../../kernel/result.js';
import { asServerId } from '../../kernel/ids.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import type { GameError } from '../game/ports.js';
import type { NetworkSnapshotService } from '../network/snapshot-service.js';
import type { RouteExecutor } from '../network/route-executor.js';
import { filterValuableFiles, filterValuableLogs, type ValuableFile, type ValuableLog } from '../../domains/valuable/model.js';
import type { MaintenanceSignalPort } from './maintenance-monitor.js';
import { isUpcomingMaintenance } from './maintenance.js';

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

export interface ValuableSearchOptions {
    /**
     * Force maintenance is a v1-parity special case: its searches must keep
     * flowing while other features wait out the game's rate-limit cooldown.
     */
    readonly bypassRateLimitCooldown?: boolean;
}

export interface ValuableServerPort {
    searchFiles(serverId: string, timeoutMs?: number, options?: ValuableSearchOptions): Promise<Result<ValuableSearchResult, GameError>>;
    searchLogs(serverId: string, timeoutMs?: number): Promise<Result<ValuableSearchResult, GameError>>;
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

export type ValuablePhase = 'server' | 'download' | 'market' | 'sell' | 'maintenance';

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

export interface ValuableForceMaintenanceRequest {
    readonly owner: string;
    readonly reason?: string;
    readonly serverIds: readonly string[];
}

export interface ValuableForceMaintenanceSummary {
    readonly stopped: boolean;
    readonly forcedServers: number;
    readonly failedServers: readonly ValuableFailure[];
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
}

export type ValuablePreSearchHook = (serverId: string, serverTypeName: string | null) => Promise<Result<void, GameError>>;

/**
 * v1 parity for the force loop: 50 attempts, a 15 s response window and a
 * human-like 1000-1500 ms pause between attempts. The shared network refresh and
 * download extras are deliberately not used here.
 */
const FORCE_MAINTENANCE_MAX_ATTEMPTS = 50;
const FORCE_MAINTENANCE_REQUEST_TIMEOUT_MS = 15_000;
const FORCE_MAINTENANCE_ATTEMPT_DELAY_MIN_MS = 1_000;
const FORCE_MAINTENANCE_ATTEMPT_DELAY_MAX_MS = 1_500;

function isAccessDenied(message: string): boolean {
    return /sai-access-denied|access[-_ ]?denied|no[-_ ]?access/i.test(message);
}

export interface ValuableRunControl {
    readonly shouldStop?: () => boolean;
    readonly onProgress?: (progress: ValuableProgress) => void;
    /**
     * Diagnostic trace for long-running operations. `debug` lines go to the
     * exported debug log only; `info`/`warn`/`error` are also written to the
     * visible run log so a stuck force run is diagnosable after the fact.
     */
    readonly onTrace?: (
        level: 'debug' | 'info' | 'warn' | 'error',
        message: string,
        data?: Readonly<Record<string, unknown>>,
    ) => void;
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
        private readonly beforeForce?: ValuablePreSearchHook,
        private readonly maintenance?: MaintenanceSignalPort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
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
            if (this.access && !reached.accessEnsured) {
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

    /**
     * Force selected upcoming servers into maintenance. v1 used repeated
     * `file.search-valuable` calls. This is deliberately a v1-parity special
     * case: no downloads, no periodic map refresh, v1 pacing and a rate-limit
     * cooldown bypass for its searches. The maintenance event (or an
     * access-recovery map refresh) ends the loop immediately.
     */
    async forceMaintenance(
        request: ValuableForceMaintenanceRequest,
        control: ValuableRunControl = this.control,
    ): Promise<Result<ValuableForceMaintenanceSummary, GameError>> {
        let stopped = false;
        let forcedServers = 0;
        const failedServers: ValuableFailure[] = [];
        // v1 used the cached map; a forced refresh is reserved for access
        // recovery. Refreshing every few attempts was the main source of
        // `get.map` traffic and "too many requests" during a force run.
        const snapshot = await this.snapshots.get();
        if (!snapshot.ok) return { ok: false, error: { code: 'SNAPSHOT_FAILED', message: snapshot.error.message } };
        const graph = new NetworkGraph(snapshot.value);
        const targets: NetworkServer[] = [];
        for (const id of request.serverIds) {
            const server = snapshot.value.servers.get(asServerId(id));
            if (!server) {
                failedServers.push({ target: id, message: 'Server not found' });
                continue;
            }
            if (!isUpcomingMaintenance(server)) {
                failedServers.push({ target: server.name, message: 'Not scheduled for upcoming maintenance' });
                continue;
            }
            targets.push(server);
        }
        targets.sort((left, right) =>
            routeLength(graph, right.id) - routeLength(graph, left.id)
            || left.name.localeCompare(right.name));
        if (targets.length === 0) {
            return ok({ stopped: false, forcedServers: 0, failedServers, downloadedFiles: 0, downloadedLogs: 0 });
        }
        const runStartedAt = this.clock.now();
        control.onTrace?.('info', `Force maintenance started on ${targets.length} server(s)`, {
            order: targets.map((target) => target.name),
            mapAgeMs: runStartedAt - snapshot.value.capturedAt,
        });

        // Reuse the reached endpoint between targets so consecutive servers on
        // the same path do not each pay a redundant `set.endpoint`.
        let lastReached: string | null = null;
        for (let index = 0; index < targets.length; index++) {
            if (control.shouldStop?.()) { stopped = true; break; }
            const server = targets[index]!;
            const serverStartedAt = this.clock.now();
            control.onProgress?.({
                phase: 'maintenance',
                target: server.name,
                index: index + 1,
                total: targets.length,
                downloadedFiles: 0,
                downloadedLogs: 0,
                soldItems: 0,
            });
            control.onTrace?.('debug', 'Force server started', {
                server: server.name,
                serverId: server.id,
                index: index + 1,
                total: targets.length,
            });

            const reached = await this.executor.execute(graph, server.id, {
                owner: request.owner,
                reason: request.reason ?? `valuable-force:${server.id}`,
                now: this.clock.now(),
                ...(lastReached !== null ? { currentEndpoint: asServerId(lastReached) } : {}),
            });
            if (!reached.ok) {
                const message = reached.error?.message ?? 'No route';
                failedServers.push({ target: server.name, message });
                control.onTrace?.('warn', `Force server unreachable: ${server.name}`, {
                    message,
                    elapsedMs: this.clock.now() - serverStartedAt,
                });
                continue;
            }
            lastReached = server.id;
            if (this.access && !reached.accessEnsured && server.id !== snapshot.value.homeId) {
                const access = await this.access.ensureAccess(server.id, {
                    ...(server.typeName ? { serverTypeName: server.typeName } : {}),
                });
                if (!access.ok) {
                    failedServers.push({ target: server.name, message: access.error.message });
                    control.onTrace?.('warn', `Force server access failed: ${server.name}`, {
                        message: access.error.message,
                    });
                    continue;
                }
            }
            if (this.beforeForce) {
                const ready = await this.beforeForce(server.id, server.typeName);
                if (!ready.ok) {
                    failedServers.push({ target: server.name, message: ready.error.message });
                    control.onTrace?.('warn', `Force server search loadout failed: ${server.name}`, {
                        message: ready.error.message,
                    });
                    continue;
                }
            }
            if (this.maintenance?.hasStarted(server.id)) {
                forcedServers += 1;
                this.maintenance.clear(server.id);
                control.onTrace?.('info', `Force server already in maintenance: ${server.name}`, {
                    elapsedMs: this.clock.now() - serverStartedAt,
                });
                continue;
            }

            let forced = false;
            let attemptsUsed = 0;
            let lastError = 'Maintenance did not start';
            for (let attempt = 0; attempt < FORCE_MAINTENANCE_MAX_ATTEMPTS; attempt++) {
                if (control.shouldStop?.()) { stopped = true; break; }
                if (this.maintenance?.hasStarted(server.id)) { forced = true; break; }
                attemptsUsed = attempt + 1;
                const attemptStartedAt = this.clock.now();
                const search = await this.searchFileWithMaintenance(server.id, FORCE_MAINTENANCE_REQUEST_TIMEOUT_MS);
                const elapsedMs = this.clock.now() - attemptStartedAt;
                if (search.kind === 'maintenance') {
                    control.onTrace?.('debug', 'Force search stopped by the maintenance event', {
                        server: server.name,
                        attempt: attemptsUsed,
                        elapsedMs,
                    });
                    forced = true;
                    break;
                }
                if (!search.result.ok) {
                    lastError = search.result.error.message;
                    if (isAccessDenied(search.result.error.message)) {
                        control.onTrace?.('warn', `Force search lost access: ${server.name}`, {
                            attempt: attemptsUsed,
                            message: search.result.error.message,
                        });
                        const refreshed = await this.snapshots.get(true);
                        if (refreshed.ok && this.serverInMaintenance(refreshed.value, server.id)) { forced = true; break; }
                        if (!this.access) continue;
                        const access = await this.access.ensureAccess(server.id, {
                            ...(server.typeName ? { serverTypeName: server.typeName } : {}),
                        });
                        if (!access.ok) { lastError = access.error.message; break; }
                        if (this.beforeForce) {
                            const ready = await this.beforeForce(server.id, server.typeName);
                            if (!ready.ok) { lastError = ready.error.message; break; }
                        }
                        continue;
                    }
                    const rateLimited = /too many requests|rate[\s-]?limit/i.test(search.result.error.message);
                    control.onTrace?.(rateLimited ? 'warn' : 'debug', 'Force search failed', {
                        server: server.name,
                        attempt: attemptsUsed,
                        code: search.result.error.code,
                        message: search.result.error.message,
                        rateLimited,
                        elapsedMs,
                    });
                    if (/sai-no-search-software|no[-_ ]?search[-_ ]?software|insufficient.*search/i.test(search.result.error.message)) break;
                } else {
                    control.onTrace?.('debug', 'Force search ok', {
                        server: server.name,
                        attempt: attemptsUsed,
                        found: search.result.value.found.length,
                        elapsedMs,
                    });
                }
                await this.sleep(this.forceAttemptDelayMs());
            }

            const serverElapsedMs = this.clock.now() - serverStartedAt;
            if (forced) {
                forcedServers += 1;
                this.maintenance?.clear(server.id);
                control.onTrace?.('info', `Force server entered maintenance: ${server.name}`, {
                    attempts: attemptsUsed,
                    elapsedMs: serverElapsedMs,
                });
            } else if (!stopped) {
                failedServers.push({ target: server.name, message: lastError });
                control.onTrace?.('warn', `Force server did not enter maintenance: ${server.name}`, {
                    attempts: attemptsUsed,
                    elapsedMs: serverElapsedMs,
                    message: lastError,
                });
            }
            if (stopped) break;
        }

        control.onTrace?.('info', `Force maintenance finished: ${forcedServers}/${targets.length} server(s)`, {
            forcedServers,
            failedServers: failedServers.length,
            elapsedMs: this.clock.now() - runStartedAt,
            stopped,
        });
        return ok({ stopped, forcedServers, failedServers, downloadedFiles: 0, downloadedLogs: 0 });
    }

    /** v1-style humanDelay: 1000-1500 ms between search attempts. */
    private forceAttemptDelayMs(): number {
        const span = FORCE_MAINTENANCE_ATTEMPT_DELAY_MAX_MS - FORCE_MAINTENANCE_ATTEMPT_DELAY_MIN_MS;
        return FORCE_MAINTENANCE_ATTEMPT_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
    }

    private async searchFileWithMaintenance(
        serverId: string,
        timeoutMs: number,
    ): Promise<{ readonly kind: 'search'; readonly result: Result<ValuableSearchResult, GameError> } | { readonly kind: 'maintenance' }> {
        const options: ValuableSearchOptions = { bypassRateLimitCooldown: true };
        if (!this.maintenance) {
            return { kind: 'search', result: await this.servers.searchFiles(serverId, timeoutMs, options) };
        }
        const search = this.servers.searchFiles(serverId, timeoutMs, options);
        const first = await Promise.race([
            search.then((result) => ({ kind: 'search' as const, result })),
            this.maintenance.waitForStarted(serverId, timeoutMs).then((started) => ({ kind: 'monitor' as const, started })),
        ]);
        if (first.kind === 'monitor') {
            if (first.started) return { kind: 'maintenance' };
            return { kind: 'search', result: await search };
        }
        return first;
    }

    private serverInMaintenance(snapshot: NetworkSnapshot, serverId: string): boolean {
        const server = snapshot.servers.get(asServerId(serverId));
        const endsAt = server?.maintenance.endsAt;
        return server?.maintenance.active === true
            || (typeof endsAt === 'string' && Number.isFinite(Date.parse(endsAt)) && Date.parse(endsAt) > Date.now());
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
