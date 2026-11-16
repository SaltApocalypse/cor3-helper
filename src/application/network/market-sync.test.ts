import { describe, expect, it } from 'vitest';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { InMemoryEndpointLeaseService } from './endpoint-lease.js';
import { MarketSyncService } from './market-sync.js';
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

describe('MarketSyncService', () => {
    it('fetches options, lots, and jobs after routing to the market', async () => {
        const clock = new FakeClock(0);
        const executor = new RouteExecutor({
            setEndpoint: async () => ({ ok: true, value: undefined }),
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, new InMemoryEndpointLeaseService(clock), clock);
        const service = new MarketSyncService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor,
            { fetchMarket: async () => ({ ok: true, value: { options: { id: 'o' }, lots: { id: 'l' }, jobs: { id: 'j' } } }) },
            clock,
        );
        const result = await service.sync({ marketId: 'm1', serverId: market, owner: 'market', reason: 'test' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.route.map((node) => node.name)).toEqual(['home', 'market']);
            expect(result.value.market).toEqual({ options: { id: 'o' }, lots: { id: 'l' }, jobs: { id: 'j' } });
        }
    });

    it('retries a transient market-not-reachable response', async () => {
        const clock = new FakeClock(0);
        const executor = new RouteExecutor({
            setEndpoint: async () => ({ ok: true, value: undefined }),
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, new InMemoryEndpointLeaseService(clock), clock);
        let calls = 0;
        const service = new MarketSyncService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor,
            {
                fetchMarket: async () => {
                    calls += 1;
                    if (calls === 1) return { ok: false, error: { code: 'GAME_MARKET_FAILED', message: 'market-not-reachable' } };
                    return { ok: true, value: { options: {}, lots: [], jobs: [] } };
                },
            },
            clock,
            { retryDelayMs: 0, sleep: async () => undefined },
        );
        const result = await service.sync({ marketId: 'm1', serverId: market, owner: 'market', reason: 'test' });
        expect(result.ok).toBe(true);
        expect(calls).toBe(2);
    });

    it('does not fetch market data when routing fails', async () => {
        const clock = new FakeClock(0);
        let fetched = false;
        const executor = new RouteExecutor({
            setEndpoint: async () => ({ ok: false, error: { code: 'NO_ROUTE', message: 'no' } }),
        }, {
            ensureAccess: async () => ({ ok: true, value: undefined }),
        }, new InMemoryEndpointLeaseService(clock), clock);
        const service = new MarketSyncService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor,
            { fetchMarket: async () => { fetched = true; return { ok: true, value: { options: {}, lots: [], jobs: [] } }; } },
            clock,
        );
        expect((await service.sync({ marketId: 'm1', serverId: market, owner: 'market', reason: 'test' })).ok).toBe(false);
        expect(fetched).toBe(false);
    });
});
