import { describe, expect, it } from 'vitest';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { InMemoryEndpointLeaseService } from '../network/endpoint-lease.js';
import { RouteExecutor } from '../network/route-executor.js';
import { ValuableSellerService } from './seller.js';
import { MaintenanceMonitor } from './maintenance-monitor.js';

const home = asServerId('home');
const serverA = asServerId('server-a');
const serverB = asServerId('server-b');
const market = asServerId('market');

function node(id: ReturnType<typeof asServerId>, name: string, typeName = 'CEDRT'): NetworkServer {
    return {
        id, name, ip: null, typeName, cluster: null, faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: false }, endpointCapable: true, reachableNow: true,
    };
}

const snapshot: NetworkSnapshot = {
    version: 1, capturedAt: 1, homeId: home, endpointId: null,
    servers: new Map([
        [home, node(home, 'home', 'Home')],
        [serverA, node(serverA, 'server-a')],
        [serverB, node(serverB, 'server-b')],
        [market, node(market, 'market')],
    ]),
    edges: [
        { id: asEdgeId('e1'), a: home, b: serverA, hidden: false },
        { id: asEdgeId('e2'), a: serverA, b: market, hidden: false },
        { id: asEdgeId('e3'), a: serverA, b: serverB, hidden: false },
    ],
    maintenanceFingerprint: '',
};

function fakeServers() {
    const calls: string[] = [];
    return {
        calls,
        port: {
            searchFiles: async (serverId: string) => { calls.push(`search-files:${serverId}`); return { ok: true as const, value: { found: [{ id: 'f1', basePrice: 100 }] } }; },
            searchLogs: async (serverId: string) => { calls.push(`search-logs:${serverId}`); return { ok: true as const, value: { found: [{ id: '7', basePrice: 50 }] } }; },
            getFiles: async (_serverId: string) => ({ ok: true as const, value: [
                { fileId: 'f1', name: 'valuable', basePrice: 100, tags: ['data'] },
                { fileId: 'f2', name: 'junk', basePrice: 0, tags: [] },
            ] }),
            getLogs: async (serverId: string) => ({ ok: true as const, value: [
                { seq: 7, message: `valuable log ${serverId}`, basePrice: 50, tags: ['log'] },
                { seq: 8, message: 'junk log', basePrice: 0, tags: [] },
            ] }),
            downloadFile: async (serverId: string, fileId: string) => { calls.push(`download-file:${serverId}:${fileId}`); return { ok: true as const, value: undefined }; },
            downloadLog: async (serverId: string, seq: number) => { calls.push(`download-log:${serverId}:${seq}`); return { ok: true as const, value: undefined }; },
        },
    };
}

function executor(clock: FakeClock, endpoints: string[] = []) {
    return new RouteExecutor({
        setEndpoint: async (id) => { endpoints.push(id); return { ok: true, value: undefined }; },
    }, {
        ensureAccess: async () => ({ ok: true, value: undefined }),
    }, new InMemoryEndpointLeaseService(clock), clock);
}

