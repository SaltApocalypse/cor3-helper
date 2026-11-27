import type { RawNetworkMap } from '../../contracts/map.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import type {
    AccessState,
    MaintenanceState,
    NetworkEdge,
    NetworkServer,
    NetworkSnapshot,
} from '../../domains/network/model.js';

function accessOf(server: RawNetworkMap['servers'][number]): AccessState {
    if (server.hasAdminAccess) return { kind: 'admin', active: true };
    if (server.accessType) return { kind: 'regular', active: true };
    return { kind: 'none', active: false };
}

function maintenanceOf(server: RawNetworkMap['servers'][number]): MaintenanceState {
    return {
        active: server.isInMaintenance === true,
        endsAt: server.maintenanceEndsAt ?? null,
        timeUntil: server.timeUntilMaintenance ?? null,
    };
}

export function mapRawNetworkToSnapshot(raw: RawNetworkMap, capturedAt = Date.now()): NetworkSnapshot {
    const servers = new Map<ReturnType<typeof asServerId>, NetworkServer>();
    let homeId: ReturnType<typeof asServerId> | null = null;
    let endpointId: ReturnType<typeof asServerId> | null = null;
    const maintenanceParts: string[] = [];

    for (const server of raw.servers) {
        const id = asServerId(server.id);
        const mapped: NetworkServer = {
            id,
            name: server.serverName ?? server.id,
            ip: server.serverIp ?? null,
            typeName: server.serverTypeName ?? null,
            cluster: server.serverCluster ?? null,
            faction: null,
            maintenance: maintenanceOf(server),
            access: accessOf(server),
            endpointCapable: server.canSetEndpoint !== false,
            reachableNow: server.isReachable === true,
            discovered: server.isDiscovered !== false,
            accessible: server.isAccessible === true,
        };
        servers.set(id, mapped);
        if ((server.serverTypeName ?? '').toLowerCase() === 'home') homeId = id;
        if (server.isEndpoint) endpointId = id;
        if (mapped.maintenance.active) maintenanceParts.push(`${id}:${mapped.maintenance.endsAt ?? 'unknown'}`);
    }

    if (!homeId) {
        const error = new Error('Network map has no Home server');
        (error as Error & { code?: string }).code = 'HOME_NOT_FOUND';
        throw error;
    }
    const edges: NetworkEdge[] = raw.connections.map((connection) => ({
        id: asEdgeId(connection.id),
        a: asServerId(connection.serverA),
        b: asServerId(connection.serverB),
        hidden: connection.isHidden === true,
    }));

    return {
        version: capturedAt,
        capturedAt,
        homeId,
        endpointId,
        servers,
        edges,
        maintenanceFingerprint: maintenanceParts.sort().join('|'),
    };
}
