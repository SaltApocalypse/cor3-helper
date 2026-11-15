import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkSnapshot } from '../../domains/network/model.js';
import type { ServerId } from '../../kernel/ids.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';
import type { GameError } from '../game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { NetworkSnapshotService } from './snapshot-service.js';
import type { RouteExecutor } from './route-executor.js';

export interface MarketRequestPort {
    requestMarket(marketId: string): Promise<Result<void, GameError>>;
}

export interface MarketPathRequest {
    readonly marketId: string;
    readonly serverId: ServerId;
    readonly owner: string;
    readonly reason: string;
}

export interface MarketPathError {
    readonly code: 'SNAPSHOT_FAILED' | 'ROUTE_FAILED' | 'MARKET_REQUEST_FAILED';
    readonly message: string;
}

export interface MarketPathResult {
    readonly snapshot: NetworkSnapshot;
    readonly route: readonly { readonly id: ServerId; readonly name: string }[];
}

export class MarketPathService {
    constructor(
        private readonly snapshots: Pick<NetworkSnapshotService, 'get'>,
        private readonly executor: RouteExecutor,
        private readonly markets: MarketRequestPort,
        private readonly clock: Clock = new SystemClock(),
    ) {}

    async reachAndRequest(request: MarketPathRequest): Promise<Result<MarketPathResult, MarketPathError>> {
        const snapshot = await this.snapshots.get(true);
        if (!snapshot.ok) {
            return err({ code: 'SNAPSHOT_FAILED', message: snapshot.error.message });
        }
        const graph = new NetworkGraph(snapshot.value);
        const route = await this.executor.execute(graph, request.serverId, {
            owner: request.owner,
            reason: request.reason,
            now: this.clock.now(),
            currentEndpoint: snapshot.value.endpointId,
        });
        if (!route.ok || !route.route) {
            return err({ code: 'ROUTE_FAILED', message: route.error?.message ?? 'No usable route' });
        }
        const market = await this.markets.requestMarket(request.marketId);
        if (!market.ok) {
            return err({ code: 'MARKET_REQUEST_FAILED', message: market.error.message });
        }
        return ok({
            snapshot: snapshot.value,
            route: route.route.nodes.map((node) => ({ id: node.id, name: node.name })),
        });
    }
}
