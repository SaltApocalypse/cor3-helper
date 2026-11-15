import type { NetworkSnapshot } from '../../domains/network/model.js';
import { networkMapSummarySchema, type NetworkMapSummary } from './summary.js';

export function summarizeNetworkSnapshot(snapshot: NetworkSnapshot): NetworkMapSummary {
    const home = snapshot.servers.get(snapshot.homeId);
    const endpoint = snapshot.endpointId ? snapshot.servers.get(snapshot.endpointId) : null;
    return networkMapSummarySchema.parse({
        serverCount: snapshot.servers.size,
        connectionCount: snapshot.edges.length,
        hiddenConnectionCount: snapshot.edges.filter((edge) => edge.hidden).length,
        home: home?.name ?? null,
        endpoint: endpoint?.name ?? null,
    });
}
