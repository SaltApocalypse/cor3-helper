import type { NetworkGraph, NetworkError } from '../../domains/network/graph.js';
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
    readonly directError?: GameError;
}

export interface RouteAttempt {
    readonly route: RoutePlan;
    readonly ok: boolean;
    readonly error?: GameError;
    /** Last endpoint that was successfully reached during this attempt. */
    readonly reached?: ServerId;
}

export interface RouteExecutionResult {
    readonly ok: boolean;
    readonly route?: RoutePlan;
    readonly attempts: readonly RouteAttempt[];
    readonly error?: RouteExecutionError;
    /** True when the target was reached without path-through. */
    readonly direct?: boolean;
    /** True when target access was already ensured by the executor. */
    readonly accessEnsured?: boolean;
    /** Direct target failure, retained when path-through succeeds. */
    readonly directError?: GameError;
}

export interface RouteExecutionOptions {
    readonly owner: string;
    readonly reason: string;
    readonly maxRoutes?: number;
    readonly maxAttempts?: number;
    readonly now?: number;
    readonly currentEndpoint?: ServerId | null;
    /** Skip the direct target attempt when the caller already tried it. */
    readonly skipDirect?: boolean;
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
        const lease = this.leases.acquire(options.owner, options.reason);
        if (!lease.ok) {
            return {
                ok: false,
                attempts: [],
                error: { code: 'LEASE_BUSY', message: lease.error.message, attempts: [] },
            };
        }

        const now = options.now ?? this.clock.now();
        const attempts: RouteAttempt[] = [];
        let currentEndpoint = options.currentEndpoint ?? null;
        let directError: GameError | undefined;

