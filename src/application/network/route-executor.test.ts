import { describe, expect, it } from 'vitest';
import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { InMemoryEndpointLeaseService } from './endpoint-lease.js';
import { RouteExecutor } from './route-executor.js';

const home = asServerId('home');
const a = asServerId('a');
const b = asServerId('b');
const target = asServerId('target');

function server(id: ReturnType<typeof asServerId>, name: string): NetworkServer {
    return {
        id, name, ip: null, typeName: 'test', cluster: null, faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: false }, endpointCapable: true, reachableNow: true,
    };
}

function graph(): NetworkGraph {
    const snapshot: NetworkSnapshot = {
        version: 1, capturedAt: 1, homeId: home, endpointId: null,
        servers: new Map([home, a, b, target].map((id) => [id, server(id, id)])),
        edges: [
            { id: asEdgeId('e1'), a: home, b: a, hidden: false },
            { id: asEdgeId('e2'), a, b: target, hidden: false },
            { id: asEdgeId('e3'), a: home, b, hidden: false },
            { id: asEdgeId('e4'), a: b, b: target, hidden: false },
        ],
        maintenanceFingerprint: '',
    };
    return new NetworkGraph(snapshot);
}

describe('RouteExecutor', () => {
    it('falls back to the next route when an intermediate access fails', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        const endpoints: string[] = [];
        const executor = new RouteExecutor({
            setEndpoint: async (id) => { endpoints.push(id); return { ok: true, value: undefined }; },
        }, {
            ensureAccess: async (id) => id === a
                ? { ok: false, error: { code: 'ACCESS_DENIED', message: 'cannot access A' } }
                : { ok: true, value: undefined },
        }, leases, clock);

        const result = await executor.execute(graph(), target, { owner: 'test', reason: 'unit' });
        expect(result.ok).toBe(true);
        expect(result.route?.nodes.map((node) => node.name)).toEqual(['home', 'b', 'target']);
        expect(leases.current()).toBeNull();
        expect(endpoints).toEqual(['a', 'b', 'target']);
    });

    it('returns LEASE_BUSY without executing when another owner holds the endpoint', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        leases.acquire('other', 'market');
        const executor = new RouteExecutor({
            setEndpoint: async () => ({ ok: true, value: undefined }),
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, leases, clock);
        const result = await executor.execute(graph(), target, { owner: 'test', reason: 'unit' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('LEASE_BUSY');
    });
});
