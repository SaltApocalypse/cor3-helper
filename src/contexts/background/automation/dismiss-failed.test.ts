import { describe, expect, it } from 'vitest';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import type { MarketSyncError, MarketSyncRequest, MarketSyncResult, MarketSyncService } from '../../../application/network/market-sync.js';
import type { DismissFailedJobsService } from '../../../application/auto-job/dismiss.js';
import { asServerId, type ServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';
import { FailedJobDismisser } from './dismiss-failed.js';

const home = asServerId('home');
const endpointA = asServerId('endpoint-a');
const endpointB = asServerId('endpoint-b');
const endpointC = asServerId('endpoint-c');

function server(id: ServerId): NetworkServer {
    return {
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
    };
}

function snapshotAt(endpointId: ServerId | null): NetworkSnapshot {
    return {
        version: 1,
        capturedAt: 1,
        homeId: home,
        endpointId,
        servers: new Map([[home, server(home)]]),
        edges: [],
        maintenanceFingerprint: '',
    };
}

const emptyMarket = { options: {}, lots: [], jobs: { jobs: [], recentJobs: [] } };

function harness(input: {
    readonly initial: Result<NetworkSnapshot, MarketSyncError>;
    readonly sync: (request: MarketSyncRequest, index: number) => Promise<Result<MarketSyncResult, MarketSyncError>>;
}) {
    const starts: Array<ServerId | null> = [];
    let index = 0;
    const dismisser = new FailedJobDismisser({
        snapshots: { get: async () => input.initial },
        marketSync: {
            sync: async (request: MarketSyncRequest) => {
                starts.push(request.snapshot?.endpointId ?? null);
                const result = await input.sync(request, index);
                index += 1;
                return result;
            },
        } as unknown as MarketSyncService,
        service: {
            run: async () => ({ dismissed: [], failed: [], stopped: false }),
        } as unknown as DismissFailedJobsService,
        publishSnapshot: () => undefined,
        runLogs: { add: () => undefined },
        now: () => 1,
    });
    return { dismisser, starts };
}

const first = JOB_MARKETS[0]!;
const second = JOB_MARKETS[1]!;

describe('FailedJobDismisser continuous endpoint state', () => {
    it('starts each market from the endpoint reached by the previous one', async () => {
        const made = harness({
            initial: ok(snapshotAt(endpointA)),
            sync: async (request) => ok({
                snapshot: request.snapshot ?? snapshotAt(endpointA),
                route: [],
                direct: true,
                finalEndpoint: request.marketId === first.marketId ? endpointB : endpointC,
                market: emptyMarket,
            }),
        });

        await made.dismisser.run('owner', 'test', [first.key, second.key]);

        expect(made.starts).toEqual([endpointA, endpointB]);
    });

    it('propagates a confirmed endpoint from a failed route', async () => {
        const made = harness({
            initial: ok(snapshotAt(endpointA)),
            sync: async (request) => {
                if (request.marketId === first.marketId) {
                    return err({ code: 'ROUTE_FAILED', message: 'Target in maintenance', finalEndpoint: endpointB });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(endpointA),
                    route: [],
                    direct: true,
                    finalEndpoint: endpointC,
                    market: emptyMarket,
                });
            },
        });

        await made.dismisser.run('owner', 'test', [first.key, second.key]);

        expect(made.starts).toEqual([endpointA, endpointB]);
    });

    it('keeps the known endpoint when the failed route has no confirmed position', async () => {
        const made = harness({
            initial: ok(snapshotAt(endpointA)),
            sync: async (request) => {
                if (request.marketId === first.marketId) {
                    return err({ code: 'ROUTE_FAILED', message: 'Unknown position' });
                }
                return ok({
                    snapshot: request.snapshot ?? snapshotAt(endpointA),
                    route: [],
                    direct: true,
                    finalEndpoint: endpointC,
                    market: emptyMarket,
                });
            },
        });

        await made.dismisser.run('owner', 'test', [first.key, second.key]);

        expect(made.starts).toEqual([endpointA, endpointA]);
    });
});
