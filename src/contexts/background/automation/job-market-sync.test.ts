import { describe, expect, it } from 'vitest';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import { asServerId } from '../../../kernel/ids.js';
import { err, ok } from '../../../kernel/result.js';
import type { MarketSyncRequest, MarketSyncService } from '../../../application/network/market-sync.js';
import { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { JobMarketSync } from './job-market-sync.js';

const home = asServerId('home');

function snapshot(): NetworkSnapshot {
    const server = (id: ReturnType<typeof asServerId>): NetworkServer => ({
        id,
        name: id,
        ip: null,
        typeName: 'test',
        cluster: null,
        faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: true },
        endpointCapable: true,
        reachableNow: true,
    });
    return {
        version: 1,
        capturedAt: 1,
        homeId: home,
        endpointId: home,
        servers: new Map([[home, server(home)]]),
        edges: [],
        maintenanceFingerprint: '',
    };
}

function harness() {
    const calls: string[] = [];
    const fakeSnapshot = snapshot();
    const sync = new JobMarketSync({
        snapshots: { get: async () => ok(fakeSnapshot) },
        marketSync: {
            sync: async (request: MarketSyncRequest) => {
                calls.push(request.reason);
                const firstAttempt = calls.filter((reason) => reason.includes(`:${request.reason.split(':').at(-1)}`)).length === 1;
                if (request.marketId === JOB_MARKETS[0]!.marketId && firstAttempt) {
                    return err({ code: 'MARKET_FETCH_FAILED' as const, message: 'market-not-reachable' });
                }
                return ok({
                    snapshot: fakeSnapshot,
                    route: [],
                    direct: true,
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        } as unknown as MarketSyncService,
        marketCache: new MarketCacheStore(new MemoryStorageArea()),
        routing: {
            setEndpointIfNeeded: async () => ok(undefined),
        },
        tabs: {
            findCor3Tab: async () => null,
            send: async () => null,
        },
        events: { publish: () => undefined },
        logger: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
        },
        now: () => 1,
        humanDelay: async () => undefined,
    });
    return { sync, calls };
}

describe('JobMarketSync retry pass', () => {
    it('retries a transiently failed market once in the same sync operation', async () => {
        const { sync, calls } = harness();
        const selected = [JOB_MARKETS[0]!, JOB_MARKETS[1]!];
        const result = await sync.syncAll('owner', 'auto-jobs', selected);
        expect(result.markets.map((market) => market.ok)).toEqual([true, true]);
        expect(calls.filter((reason) => reason.includes(JOB_MARKETS[0]!.key)).length).toBe(2);
        expect(calls.filter((reason) => reason.includes(JOB_MARKETS[1]!.key)).length).toBe(1);
    });

    it('does not immediately retry a market in maintenance', async () => {
        const fakeSnapshot = snapshot();
        const calls: string[] = [];
        const sync = new JobMarketSync({
            snapshots: { get: async () => ok(fakeSnapshot) },
            marketSync: {
                sync: async (request: MarketSyncRequest) => {
                    calls.push(request.reason);
                    return err({ code: 'ROUTE_FAILED' as const, message: 'Target in maintenance' });
                },
            } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
            now: () => 1,
            humanDelay: async () => undefined,
        });
        const result = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);
        expect(result.markets[0]?.ok).toBe(false);
        expect(calls).toHaveLength(1);
    });
});