        try {
            // Most targets are reachable with a single set.endpoint. Try that
            // before planning a path-through: it avoids unnecessary HACK
            // loadouts and also works when the network snapshot is stale or
            // does not contain the target yet.
            if (!options.skipDirect) {
                const direct = await this.tryDirect(graph, targetId, currentEndpoint);
                if (direct.ok) {
                    return {
                        ok: true,
                        route: direct.route,
                        attempts: [],
                        direct: true,
                        ...(direct.accessEnsured ? { accessEnsured: true } : {}),
                    };
                }
                directError = direct.error;
            }

            const starts: ServerId[] = [];
            const triedStarts = new Set<ServerId>();
            const enqueueStart = (id: ServerId | null, front = false): void => {
                if (!id || triedStarts.has(id)) return;
                triedStarts.add(id);
                if (front) starts.unshift(id);
                else starts.push(id);
            };
            enqueueStart(currentEndpoint);
            enqueueStart(graph.getHomeId());

            const maxRoutes = options.maxRoutes ?? 3;
            const maxAttempts = options.maxAttempts ?? Math.max(maxRoutes, maxRoutes * 2);
            let routeError: NetworkError | null = null;

            while (starts.length > 0 && attempts.length < maxAttempts) {
                const start = starts.shift();
                if (!start) break;
                const routesResult = graph.findRoutesFrom(start, targetId, maxRoutes, now);
                if (!routesResult.ok) {
                    routeError ??= routesResult.error;
                    continue;
                }
                for (const route of routesResult.value) {
                    if (attempts.length >= maxAttempts) break;
                    const attempt = await this.tryRoute(graph, route, currentEndpoint, start);
                    attempts.push(attempt);
                    if (attempt.reached) {
                        currentEndpoint = attempt.reached;
                        // Continue the remaining fallbacks from the last node
                        // that was actually reached instead of restarting at home.
                        if (attempt.reached !== start) enqueueStart(attempt.reached, true);
                    }
                    if (attempt.ok) {
                        return {
                            ok: true,
                            route,
                            attempts,
                            direct: false,
                            ...(directError ? { directError } : {}),
                        };
                    }
                }
            }

            const directSuffix = directError ? ` (direct: ${directError.code} ${directError.message})` : '';
            if (attempts.length === 0) {
                return {
                    ok: false,
                    attempts,
                    error: {
                        code: 'NO_ROUTE',
                        message: `${routeError?.message ?? 'No route'}${directSuffix}`,
                        attempts,
                        ...(directError ? { directError } : {}),
                    },
                };
            }
            return {
                ok: false,
                attempts,
                error: {
                    code: 'ROUTE_FAILED',
                    message: `All route attempts failed${directSuffix}`,
                    attempts,
                    ...(directError ? { directError } : {}),
                },
            };
        } finally {
            this.leases.release(options.owner);
        }
    }

    private async tryDirect(
        graph: NetworkGraph,
        targetId: ServerId,
        currentEndpoint: ServerId | null,
    ): Promise<{ readonly ok: true; readonly route: RoutePlan; readonly accessEnsured?: boolean } | { readonly ok: false; readonly error: GameError }> {
        if (currentEndpoint === targetId) {
            // Already being at the endpoint is not enough after a session/tab
            // change: the server login/access may have been lost while the
            // network snapshot still points at the target.
            const server = graph.getServer(targetId);
            const access = await this.access.ensureAccess(targetId, {
                ...(server?.typeName ? { serverTypeName: server.typeName } : {}),
            });
            if (!access.ok) return { ok: false, error: access.error };
            return { ok: true, route: this.directRoute(graph, currentEndpoint, targetId), accessEnsured: true };
        }
        const direct = await this.commands.setEndpoint(targetId);
        if (direct.ok) {
            return { ok: true, route: this.directRoute(graph, currentEndpoint, targetId) };
        }
        return { ok: false, error: direct.error };
    }

    private directRoute(graph: NetworkGraph, currentEndpoint: ServerId | null, targetId: ServerId): RoutePlan {
        const nodes = [];
        if (currentEndpoint && currentEndpoint !== targetId) {
            nodes.push({ id: currentEndpoint, name: graph.getServer(currentEndpoint)?.name ?? currentEndpoint });
        }
        nodes.push({ id: targetId, name: graph.getServer(targetId)?.name ?? targetId });
        return { nodes, edgeIds: [], hiddenEdgeCount: 0, maintenanceFree: true, blocker: null };
    }

    private async tryRoute(
        graph: NetworkGraph,
        route: RoutePlan,
        currentEndpoint: ServerId | null,
        startId: ServerId,
    ): Promise<RouteAttempt> {
        let current = currentEndpoint;
        let reached = current ?? undefined;

        // A non-home fallback starts from the last reachable node. Anchor the
        // endpoint there before walking the new route. Home is only a planning
        // anchor; setting it again would add an unnecessary command.
        if (startId !== graph.getHomeId() && current !== startId) {
            const setStart = await this.commands.setEndpoint(startId);
            if (!setStart.ok) {
                return {
                    route,
                    ok: false,
                    error: setStart.error,
                    ...(reached ? { reached } : {}),
                };
            }
            current = startId;
            reached = startId;
        }

        const intermediates = route.nodes.slice(1, -1);
        for (const intermediate of intermediates) {
            if (current === intermediate.id) continue;
            const end = await this.commands.setEndpoint(intermediate.id);
            if (!end.ok) {
                return {
                    route,
                    ok: false,
                    error: end.error,
                    ...(reached ? { reached } : {}),
                };
            }
            current = intermediate.id;
            reached = intermediate.id;
            const server = graph.getServer(intermediate.id);
            const access = await this.access.ensureAccess(intermediate.id, {
                ...(server?.typeName ? { serverTypeName: server.typeName } : {}),
            });
            if (!access.ok) {
                return { route, ok: false, error: access.error, reached: current };
            }
        }

        const target = route.nodes[route.nodes.length - 1];
        if (!target) {
            return {
                route,
                ok: false,
                error: { code: 'EMPTY_ROUTE', message: 'Route has no target' },
                ...(reached ? { reached } : {}),
            };
        }
        if (current === target.id) return { route, ok: true, ...(reached ? { reached } : {}) };
        const end = await this.commands.setEndpoint(target.id);
        if (!end.ok) {
            return {
                route,
                ok: false,
                error: end.error,
                ...(reached ? { reached } : {}),
            };
        }
        return { route, ok: true, reached: target.id };
    }
}
