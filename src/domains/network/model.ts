import type { ServerId, EdgeId } from '../../kernel/ids.js';

export type { ServerId, EdgeId } from '../../kernel/ids.js';

export interface MaintenanceState {
    readonly active: boolean;
    readonly endsAt: string | null;
    readonly timeUntil: string | null;
}

export interface AccessState {
    readonly kind: 'none' | 'regular' | 'admin' | 'unknown';
    readonly active: boolean;
}

export interface NetworkServer {
    readonly id: ServerId;
    readonly name: string;
    readonly ip: string | null;
    readonly typeName: string | null;
    readonly cluster: string | null;
    readonly faction: string | null;
    readonly maintenance: MaintenanceState;
    readonly access: AccessState;
    readonly endpointCapable: boolean;
    readonly reachableNow: boolean;
}

export interface NetworkEdge {
    readonly id: EdgeId;
    readonly a: ServerId;
    readonly b: ServerId;
    readonly hidden: boolean;
}

export interface NetworkSnapshot {
    readonly version: number;
    readonly capturedAt: number;
    readonly homeId: ServerId;
    readonly endpointId: ServerId | null;
    readonly servers: ReadonlyMap<ServerId, NetworkServer>;
    readonly edges: readonly NetworkEdge[];
    readonly maintenanceFingerprint: string;
}

/**
 * Returns a snapshot view with a new current endpoint. The topology maps are
 * intentionally shared; only the endpoint field changes.
 */
export function withSnapshotEndpoint(snapshot: NetworkSnapshot, endpointId: ServerId): NetworkSnapshot {
    if (snapshot.endpointId === endpointId) return snapshot;
    return { ...snapshot, endpointId };
}

export interface RouteNode {
    readonly id: ServerId;
    readonly name: string;
}

export interface RoutePlan {
    readonly nodes: readonly RouteNode[];
    readonly edgeIds: readonly EdgeId[];
    readonly hiddenEdgeCount: number;
    readonly maintenanceFree: boolean;
    readonly blocker: string | null;
}
