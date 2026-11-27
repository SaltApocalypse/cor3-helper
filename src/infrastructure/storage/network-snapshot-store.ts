import { z } from 'zod';
import { asEdgeId, asServerId, type ServerId } from '../../kernel/ids.js';
import type { NetworkEdge, NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.network.snapshot';
const SCHEMA_VERSION = 1;

const persistedServerSchema = z.object({
    id: z.string(),
    name: z.string(),
    ip: z.string().nullable(),
    typeName: z.string().nullable(),
    cluster: z.string().nullable(),
    faction: z.string().nullable(),
    maintenance: z.object({
        active: z.boolean(),
        endsAt: z.string().nullable(),
        timeUntil: z.string().nullable(),
    }).strict(),
    access: z.object({
        kind: z.enum(['none', 'regular', 'admin', 'unknown']),
        active: z.boolean(),
    }).strict(),
    endpointCapable: z.boolean(),
    reachableNow: z.boolean(),
    discovered: z.boolean().optional(),
    accessible: z.boolean().optional(),
}).strict();

const persistedEdgeSchema = z.object({
    id: z.string(),
    a: z.string(),
    b: z.string(),
    hidden: z.boolean(),
}).strict();

const persistedSnapshotSchema = z.object({
    version: z.number(),
    capturedAt: z.number(),
    homeId: z.string(),
    endpointId: z.string().nullable(),
    servers: z.array(persistedServerSchema),
    edges: z.array(persistedEdgeSchema),
    maintenanceFingerprint: z.string(),
}).strict();

export type PersistedNetworkSnapshot = z.infer<typeof persistedSnapshotSchema>;

/**
 * Last known good network map. This is a dynamic fallback, not a static path
 * table: it is refreshed from the live game map and only reused while its age
 * is within the snapshot service's fallback window.
 */
export class NetworkSnapshotStore {
    private readonly repository: VersionedRepository<PersistedNetworkSnapshot>;

    constructor(area: StorageArea, clock?: { now(): number }, logger?: { warn(scope: string, message: string, data?: unknown): void }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: persistedSnapshotSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    async get(): Promise<NetworkSnapshot | null> {
        const stored = await this.repository.get();
        if (!stored) return null;
        const servers = new Map<ServerId, NetworkServer>();
        for (const server of stored.servers) {
            const { discovered, accessible, ...rest } = server;
            servers.set(asServerId(server.id), {
                ...rest,
                id: asServerId(server.id),
                ...(discovered !== undefined ? { discovered } : {}),
                ...(accessible !== undefined ? { accessible } : {}),
            });
        }
        return {
            version: stored.version,
            capturedAt: stored.capturedAt,
            homeId: asServerId(stored.homeId),
            endpointId: stored.endpointId === null ? null : asServerId(stored.endpointId),
            servers,
            edges: stored.edges.map((edge): NetworkEdge => ({
                ...edge,
                id: asEdgeId(edge.id),
                a: asServerId(edge.a),
                b: asServerId(edge.b),
            })),
            maintenanceFingerprint: stored.maintenanceFingerprint,
        };
    }

    async set(snapshot: NetworkSnapshot): Promise<void> {
        await this.repository.set({
            version: snapshot.version,
            capturedAt: snapshot.capturedAt,
            homeId: snapshot.homeId,
            endpointId: snapshot.endpointId,
            servers: [...snapshot.servers.values()].map((server) => ({
                id: server.id,
                name: server.name,
                ip: server.ip,
                typeName: server.typeName,
                cluster: server.cluster,
                faction: server.faction,
                maintenance: server.maintenance,
                access: server.access,
                endpointCapable: server.endpointCapable,
                reachableNow: server.reachableNow,
                ...(server.discovered !== undefined ? { discovered: server.discovered } : {}),
                ...(server.accessible !== undefined ? { accessible: server.accessible } : {}),
            })),
            edges: snapshot.edges.map((edge) => ({
                id: edge.id,
                a: edge.a,
                b: edge.b,
                hidden: edge.hidden,
            })),
            maintenanceFingerprint: snapshot.maintenanceFingerprint,
        });
    }
}
