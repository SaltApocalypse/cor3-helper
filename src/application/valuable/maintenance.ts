import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';

export interface ValuableMaintenanceServer {
    readonly id: string;
    readonly name: string;
    readonly typeName: string | null;
    readonly active: boolean;
    readonly endsAt: string | null;
    readonly timeUntil: string | null;
}

/** A server is a force-maintenance candidate only while it is scheduled but not yet active. */
export function isUpcomingMaintenance(server: NetworkServer): boolean {
    return !server.maintenance.active && typeof server.maintenance.timeUntil === 'string' && server.maintenance.timeUntil.length > 0;
}

export function listMaintenanceServers(snapshot: NetworkSnapshot): readonly ValuableMaintenanceServer[] {
    return [...snapshot.servers.values()]
        .filter((server) => server.maintenance.active || (typeof server.maintenance.timeUntil === 'string' && server.maintenance.timeUntil.length > 0))
        .map((server) => ({
            id: server.id,
            name: server.name,
            typeName: server.typeName,
            active: server.maintenance.active,
            endsAt: server.maintenance.endsAt,
            timeUntil: server.maintenance.timeUntil,
        }))
        .sort((left, right) => {
            if (left.active !== right.active) return left.active ? -1 : 1;
            const leftAt = left.timeUntil ?? left.endsAt ?? '';
            const rightAt = right.timeUntil ?? right.endsAt ?? '';
            return leftAt.localeCompare(rightAt);
        });
}
