import type { NetworkGraph } from '../../domains/network/graph.js';
import type { RoutePlan } from '../../domains/network/model.js';
import type { ServerId } from '../../kernel/ids.js';
import type { Clock } from '../../kernel/clock.js';
import type { Result } from '../../kernel/result.js';
import type { GameError } from '../game/ports.js';
import type { EndpointLeasePort } from './endpoint-lease.js';
import type { EndpointMutexPort } from './endpoint-mutex.js';

export interface EndpointCommandPort {
    setEndpoint(serverId: ServerId): Promise<Result<void, GameError>>;
}

export interface ServerAccessContext {
    readonly serverTypeName?: string;
    readonly defenceRate?: number;
}

export interface ServerAccessPort {
    ensureAccess(serverId: ServerId, context?: ServerAccessContext): Promise<Result<void, GameError>>;
}

export interface RouteExecutionError {
    readonly code: 'LEASE_BUSY' | 'NO_ROUTE' | 'ROUTE_FAILED';
    readonly message: string;
    readonly attempts: readonly RouteAttempt[];
}

export interface RouteAttempt {
    readonly route: RoutePlan;
    readonly ok: boolean;
    readonly error?: GameError;
}

export interface RouteExecutionResult {
    readonly ok: boolean;
    readonly route?: RoutePlan;
    readonly attempts: readonly RouteAttempt[];
    readonly error?: RouteExecutionError;
}

export interface RouteExecutionOptions {
    readonly owner: string;
    readonly reason: string;
    readonly maxRoutes?: number;
    readonly now?: number;
    readonly currentEndpoint?: ServerId | null;
}

export class RouteExecutor {
    constructor(
        private readonly commands: EndpointCommandPort,
        private readonly access: ServerAccessPort,
        private readonly leases: EndpointLeasePort,
        private readonly clock: Clock,
        private readonly mutex?: EndpointMutexPort,
    ) {}

    async execute(
        graph: NetworkGraph,
        targetId: ServerId,
        options: RouteExecutionOptions,
    ): Promise<RouteExecutionResult> {
        if (this.mutex) return this.mutex.run(() => this.executeUnlocked(graph, targetId, options));
        return this.executeUnlocked(graph, targetId, options);
    }

    private async executeUnlocked(
        graph: NetworkGraph,
        targetId: ServerId,
        options: RouteExecutionOptions,
    ): Promise<RouteExecutionResult> {
        const routesResult = graph.findRoutes(targetId, options.maxRoutes ?? 3, options.now ?? this.clock.now());
        if (!routesResult.ok) {
            return {
                ok: false,
                attempts: [],
                error: { code: 'NO_ROUTE', message: routesResult.error.message, attempts: [] },
            };
        }

        const lease = this.leases.acquire(options.owner, options.reason);
        if (!lease.ok) {
            return {
                ok: false,
                attempts: [],
                error: { code: 'LEASE_BUSY', message: lease.error.message, attempts: [] },
            };
        }

        const attempts: RouteAttempt[] = [];
        try {
            for (const route of routesResult.value) {
                const attempt = await this.tryRoute(graph, route, options.currentEndpoint ?? null);
                attempts.push(attempt);
                if (attempt.ok) return { ok: true, route, attempts };
            }
            return {
                ok: false,
                attempts,
                error: {
                    code: 'ROUTE_FAILED',
                    message: 'All route attempts failed',
                    attempts,
                },
            };
        } finally {
            this.leases.release(options.owner);
        }
    }

    private async tryRoute(graph: NetworkGraph, route: RoutePlan, currentEndpoint: ServerId | null): Promise<RouteAttempt> {
        const intermediates = route.nodes.slice(1, -1);
        for (const intermediate of intermediates) {
            if (currentEndpoint === intermediate.id) continue;
            const end = await this.commands.setEndpoint(intermediate.id);
            if (!end.ok) return { route, ok: false, error: end.error };
            currentEndpoint = intermediate.id;
            const server = graph.getServer(intermediate.id);
            const access = await this.access.ensureAccess(intermediate.id, {
                ...(server?.typeName ? { serverTypeName: server.typeName } : {}),
            });
            if (!access.ok) return { route, ok: false, error: access.error };
        }
        const target = route.nodes[route.nodes.length - 1];
        if (!target) return { route, ok: false, error: { code: 'EMPTY_ROUTE', message: 'Route has no target' } };
        if (currentEndpoint === target.id) return { route, ok: true };
        const end = await this.commands.setEndpoint(target.id);
        if (!end.ok) return { route, ok: false, error: end.error };
        return { route, ok: true };
    }
}
