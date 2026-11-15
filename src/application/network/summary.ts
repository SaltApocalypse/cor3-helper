import type { RawNetworkMap } from '../../contracts/map.js';

export { networkMapSummarySchema, type NetworkMapSummary } from '../../contracts/network-summary.js';
import type { NetworkMapSummary } from '../../contracts/network-summary.js';

export function summarizeNetworkMap(map: RawNetworkMap): NetworkMapSummary {
    const home = map.servers.find((server) => (server.serverTypeName ?? '').toLowerCase() === 'home');
    const endpoint = map.servers.find((server) => server.isEndpoint === true);
    return {
        serverCount: map.servers.length,
        connectionCount: map.connections.length,
        hiddenConnectionCount: map.connections.filter((connection) => connection.isHidden === true).length,
        home: home?.serverName ?? null,
        endpoint: endpoint?.serverName ?? null,
    };
}
