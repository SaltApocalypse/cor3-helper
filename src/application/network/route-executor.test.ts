import { describe, expect, it } from 'vitest';
import { NetworkGraph } from '../../domains/network/graph.js';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { err, ok } from '../../kernel/result.js';
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

function snapshot(includeTarget = true): NetworkSnapshot {
    const servers = [home, a, b, ...(includeTarget ? [target] : [])];
    return {
        version: 1, capturedAt: 1, homeId: home, endpointId: null,
        servers: new Map(servers.map((id) => [id, server(id, id)])),
        edges: [
            { id: asEdgeId('e1'), a: home, b: a, hidden: false },
            { id: asEdgeId('e2'), a, b: target, hidden: false },
            { id: asEdgeId('e3'), a: home, b, hidden: false },
            { id: asEdgeId('e4'), a: b, b: target, hidden: false },
        ],
        maintenanceFingerprint: '',
    };
}

function graph(includeTarget = true): NetworkGraph {
    return new NetworkGraph(snapshot(includeTarget));
}

describe('RouteExecutor', () => {
    it('uses a direct target endpoint without touching intermediates', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        const endpoints: string[] = [];
        let accessCalls = 0;
        const executor = new RouteExecutor({
            setEndpoint: async (id) => { endpoints.push(id); return ok(undefined); },
        }, {
            ensureAccess: async () => { accessCalls += 1; return ok(undefined); },
        }, leases, clock);

        const result = await executor.execute(graph(), target, {
            owner: 'test',
            reason: 'unit',
            currentEndpoint: home,
        });

        expect(result.ok).toBe(true);
        expect(result.direct).toBe(true);
        expect(endpoints).toEqual([target]);
        expect(accessCalls).toBe(0);
        expect(result.route?.nodes.map((node) => node.name)).toEqual(['home', 'target']);
        expect(leases.current()).toBeNull();
    });

    it('ensures target access when the player is already at the target endpoint', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        const endpoints: string[] = [];
        let accessCalls = 0;
        const executor = new RouteExecutor({
            setEndpoint: async (id) => { endpoints.push(id); return ok(undefined); },
        }, {
            ensureAccess: async () => { accessCalls += 1; return ok(undefined); },
        }, leases, clock);

        const result = await executor.execute(graph(), target, {
            owner: 'test',
            reason: 'unit',
            currentEndpoint: target,
        });

        expect(result.ok).toBe(true);
        expect(result.direct).toBe(true);
        expect(result.accessEnsured).toBe(true);
        expect(endpoints).toEqual([]);
        expect(accessCalls).toBe(1);
    });

    it('falls back to an alternative route when direct and intermediate access fail', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        const endpoints: string[] = [];
        let endpoint = home;
        const executor = new RouteExecutor({
            setEndpoint: async (id) => {
                endpoints.push(id);
                if (id === target && endpoint === home) {
                    return err({ code: 'NO_ROUTE', message: 'direct endpoint failed' });
                }
                endpoint = id;
                return ok(undefined);
            },
        }, {
            ensureAccess: async (id) => id === a
                ? err({ code: 'ACCESS_DENIED', message: 'cannot access A' })
                : ok(undefined),
        }, leases, clock);

        const result = await executor.execute(graph(), target, { owner: 'test', reason: 'unit' });

        expect(result.ok).toBe(true);
        expect(result.direct).toBe(false);
        expect(result.route?.nodes.map((node) => node.name)).toEqual(['home', 'b', 'target']);
        expect(endpoints).toEqual([target, a, b, target]);
        expect(leases.current()).toBeNull();
    });

    it('still works when the target is missing from the snapshot but direct routing works', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        const endpoints: string[] = [];
        const executor = new RouteExecutor({
            setEndpoint: async (id) => { endpoints.push(id); return ok(undefined); },
        }, {
            ensureAccess: async () => ok(undefined),
        }, leases, clock);

        const result = await executor.execute(graph(false), target, {
            owner: 'test',
            reason: 'unit',
            currentEndpoint: home,
        });

        expect(result.ok).toBe(true);
        expect(result.direct).toBe(true);
        expect(endpoints).toEqual([target]);
    });

    it('returns LEASE_BUSY without executing when another owner holds the endpoint', async () => {
        const clock = new FakeClock(0);
        const leases = new InMemoryEndpointLeaseService(clock);
        leases.acquire('other', 'market');
        const executor = new RouteExecutor({
            setEndpoint: async () => ok(undefined),
        }, {
            ensureAccess: async () => ok(undefined),
        }, leases, clock);
        const result = await executor.execute(graph(), target, { owner: 'test', reason: 'unit' });
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('LEASE_BUSY');
    });
});