describe('ValuableSellerService', () => {
    it('searches every hackable server, excluding home, and downloads valuable items', async () => {
        const clock = new FakeClock(0);
        const endpoints: string[] = [];
        const fake = fakeServers();
        const searchTargets: Array<[string, string | null]> = [];
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor(clock, endpoints),
            fake.port,
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            async (serverId, typeName) => {
                searchTargets.push([serverId, typeName]);
                return { ok: true, value: undefined };
            },
        );
        const result = await service.search({ owner: 'valuable' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.serversScanned).toBe(3);
            expect(result.value.downloadedFiles).toBe(3);
            expect(result.value.downloadedLogs).toBe(3);
            expect(result.value.serverFailures).toEqual([]);
        }
        expect(searchTargets).toEqual([['market', 'CEDRT'], ['server-b', 'CEDRT'], ['server-a', 'CEDRT']]);
        expect(fake.calls).toEqual([
            'search-files:market', 'search-logs:market', 'download-file:market:f1', 'download-log:market:7',
            'search-files:server-b', 'search-logs:server-b', 'download-file:server-b:f1', 'download-log:server-b:7',
            'search-files:server-a', 'search-logs:server-a', 'download-file:server-a:f1', 'download-log:server-a:7',
        ]);
        expect(endpoints).toEqual(['market', 'server-b', 'server-a']);
    });

    it('sells downloaded items market by market and reports actual proceeds', async () => {
        const clock = new FakeClock(0);
        const sold: string[] = [];
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor(clock),
            fakeServers().port,
            {
                getSellableItems: async () => ({ ok: true, value: {
                    items: [
                        { itemType: 'file', itemId: 'f1', price: 0, reputation: 0 },
                        { itemType: 'log', itemId: '7', price: 0, reputation: 0 },
                    ],
                    totalPrice: 150,
                    totalRepGain: 5,
                } }),
                sellItems: async (_market, items) => {
                    sold.push(...items.map((item) => item.itemId));
                    return { ok: true, value: { sold: items.length, credits: 75, reputation: 2.5 } };
                },
            },
            clock,
        );
        const result = await service.sell({
            markets: [{ label: 'D4RK', marketId: 'm', routeServerId: 'market' }],
            owner: 'valuable',
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.marketsChecked).toBe(1);
            expect(result.value.soldItems).toBe(2);
            expect(result.value.credits).toBe(150);
            expect(result.value.reputation).toBe(5);
            expect(result.value.marketFailures).toEqual([]);
        }
        expect(sold).toEqual(['f1', '7']);
    });

    it('stops promptly when cancellation is requested', async () => {
        const clock = new FakeClock(0);
        const endpoints: string[] = [];
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: snapshot }) },
            executor(clock, endpoints),
            fakeServers().port,
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            undefined,
            { shouldStop: () => true },
        );
        const result = await service.search({ owner: 'valuable' });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.stopped).toBe(true);
        expect(endpoints).toEqual([]);
    });

    it('records route failures without aborting the whole search', async () => {
        const clock = new FakeClock(0);
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: snapshot }) },
            new RouteExecutor({
                setEndpoint: async () => ({ ok: false, error: { code: 'ENDPOINT_FAILED', message: 'no endpoint' } }),
            }, {
                ensureAccess: async () => ({ ok: true, value: undefined }),
            }, new InMemoryEndpointLeaseService(clock), clock),
            fakeServers().port,
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
        );
        const result = await service.search({ owner: 'valuable' });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.serverFailures).toHaveLength(3);
            expect(result.value.downloadedFiles).toBe(0);
        }
    });

    it('records market route failures without aborting the sale', async () => {
        const clock = new FakeClock(0);
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: snapshot }) },
            new RouteExecutor({
                setEndpoint: async () => ({ ok: false, error: { code: 'ENDPOINT_FAILED', message: 'no endpoint' } }),
            }, {
                ensureAccess: async () => ({ ok: true, value: undefined }),
            }, new InMemoryEndpointLeaseService(clock), clock),
            fakeServers().port,
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
        );
        const result = await service.sell({
            markets: [{ label: 'D4RK', marketId: 'm', routeServerId: 'market' }],
            owner: 'valuable',
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.marketFailures).toHaveLength(1);
    });
});

