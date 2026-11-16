import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkSnapshot } from '../../domains/network/model.js';
import type { RawMarketSnapshot } from '../../contracts/market.js';
import type { ServerId } from '../../kernel/ids.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';
import type { GameError } from '../game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { NetworkSnapshotService } from './snapshot-service.js';
import type { RouteExecutor } from './route-executor.js';

export interface MarketSnapshotPort {
    fetchMarket(marketId: string): Promise<Result<RawMarketSnapshot, GameError>>;
}

export interface MarketSyncRequest {
    readonly marketId: string;
    readonly serverId: ServerId;
    readonly owner: string;
    readonly reason: string;
    readonly snapshot?: NetworkSnapshot;
}

export interface MarketSyncError {
    readonly code: 'SNAPSHOT_FAILED' | 'ROUTE_FAILED' | 'MARKET_FETCH_FAILED';
    readonly message: string;
}

export interface MarketSyncResult {
    readonly snapshot: NetworkSnapshot;
    readonly route: readonly { readonly id: ServerId; readonly name: string }[];
    readonly direct: boolean;
    readonly directError?: GameError;
    readonly market: RawMarketSnapshot;
}

export interface MarketSyncOptions {
    readonly retryDelayMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
}

function isTransientMarketFetchError(error: GameError): boolean {
    return error.code === 'GAME_TIMEOUT'
        || error.code === 'GAME_MARKET_FAILED'
        || /market-not-reachable|not[-\s]?reachable|timeout|timed out|socket|websocket|busy|processing|rate[\s-]?limit/i.test(error.message);
}

export class MarketSyncService {
    private readonly retryDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;

    constructor(
        private readonly snapshots: Pick<NetworkSnapshotService, 'get'>,
        private readonly executor: RouteExecutor,
        private readonly markets: MarketSnapshotPort,
        private readonly clock: Clock = new SystemClock(),
        options: MarketSyncOptions = {},
    ) {
        this.retryDelayMs = options.retryDelayMs ?? 500;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    async sync(request: MarketSyncRequest): Promise<Result<MarketSyncResult, MarketSyncError>> {
        const snapshot = request.snapshot
            ? ok(request.snapshot)
            : await this.snapshots.get(true);
        if (!snapshot.ok) return err({ code: 'SNAPSHOT_FAILED', message: snapshot.error.message });
        const graph = new NetworkGraph(snapshot.value);
        const route = await this.executor.execute(graph, request.serverId, {
            owner: request.owner,
            reason: request.reason,
            now: this.clock.now(),
            currentEndpoint: snapshot.value.endpointId ?? snapshot.value.homeId,
        });
        if (!route.ok || !route.route) {
            // Keep the route-specific reason in the message. The market panel
            // and debug log otherwise only show "All route attempts failed",
            // which hides whether a server was unreachable, in maintenance, or
            // missing the required HACK software.
            const details = route.attempts
                .map((attempt) => {
                    if (!attempt.error) return null;
                    const path = attempt.route.nodes.map((node) => node.name).join(' > ');
                    return `${path}: ${attempt.error.code} ${attempt.error.message}`.trim();
                })
                .filter((entry): entry is string => entry !== null)
                .slice(0, 2)
                .join(' | ');
            return err({
                code: 'ROUTE_FAILED',
                message: `${route.error?.message ?? 'No usable route'}${details ? ` — ${details}` : ''}`,
            });
        }
        let market = await this.markets.fetchMarket(request.marketId);
        for (let attempt = 0; attempt < 2 && !market.ok && isTransientMarketFetchError(market.error); attempt++) {
            await this.sleep(this.retryDelayMs);
            market = await this.markets.fetchMarket(request.marketId);
        }
        if (!market.ok) return err({ code: 'MARKET_FETCH_FAILED', message: market.error.message });
        return ok({
            snapshot: snapshot.value,
            route: route.route.nodes.map((node) => ({ id: node.id, name: node.name })),
            direct: route.direct === true,
            ...(route.directError ? { directError: route.directError } : {}),
            market: market.value,
        });
    }
}
