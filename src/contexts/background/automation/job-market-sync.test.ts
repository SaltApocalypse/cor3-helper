import { describe, expect, it, vi } from 'vitest';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import { asServerId, type ServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';
import type { MarketSyncError, MarketSyncRequest, MarketSyncResult, MarketSyncService } from '../../../application/network/market-sync.js';
import { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { JobStateStore } from '../../../infrastructure/storage/job-state-store.js';
import { JobStateRecorder } from '../../../application/auto-job/job-state-recorder.js';
import { JobStateReconciler } from '../../../application/auto-job/job-state-reconciler.js';
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

function snapshotAt(endpointId: ServerId): NetworkSnapshot {
    return { ...snapshot(), endpointId };
}

function endpointHarness(input: {
    readonly initial: ServerId;
    readonly getSnapshot: (force: boolean) => Promise<Result<NetworkSnapshot, { readonly code: string; readonly message: string }>>;
    readonly sync: (request: MarketSyncRequest, index: number) => Promise<Result<MarketSyncResult, MarketSyncError>>;
}) {
    const starts: Array<ServerId | null> = [];
    let index = 0;
    const sync = new JobMarketSync({
        snapshots: {
            get: async (force = false) => input.getSnapshot(force),
        },
        marketSync: {
            sync: async (request: MarketSyncRequest) => {
                starts.push(request.snapshot?.endpointId ?? null);
                const result = await input.sync(request, index);
                index += 1;
                return result;
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
    return { sync, starts };
}

const aEndpoint = asServerId('endpoint-a');
const bEndpoint = asServerId('endpoint-b');
const cEndpoint = asServerId('endpoint-c');
const dEndpoint = asServerId('endpoint-d');
const eEndpoint = asServerId('endpoint-e');
const refreshedEndpoint = asServerId('refreshed');

describe('JobMarketSync continuous endpoint state', () => {
    it('passes the endpoint reached by each market to the next market', async () => {
        const finalByMarket = new Map([
            [JOB_MARKETS[0]!.marketId, bEndpoint],
            [JOB_MARKETS[1]!.marketId, cEndpoint],
            [JOB_MARKETS[2]!.marketId, dEndpoint],
            [JOB_MARKETS[3]!.marketId, eEndpoint],
        ]);
        const harness = endpointHarness({
            initial: aEndpoint,
            getSnapshot: async () => ok(snapshotAt(aEndpoint)),
            sync: async (request) => {
                const finalEndpoint = finalByMarket.get(request.marketId);
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(aEndpoint),
                    route: [],
                    direct: true,
                    ...(finalEndpoint ? { finalEndpoint } : {}),
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        });
        const result = await harness.sync.syncAll('owner', 'auto-jobs');
        expect(harness.starts).toEqual([aEndpoint, bEndpoint, cEndpoint, dEndpoint]);
        expect(result.finalEndpoint).toBe(eEndpoint);
        expect(result.markets.every((market) => market.ok)).toBe(true);
    });

    it('keeps the routed endpoint when the market request fails', async () => {
        let index = 0;
        const harness = endpointHarness({
            initial: aEndpoint,
            getSnapshot: async () => ok(snapshotAt(aEndpoint)),
            sync: async (request) => {
                index += 1;
                if (index === 1) {
                    return err({
                        code: 'MARKET_FETCH_FAILED',
                        message: 'Target in maintenance',
                        finalEndpoint: bEndpoint,
                    });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(aEndpoint),
                    route: [],
                    direct: true,
                    finalEndpoint: cEndpoint,
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        });
        const result = await harness.sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!, JOB_MARKETS[1]!]);
        expect(harness.starts).toEqual([aEndpoint, bEndpoint]);
        expect(result.markets[0]?.ok).toBe(false);
        expect(result.markets[1]?.ok).toBe(true);
        expect(result.finalEndpoint).toBe(cEndpoint);
    });

    it('does not let an unknown endpoint overwrite the last known endpoint', async () => {
        let index = 0;
        const harness = endpointHarness({
            initial: aEndpoint,
            getSnapshot: async () => ok(snapshotAt(aEndpoint)),
            sync: async (request) => {
                index += 1;
                if (index === 1) {
                    return err({ code: 'ROUTE_FAILED', message: 'Target in maintenance' });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(aEndpoint),
                    route: [],
                    direct: true,
                    finalEndpoint: cEndpoint,
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        });
        const result = await harness.sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!, JOB_MARKETS[1]!]);
        expect(harness.starts).toEqual([aEndpoint, aEndpoint]);
        expect(result.finalEndpoint).toBe(cEndpoint);
    });

    it('starts a retry pass from the last confirmed endpoint when the map refresh fails', async () => {
        let index = 0;
        const harness = endpointHarness({
            initial: aEndpoint,
            getSnapshot: async (force) => force
                ? err({ code: 'GAME_MAP_FAILED', message: 'no map' })
                : ok(snapshotAt(aEndpoint)),
            sync: async (request) => {
                index += 1;
                if (index === 1) {
                    return err({ code: 'MARKET_FETCH_FAILED', message: 'market-not-reachable', finalEndpoint: bEndpoint });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(aEndpoint),
                    route: [],
                    direct: true,
                    finalEndpoint: cEndpoint,
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        });
        const result = await harness.sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);
        expect(harness.starts).toEqual([aEndpoint, bEndpoint]);
        expect(result.markets[0]?.ok).toBe(true);
        expect(result.finalEndpoint).toBe(cEndpoint);
    });

    it('starts a retry pass from the refreshed map endpoint', async () => {
        let index = 0;
        const harness = endpointHarness({
            initial: aEndpoint,
            getSnapshot: async (force) => force
                ? ok(snapshotAt(refreshedEndpoint))
                : ok(snapshotAt(aEndpoint)),
            sync: async (request) => {
                index += 1;
                if (index === 1) {
                    return err({ code: 'MARKET_FETCH_FAILED', message: 'market-not-reachable' });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(aEndpoint),
                    route: [],
                    direct: true,
                    finalEndpoint: cEndpoint,
                    market: { options: {}, lots: [], jobs: [] },
                });
            },
        });
        const result = await harness.sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);
        expect(harness.starts).toEqual([aEndpoint, refreshedEndpoint]);
        expect(result.markets[0]?.ok).toBe(true);
    });
});

describe('JobMarketSync reconciliation trigger', () => {
    function marketHarness(input: {
        readonly sync: (request: MarketSyncRequest) => Promise<Result<MarketSyncResult, MarketSyncError>>;
        readonly reconcile: (input: unknown) => Promise<unknown>;
    }) {
        return new JobMarketSync({
            snapshots: { get: async () => ok(snapshot()) },
            marketSync: { sync: async (request: MarketSyncRequest) => input.sync(request) } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
            reconciler: { reconcile: input.reconcile } as never,
            now: () => 1,
            humanDelay: async () => undefined,
        });
    }

    it('reconciles a successful market with mapped jobs, skipped jobs and reset', async () => {
        const resetAt = '2026-11-20T11:00:00.000Z';
        const reconcile = vi.fn(async () => ({
            marketKey: JOB_MARKETS[0]!.key,
            resetAt,
            decisions: [],
            updated: 0,
            recoverable: [],
            pending: 0,
            conflicts: 0,
            skippedActive: 0,
            failedWrites: 0,
            storeFailed: false,
        }));
        const sync = marketHarness({
            reconcile,
            sync: async () => ok({
                snapshot: snapshot(),
                route: [],
                direct: true,
                market: {
                    options: {},
                    lots: [],
                    jobs: {
                        jobs: [{
                            id: 'open-job', name: 'IP Injection', jobType: 'IP_INJECTION',
                            relatedServers: [{ id: 'server', serverName: 'Server' }],
                        }],
                        recentJobs: [
                            { id: 'taken-job', name: 'IP Injection', jobType: 'IP_INJECTION', status: 'TAKEN', canComplete: true },
                            { id: 'done-job', name: 'IP Injection', jobType: 'IP_INJECTION', isCompleted: true },
                        ],
                        nextJobsResetAt: resetAt,
                    },
                },
            }),
        });

        await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(reconcile).toHaveBeenCalledTimes(1);
        expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
            marketKey: JOB_MARKETS[0]!.key,
            resetAt,
            jobs: expect.arrayContaining([
                expect.objectContaining({ id: 'open-job', alreadyTaken: false }),
                expect.objectContaining({ id: 'taken-job', alreadyTaken: true, canComplete: true }),
            ]),
            skippedJobs: [expect.objectContaining({ id: 'done-job', status: 'completed' })],
        }));
    });

    it('does not reconcile a failed market snapshot', async () => {
        const reconcile = vi.fn(async () => ({
            marketKey: JOB_MARKETS[0]!.key,
            resetAt: null,
            decisions: [],
            updated: 0,
            recoverable: [],
            pending: 0,
            conflicts: 0,
            skippedActive: 0,
            failedWrites: 0,
            storeFailed: false,
        }));
        const sync = marketHarness({
            reconcile,
            sync: async () => err({ code: 'ROUTE_FAILED', message: 'Target in maintenance' }),
        });

        await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(reconcile).not.toHaveBeenCalled();
    });
});

describe('JobMarketSync failed sync keeps local lifecycle state', () => {
    it('does not change a taking record when the market snapshot fails', async () => {
        const area = new MemoryStorageArea();
        const store = new JobStateStore(area, { now: () => 1 });
        const resetAt = '2026-11-20T11:00:00.000Z';
        await store.upsert({
            marketKey: JOB_MARKETS[0]!.key,
            jobId: 'taking-job',
            resetAt,
            status: 'taking',
            createdAt: '1970-01-01T00:00:00.001Z',
            updatedAt: '1970-01-01T00:00:00.001Z',
            lastTransitionAt: '1970-01-01T00:00:00.001Z',
        });
        const log = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
        const recorder = new JobStateRecorder({ store, logger: log, now: () => 1 });
        const reconciler = new JobStateReconciler({ store, writer: recorder, logger: log, now: () => 1 });
        const sync = new JobMarketSync({
            snapshots: { get: async () => ok(snapshot()) },
            marketSync: { sync: async () => err({ code: 'ROUTE_FAILED', message: 'Target in maintenance' }) } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: log,
            reconciler,
            now: () => 1,
            humanDelay: async () => undefined,
        });

        await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect((await store.get({ marketKey: JOB_MARKETS[0]!.key, jobId: 'taking-job', resetAt }))?.status).toBe('taking');
    });
});

describe('JobMarketSync completion reset pruning', () => {
    it('prunes only after a successful market with a known reset', async () => {
        const resetAt = '2026-11-20T11:00:00.000Z';
        const prune = vi.fn(async () => ({ status: 'pruned' as const, removed: 2, state: { byMarket: { home: {} } } }));
        const changed = vi.fn();
        const sync = new JobMarketSync({
            snapshots: { get: async () => ok(snapshot()) },
            marketSync: {
                sync: async () => ok({
                    snapshot: snapshot(),
                    route: [],
                    direct: true,
                    market: { options: {}, lots: [], jobs: { jobs: [], recentJobs: [], nextJobsResetAt: resetAt } },
                }),
            } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
            completions: { pruneMarketBeforeReset: prune },
            onCompletionsChanged: changed,
            now: () => 1,
            humanDelay: async () => undefined,
        });

        await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(prune).toHaveBeenCalledWith(JOB_MARKETS[0]!.key, resetAt);
        expect(changed).toHaveBeenCalledWith({ byMarket: { home: {} } });
    });

    it('does not prune when the market sync fails', async () => {
        const prune = vi.fn(async () => ({ status: 'pruned' as const, removed: 0, state: { byMarket: {} } }));
        const sync = new JobMarketSync({
            snapshots: { get: async () => ok(snapshot()) },
            marketSync: { sync: async () => err({ code: 'ROUTE_FAILED', message: 'Target in maintenance' }) } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
            completions: { pruneMarketBeforeReset: prune },
            now: () => 1,
            humanDelay: async () => undefined,
        });

        await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(prune).not.toHaveBeenCalled();
    });
});

describe('JobMarketSync reconciliation health propagation', () => {
    function healthHarness(reconcile: (input: unknown) => Promise<unknown>, warn = vi.fn()) {
        const resetAt = '2026-11-20T11:00:00.000Z';
        const sync = new JobMarketSync({
            snapshots: { get: async () => ok(snapshot()) },
            marketSync: {
                sync: async () => ok({
                    snapshot: snapshot(),
                    route: [],
                    direct: true,
                    market: { options: {}, lots: [], jobs: { jobs: [], recentJobs: [], nextJobsResetAt: resetAt } },
                }),
            } as unknown as MarketSyncService,
            marketCache: new MarketCacheStore(new MemoryStorageArea()),
            routing: { setEndpointIfNeeded: async () => ok(undefined) },
            tabs: { findCor3Tab: async () => null, send: async () => null },
            events: { publish: () => undefined },
            logger: { debug: () => undefined, info: () => undefined, warn, error: () => undefined },
            reconciler: { reconcile } as never,
            now: () => 1,
            humanDelay: async () => undefined,
        });
        return { sync, warn, resetAt };
    }

    function result(status: 'loaded' | 'partial' | 'unavailable', marketKey = JOB_MARKETS[0]!.key) {
        return {
            marketKey,
            resetAt: '2026-11-20T11:00:00.000Z',
            decisions: [],
            updated: 0,
            recoverable: [],
            pending: 0,
            conflicts: 0,
            skippedActive: 0,
            failedWrites: 0,
            completionWrites: 0,
            completionFailures: 0,
            storeFailed: status !== 'loaded',
            storeStatus: status,
        };
    }

    it('T23 does not silently treat a partial reconciliation as complete success', async () => {
        const warn = vi.fn();
        const { sync } = healthHarness(async () => result('partial'), warn);

        const synced = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(synced.markets[0]?.ok).toBe(true);
        expect(synced.markets[0]?.reconciliationStatus).toBe('partial');
        expect(warn).toHaveBeenCalledWith('job-state', 'Market reconciliation was incomplete; local state was kept', expect.objectContaining({
            market: JOB_MARKETS[0]!.key,
            storeStatus: 'partial',
        }));
    });

    it('T24 exposes storeFailed results and turns a reconciler exception into unavailable', async () => {
        const { sync } = healthHarness(async () => result('unavailable'));

        const synced = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);
        expect(synced.markets[0]?.reconciliationStatus).toBe('unavailable');

        const throwing = healthHarness(async () => { throw new Error('reconciler crashed'); });
        const failed = await throwing.sync.reconcileMarketSnapshot({
            marketKey: JOB_MARKETS[0]!.key,
            resetAt: '2026-11-20T11:00:00.000Z',
            jobs: [],
        });
        expect(failed).toMatchObject({ storeFailed: true, storeStatus: 'unavailable' });
    });

    it('T25 recovers on the next complete reconciliation after a partial one', async () => {
        const reconcile = vi.fn()
            .mockResolvedValueOnce(result('partial'))
            .mockResolvedValueOnce(result('loaded'));
        const { sync } = healthHarness(reconcile);

        const first = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);
        const second = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(first.markets[0]?.reconciliationStatus).toBe('partial');
        expect(second.markets[0]?.reconciliationStatus).toBe('loaded');
    });

    it('T26 keeps normal successful sync behavior when reconciliation is complete', async () => {
        const warn = vi.fn();
        const { sync } = healthHarness(async () => result('loaded'), warn);

        const synced = await sync.syncAll('owner', 'auto-jobs', [JOB_MARKETS[0]!]);

        expect(synced.markets[0]?.ok).toBe(true);
        expect(synced.markets[0]?.reconciliationStatus).toBe('loaded');
        expect(warn).not.toHaveBeenCalled();
    });
});
