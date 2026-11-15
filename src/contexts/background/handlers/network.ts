import { z } from 'zod';
import { summarizeNetworkSnapshot } from '../../../application/network/snapshot-summary.js';
import { asServerId } from '../../../kernel/ids.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';

export interface NetworkHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
}

const discoveryOptionsSchema = z.object({
    maxDurationMs: z.number().int().positive().optional(),
    maxIps: z.number().int().positive().optional(),
    restart: z.boolean().optional(),
}).strict();

const marketPathSchema = z.object({
    marketId: z.string().min(1),
    serverId: z.string().min(1),
    owner: z.string().min(1).default('market'),
    reason: z.string().min(1).default('market-path'),
}).strict();

export function registerNetworkHandlers(server: CoreRuntime['server'], deps: NetworkHandlerDeps): void {
    const { core, game } = deps;
    server.register('network.map', z.object({}).strict(), async () => {
        const result = await game.networkMap.getMap();
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('network.summary', z.object({}).strict(), async () => {
        const result = await game.snapshots.get();
        if (!result.ok) return { ok: false, error: { code: result.error.code, message: result.error.message } };
        return ok(summarizeNetworkSnapshot(result.value));
    });
    server.register('network.diagnostics', z.object({}).strict(), async () => {
        const snapshot = await game.snapshots.get();
        if (!snapshot.ok) return { ok: false, error: { code: snapshot.error.code, message: snapshot.error.message } };
        const servers = [...snapshot.value.servers.values()];
        return ok({
            serverCount: servers.length,
            connectionCount: snapshot.value.edges.length,
            hiddenEdgeCount: snapshot.value.edges.filter((edge) => edge.hidden).length,
            maintenanceCount: servers.filter((server) => server.maintenance.active).length,
            endpointCapableCount: servers.filter((server) => server.endpointCapable).length,
            accessibleCount: servers.filter((server) => server.access.active).length,
            endpointId: snapshot.value.endpointId,
            homeId: snapshot.value.homeId,
            snapshotAgeMs: game.snapshots.getCachedAgeMs(),
            snapshotCapturedAt: snapshot.value.capturedAt,
            maintenance: servers.filter((server) => server.maintenance.active).map((server) => ({
                id: server.id,
                name: server.name,
                endsAt: server.maintenance.endsAt,
            })),
        });
    });
    server.register('network.servers', z.object({}).strict(), async () => {
        const snapshot = await game.snapshots.get();
        if (!snapshot.ok) return { ok: false, error: { code: snapshot.error.code, message: snapshot.error.message } };
        return ok([...snapshot.value.servers.values()].map((server) => ({
            id: server.id,
            name: server.name,
            ip: server.ip,
            typeName: server.typeName,
            access: server.access.kind,
            maintenanceActive: server.maintenance.active,
        })));
    });
    server.register('network.discover', discoveryOptionsSchema, async (options) => {
        return core.runBridgeExclusive({ owner: 'discovery', reason: 'network-discovery', priority: 30 }, async () => {
            const normalized = {
                ...(options.maxDurationMs !== undefined ? { maxDurationMs: options.maxDurationMs } : {}),
                ...(options.maxIps !== undefined ? { maxIps: options.maxIps } : {}),
                ...(options.restart !== undefined ? { restart: options.restart } : {}),
            };
            return ok(await game.discovery.discover(normalized));
        });
    });
    server.register('network.marketPath', marketPathSchema, async (request) => {
        return core.runBridgeExclusive({ owner: request.owner, reason: request.reason, priority: 60 }, async () => {
            const result = await game.marketPath.reachAndRequest({
                marketId: request.marketId,
                serverId: asServerId(request.serverId),
                owner: request.owner,
                reason: request.reason,
            });
            return result.ok
                ? ok(result.value)
                : { ok: false, error: { code: result.error.code, message: result.error.message } };
        });
    });
    server.register('network.marketSync', marketPathSchema, async (request) => {
        return core.runBridgeExclusive({ owner: request.owner, reason: request.reason, priority: 70 }, async () => {
            const result = await game.marketSync.sync({
                marketId: request.marketId,
                serverId: asServerId(request.serverId),
                owner: request.owner,
                reason: request.reason,
            });
            return result.ok
                ? ok(result.value)
                : { ok: false, error: { code: result.error.code, message: result.error.message } };
        });
    });
}
