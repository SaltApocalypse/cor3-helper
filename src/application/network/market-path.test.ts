import { describe, expect, it } from 'vitest';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { InMemoryEndpointLeaseService } from './endpoint-lease.js';
import { MarketPathService } from './market-path.js';
import { RouteExecutor } from './route-executor.js';

const home = asServerId('home');
const market = asServerId('market');

function server(id: ReturnType<typeof asServerId>, name: string): NetworkServer {
    return {
        id, name, ip: null, typeName: 'test', cluster: null, faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: false }, endpointCapable: true, reachableNow: true,
    };
}

const snapshot: NetworkSnapshot = {
    version: 1, capturedAt: 1, homeId: home, endpointId: null,
    servers: new Map([home, market].map((id) => [id, server(id, id)])),
    edges: [{ id: asEdgeId('e1'), a: home, b: market, hidden: false }],
    maintenanceFingerprint: '',
};

describe('MarketPathService', () => {
    it('routes to the market then requests it', async () => {
        const clock = new FakeClock(0);
        const endpoints: string[] = [];
        const requested: string[] = [];
        const executor = new RouteExecutor({
            setEndpoint: async (id) => { endpoints.push(id); return { ok: true, value: undefined }; },
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, new InMemoryEndpointLeaseService(clock), clock);
        const service = new MarketPathService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor,
            { requestMarket: async (id) => { requested.push(id); return { ok: true, value: undefined }; } },
            clock,
        );
        const result = await service.reachAndRequest({ marketId: 'm1', serverId: market, owner: 'market', reason: 'test' });
        expect(result.ok).toBe(true);
        expect(endpoints).toEqual(['market']);
        expect(requested).toEqual(['m1']);
        if (result.ok) expect(result.value.route.map((node) => node.name)).toEqual(['home', 'market']);
    });

    it('does not request the market when routing fails', async () => {
        const clock = new FakeClock(0);
        let requested = false;
        const executor = new RouteExecutor({
            setEndpoint: async () => ({ ok: false, error: { code: 'NO_ROUTE', message: 'no' } }),
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, new InMemoryEndpointLeaseService(clock), clock);
        const service = new MarketPathService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor,
            { requestMarket: async () => { requested = true; return { ok: true, value: undefined }; } },
            clock,
        );
        const result = await service.reachAndRequest({ marketId: 'm1', serverId: market, owner: 'market', reason: 'test' });
        expect(result.ok).toBe(false);
        expect(requested).toBe(false);
    });
});
