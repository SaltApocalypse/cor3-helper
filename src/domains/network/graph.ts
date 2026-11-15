import type { EdgeId, ServerId } from '../../kernel/ids.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { NetworkServer, NetworkSnapshot, RouteNode, RoutePlan } from './model.js';

export type NetworkErrorCode =
    | 'UNKNOWN_TARGET'
    | 'TARGET_IN_MAINTENANCE'
    | 'MAINTENANCE_BLOCKED'
    | 'NO_ROUTE';

export interface NetworkError {
    readonly code: NetworkErrorCode;
    readonly message: string;
    readonly blockerName?: string;
}

interface Neighbor {
    readonly to: ServerId;
    readonly edgeId: EdgeId;
    readonly hidden: boolean;
}

interface FoundPath {
    readonly nodes: ServerId[];
    readonly edgeIds: EdgeId[];
    readonly hiddenCount: number;
}

export interface RouteCheck {
    readonly blocked: boolean;
    readonly route: RoutePlan | null;
    readonly blockerName: string | null;
}

function maintenanceActive(server: NetworkServer, now: number): boolean {
    if (!server.maintenance.active) return false;
    if (!server.maintenance.endsAt) return true;
    const endsAt = new Date(server.maintenance.endsAt).getTime();
    return Number.isFinite(endsAt) ? endsAt > now : true;
}

function reconstruct(
    target: ServerId,
    parent: Map<ServerId, { readonly from: ServerId; readonly edgeId: EdgeId; readonly hidden: boolean }>,
    servers: ReadonlyMap<ServerId, NetworkServer>,
): FoundPath | null {
    const nodes: ServerId[] = [];
    const edgeIds: EdgeId[] = [];
    let hiddenCount = 0;
    let current = target;
    while (true) {
        nodes.unshift(current);
        const entry = parent.get(current);
        if (!entry) break;
        edgeIds.unshift(entry.edgeId);
        if (entry.hidden) hiddenCount++;
        current = entry.from;
    }
    if (nodes.length === 0) return null;
    for (const id of nodes) {
        if (!servers.has(id)) return null;
    }
    return { nodes, edgeIds, hiddenCount };
}

/**
 * Shortest-path graph over a NetworkSnapshot.
 * BFS is intentional here: the current graph is unweighted and small. Route
 * alternatives will be added by the router/executor only when needed.
 */
export class NetworkGraph {
    private readonly servers: ReadonlyMap<ServerId, NetworkServer>;
    private readonly adjacency = new Map<ServerId, Neighbor[]>();
    private readonly homeId: ServerId;

    constructor(private readonly snapshot: NetworkSnapshot) {
        this.servers = snapshot.servers;
        this.homeId = snapshot.homeId;
        for (const server of snapshot.servers.values()) this.adjacency.set(server.id, []);
        for (const edge of snapshot.edges) {
            this.adjacency.get(edge.a)?.push({ to: edge.b, edgeId: edge.id, hidden: edge.hidden });
            this.adjacency.get(edge.b)?.push({ to: edge.a, edgeId: edge.id, hidden: edge.hidden });
        }
    }

    getServer(id: ServerId): NetworkServer | null {
        return this.servers.get(id) ?? null;
    }

    getHomeId(): ServerId {
        return this.homeId;
    }

    getSnapshot(): NetworkSnapshot {
        return this.snapshot;
    }

    findRoute(targetId: ServerId, now = Date.now()): Result<RoutePlan, NetworkError> {
        const target = this.servers.get(targetId);
        if (!target) return err({ code: 'UNKNOWN_TARGET', message: `Unknown target: ${targetId}` });
        if (maintenanceActive(target, now)) {
            return err({
                code: 'TARGET_IN_MAINTENANCE',
                message: `${target.name} is in maintenance`,
                blockerName: target.name,
            });
        }

        const path = this.bfs(targetId, true, now, new Set<EdgeId>());
        if (path) return ok(this.toPlan(path));
        const unfiltered = this.bfs(targetId, false, now, new Set<EdgeId>());
        if (!unfiltered) {
            return err({ code: 'NO_ROUTE', message: `No route to ${target.name}` });
        }
        const blocker = unfiltered.nodes
            .slice(0, -1)
            .map((id) => this.servers.get(id))
            .find((server) => server !== undefined && maintenanceActive(server, now));
        return err({
            code: 'MAINTENANCE_BLOCKED',
            message: blocker ? `${blocker.name} is in maintenance` : 'Route blocked by maintenance',
            ...(blocker ? { blockerName: blocker.name } : {}),
        });
    }

    /**
     * Returns the shortest route plus alternatives discovered by removing one
     * edge from the best route and re-running BFS. This is deliberately bounded:
     * the route executor should only need a small number of fallbacks.
     */
    findRoutes(targetId: ServerId, limit = 3, now = Date.now()): Result<RoutePlan[], NetworkError> {
        const first = this.findRoute(targetId, now);
        if (!first.ok) return first;
        const routes = [first.value];
        const seen = new Set([routeKey(first.value)]);
        for (const edgeId of first.value.edgeIds) {
            if (routes.length >= limit) break;
            const path = this.bfs(targetId, true, now, new Set<EdgeId>([edgeId]));
            if (!path) continue;
            const plan = this.toPlan(path);
            const key = routeKey(plan);
            if (seen.has(key)) continue;
            seen.add(key);
            routes.push(plan);
        }
        return ok(routes);
    }

    checkPath(targetId: ServerId, now = Date.now()): RouteCheck {
        const result = this.findRoute(targetId, now);
        if (result.ok) return { blocked: false, route: result.value, blockerName: null };
        return {
            blocked: true,
            route: null,
            blockerName: result.error.blockerName ?? null,
        };
    }

    private bfs(targetId: ServerId, skipMaintenance: boolean, now: number, forbidden: ReadonlySet<EdgeId>): FoundPath | null {
        if (targetId === this.homeId) return { nodes: [this.homeId], edgeIds: [], hiddenCount: 0 };
        const queue: ServerId[] = [this.homeId];
        const visited = new Set<ServerId>([this.homeId]);
        const parent = new Map<ServerId, { readonly from: ServerId; readonly edgeId: EdgeId; readonly hidden: boolean }>();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current) break;
            for (const neighbor of this.adjacency.get(current) ?? []) {
                if (forbidden.has(neighbor.edgeId)) continue;
                if (visited.has(neighbor.to)) continue;
                if (skipMaintenance && neighbor.to !== targetId) {
                    const server = this.servers.get(neighbor.to);
                    if (server && maintenanceActive(server, now)) continue;
                }
                visited.add(neighbor.to);
                parent.set(neighbor.to, { from: current, edgeId: neighbor.edgeId, hidden: neighbor.hidden });
                if (neighbor.to === targetId) return reconstruct(targetId, parent, this.servers);
                queue.push(neighbor.to);
            }
        }
        return null;
    }

    private toPlan(path: FoundPath): RoutePlan {
        const nodes: RouteNode[] = path.nodes.map((id) => {
            const server = this.servers.get(id);
            return { id, name: server?.name ?? id };
        });
        return {
            nodes,
            edgeIds: path.edgeIds,
            hiddenEdgeCount: path.hiddenCount,
            maintenanceFree: true,
            blocker: null,
        };
    }
}

function routeKey(route: RoutePlan): string {
    return route.edgeIds.join('|');
}
