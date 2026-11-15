import { describe, expect, it } from 'vitest';
import { parseRawNetworkMap } from '../../contracts/map.js';
import { summarizeNetworkMap } from './summary.js';

describe('summarizeNetworkMap', () => {
    it('counts servers, connections, hidden edges, and endpoints', () => {
        const raw = parseRawNetworkMap({
            servers: [
                { id: 'home', serverName: 'Home Server', serverTypeName: 'Home' },
                { id: 'target', serverName: 'Target', isEndpoint: true },
            ],
            connections: [
                { id: 'e1', serverA: 'home', serverB: 'target' },
                { id: 'e2', serverA: 'home', serverB: 'target', isHidden: true },
            ],
        });
        expect(summarizeNetworkMap(raw)).toEqual({
            serverCount: 2,
            connectionCount: 2,
            hiddenConnectionCount: 1,
            home: 'Home Server',
            endpoint: 'Target',
        });
    });
});