describe('ValuableSellerService forceMaintenance', () => {
    function forceSnapshot(): NetworkSnapshot {
        const upcoming = (server: NetworkServer) => ({
            ...server,
            maintenance: { active: false, endsAt: null, timeUntil: '2026-11-26T12:00:00.000Z' },
        });
        return {
            ...snapshot,
            servers: new Map([
                [home, node(home, 'home', 'Home')],
                [serverA, upcoming(node(serverA, 'server-a'))],
                [serverB, upcoming(node(serverB, 'server-b'))],
                [market, { ...node(market, 'market'), maintenance: { active: true, endsAt: '2026-11-26T12:00:00.000Z', timeUntil: null } }],
            ]),
        };
    }

    it('forces selected upcoming servers furthest-first and stops on the maintenance event', async () => {
        const clock = new FakeClock(0);
        const monitor = new MaintenanceMonitor();
        const calls: string[] = [];
        const downloads: string[] = [];
        const searchCounts = new Map<string, number>();
        const snapshotCalls: Array<boolean | undefined> = [];
        const bypassFlags: Array<boolean | undefined> = [];
        const sleeps: number[] = [];
        const service = new ValuableSellerService(
            { get: async (force?: boolean) => { snapshotCalls.push(force); return { ok: true, value: forceSnapshot() }; } },
            executor(clock),
            {
                searchFiles: async (serverId: string, _timeoutMs?: number, options?: { bypassRateLimitCooldown?: boolean }) => {
                    calls.push(serverId);
                    bypassFlags.push(options?.bypassRateLimitCooldown);
                    const count = (searchCounts.get(serverId) ?? 0) + 1;
                    searchCounts.set(serverId, count);
                    if (count >= 2) monitor.record(serverId);
                    return { ok: true as const, value: { found: [{ id: `file-${serverId}`, basePrice: 10 }] } };
                },
                searchLogs: async () => ({ ok: true as const, value: { found: [] } }),
                getFiles: async () => ({ ok: true as const, value: [] }),
                getLogs: async () => ({ ok: true as const, value: [] }),
                downloadFile: async (_serverId: string, fileId: string) => { downloads.push(fileId); return { ok: true as const, value: undefined }; },
                downloadLog: async () => ({ ok: true as const, value: undefined }),
            },
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            undefined,
            undefined,
            undefined,
            async () => ({ ok: true, value: undefined }),
            monitor,
            async (ms?: number) => { sleeps.push(ms ?? 0); },
        );

        const result = await service.forceMaintenance({
            owner: 'valuable',
            serverIds: [serverA, serverB, market],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.stopped).toBe(false);
        expect(result.value.forcedServers).toBe(2);
        expect(result.value.failedServers).toEqual([{ target: 'market', message: 'Not scheduled for upcoming maintenance' }]);
        expect(calls.slice(0, 2)).toEqual([serverB, serverB]);
        expect(calls).toEqual(expect.arrayContaining([serverA, serverB]));
        // v1 parity: the force loop never downloads and never force-refreshes.
        expect(downloads).toEqual([]);
        expect(result.value.downloadedFiles).toBe(0);
        expect(result.value.downloadedLogs).toBe(0);
        expect(snapshotCalls).toEqual([undefined]);
        expect(bypassFlags.length).toBeGreaterThan(0);
        expect(bypassFlags.every((flag) => flag === true)).toBe(true);
        // v1 pacing: 400-900 ms between attempts.
        expect(sleeps.length).toBeGreaterThan(0);
        expect(sleeps.every((ms) => ms >= 400 && ms <= 900)).toBe(true);
    });

    it('refreshes the map only for access recovery, not every few attempts', async () => {
        const clock = new FakeClock(0);
        const monitor = new MaintenanceMonitor();
        const snapshotCalls: Array<boolean | undefined> = [];
        let searches = 0;
        const service = new ValuableSellerService(
            { get: async (force?: boolean) => { snapshotCalls.push(force); return { ok: true, value: forceSnapshot() }; } },
            executor(clock),
            {
                searchFiles: async () => {
                    searches += 1;
                    if (searches === 1) {
                        return { ok: false as const, error: { code: 'GAME_VALUABLE_ACTION_FAILED', message: 'sai-access-denied' } };
                    }
                    monitor.record(serverB);
                    monitor.record(serverA);
                    return { ok: true as const, value: { found: [] } };
                },
                searchLogs: async () => ({ ok: true as const, value: { found: [] } }),
                getFiles: async () => ({ ok: true as const, value: [] }),
                getLogs: async () => ({ ok: true as const, value: [] }),
                downloadFile: async () => ({ ok: true as const, value: undefined }),
                downloadLog: async () => ({ ok: true as const, value: undefined }),
            },
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            undefined,
            undefined,
            undefined,
            async () => ({ ok: true, value: undefined }),
            monitor,
            async () => undefined,
        );

        const result = await service.forceMaintenance({ owner: 'valuable', serverIds: [serverA, serverB] });
        expect(result.ok).toBe(true);
        // Initial cached read + one forced refresh from the access recovery.
        expect(snapshotCalls).toEqual([undefined, true]);
    });

    it('caps each server at 50 attempts and reports failure', async () => {
        const clock = new FakeClock(0);
        let calls = 0;
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: forceSnapshot() }) },
            executor(clock),
            {
                searchFiles: async () => { calls += 1; return { ok: true as const, value: { found: [] } }; },
                searchLogs: async () => ({ ok: true as const, value: { found: [] } }),
                getFiles: async () => ({ ok: true as const, value: [] }),
                getLogs: async () => ({ ok: true as const, value: [] }),
                downloadFile: async () => ({ ok: true as const, value: undefined }),
                downloadLog: async () => ({ ok: true as const, value: undefined }),
            },
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
        );

        const result = await service.forceMaintenance({
            owner: 'valuable',
            serverIds: [serverB],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(calls).toBe(50);
        expect(result.value.forcedServers).toBe(0);
        expect(result.value.failedServers).toHaveLength(1);
    });

    it('stops promptly when cancellation is requested', async () => {
        const clock = new FakeClock(0);
        let calls = 0;
        const service = new ValuableSellerService(
            { get: async () => ({ ok: true, value: forceSnapshot() }) },
            executor(clock),
            {
                searchFiles: async () => { calls += 1; return { ok: true as const, value: { found: [] } }; },
                searchLogs: async () => ({ ok: true as const, value: { found: [] } }),
                getFiles: async () => ({ ok: true as const, value: [] }),
                getLogs: async () => ({ ok: true as const, value: [] }),
                downloadFile: async () => ({ ok: true as const, value: undefined }),
                downloadLog: async () => ({ ok: true as const, value: undefined }),
            },
            {
                getSellableItems: async () => ({ ok: true, value: { items: [], totalPrice: 0, totalRepGain: 0 } }),
                sellItems: async () => ({ ok: true, value: { sold: 0, credits: 0, reputation: 0 } }),
            },
            clock,
            undefined,
            { shouldStop: () => true },
            undefined,
            undefined,
            undefined,
            async () => undefined,
        );

        const result = await service.forceMaintenance({ owner: 'valuable', serverIds: [serverB] });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.stopped).toBe(true);
        expect(calls).toBe(0);
    });
});
