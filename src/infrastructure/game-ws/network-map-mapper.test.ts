import { describe, expect, it } from 'vitest';
import { parseRawNetworkMap } from '../../contracts/map.js';
import { NetworkGraph } from '../../domains/network/graph.js';
import { asServerId } from '../../kernel/ids.js';
import { mapRawNetworkToSnapshot } from './network-map-mapper.js';

const raw = parseRawNetworkMap({
    servers: [
        { id: 'home', serverName: 'Home Server', serverTypeName: 'Home' },
        { id: 'a', serverName: 'A', isInMaintenance: true, maintenanceEndsAt: '2999-01-01T00:00:00.000Z' },
        { id: 'b', serverName: 'B' },
        { id: 'target', serverName: 'Target', isEndpoint: true },
    ],
    connections: [
        { id: 'e1', serverA: 'home', serverB: 'a' },
        { id: 'e2', serverA: 'a', serverB: 'target' },
        { id: 'e3', serverA: 'home', serverB: 'b' },
        { id: 'e4', serverA: 'b', serverB: 'target', isHidden: true },
    ],
});

describe('mapRawNetworkToSnapshot', () => {
    it('maps the raw v1 map into a network snapshot', () => {
        const snapshot = mapRawNetworkToSnapshot(raw, 123);
        expect(snapshot.capturedAt).toBe(123);
        expect(snapshot.servers.size).toBe(4);
        expect(snapshot.endpointId).toBe('target');
        expect(snapshot.maintenanceFingerprint).toContain('a:');
    });

    it('produces a graph that routes around maintenance using the hidden edge', () => {
        const graph = new NetworkGraph(mapRawNetworkToSnapshot(raw, 123));
        const result = graph.findRoute(asServerId('target'), 123);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.nodes.map((node) => node.name)).toEqual(['Home Server', 'B', 'Target']);
    });
});
