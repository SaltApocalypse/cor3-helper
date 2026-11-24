import { describe, expect, it, vi } from 'vitest';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import { asEdgeId, asServerId } from '../../../kernel/ids.js';
import { ok } from '../../../kernel/result.js';
import type { JobRoutingDeps } from './job-routing.js';
import { JobRouting } from './job-routing.js';

function job(overrides: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job-1',
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: 'market-home',
        marketKey: 'home',
        marketServerId: 'server-market',
        serverId: 'server-1',
        serverName: 'server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: true,
        canComplete: false,
        ...overrides,
    };
}

function rawMarket(id = 'job-1', resetAt?: string) {
    return {
        ...(resetAt ? { nextJobsResetAt: resetAt } : {}),
        jobs: [{
            id,
            name: 'IP Injection',
            jobType: 'IP_INJECTION',
            relatedServers: [{ id: 'server-1', serverName: 'server' }],
        }],
        recentJobs: [],
    };
}

function routing(send: JobRoutingDeps['tabs']['send']) {
    return new JobRouting({
        snapshots: { get: async () => ({ ok: false, error: { code: 'NONE', message: 'none' } }) },
        endpointCommands: { setEndpoint: async () => ({ ok: true, value: undefined }) },
        endpointMutex: { run: async (run: () => Promise<unknown>) => run() },
        routeExecutor: {},
        serverAccess: {},
        tabs: { findCor3Tab: async () => 1, send },
        logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    } as unknown as JobRoutingDeps);
}

describe('JobRouting.refreshJobAfterTake', () => {
    it('returns a fresh outcome only when the response contains the job', async () => {
        const resetAt = '2026-11-20T11:00:00.000Z';
        const send = vi.fn(async () => ({ ok: true, value: rawMarket('job-1', resetAt) }));
        const result = await routing(send).refreshJobAfterTake(job(), 5_000);

        expect(result).toMatchObject({ ok: true, value: { status: 'fresh', job: { id: 'job-1', marketKey: 'home' }, resetAt } });
        expect(send).toHaveBeenCalledWith(1, {
            type: 'V2_REQUEST_MARKET_JOBS',
            marketId: 'market-home',
            timeoutMs: 5_000,
        });
    });

    it('returns fresh with a null reset when the response has no reset field', async () => {
        const result = await routing(async () => ({ ok: true, value: rawMarket() }))
            .refreshJobAfterTake(job());

        expect(result).toMatchObject({ ok: true, value: { status: 'fresh', resetAt: null } });
    });

    it('returns missing when a successful response does not contain the job', async () => {
        const result = await routing(async () => ({ ok: true, value: rawMarket('other-job') }))
            .refreshJobAfterTake(job());

        expect(result).toMatchObject({ ok: true, value: { status: 'missing' } });
    });

    it('returns failed when the market request fails', async () => {
        const result = await routing(async () => { throw new Error('channel closed'); })
            .refreshJobAfterTake(job());

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('MARKET_COMMAND_FAILED');
    });

    it('returns unavailable when market identity is missing', async () => {
        const result = await routing(async () => ({ ok: true, value: rawMarket() }))
            .refreshJobAfterTake(job({ marketServerId: null }));

        expect(result).toMatchObject({ ok: true, value: { status: 'unavailable' } });
    });
});

const homeId = asServerId('home');
const targetId = asServerId('server-1');

function server(id: ReturnType<typeof asServerId>, typeName: string): NetworkServer {
    return {
        id,
        name: id,
        ip: null,
        typeName,
        cluster: null,
        faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: false },
        endpointCapable: true,
        reachableNow: true,
    };
}

function targetSnapshot(): NetworkSnapshot {
    return {
        version: 1,
        capturedAt: 1,
        homeId,
        endpointId: homeId,
        servers: new Map([
            [homeId, server(homeId, 'Home')],
            [targetId, server(targetId, 'D4RK')],
        ]),
        edges: [{ id: asEdgeId('e0'), a: homeId, b: targetId, hidden: false }],
        maintenanceFingerprint: '',
    };
}

function targetRouting(
    execute: ReturnType<typeof vi.fn>,
    ensureAccess: ReturnType<typeof vi.fn>,
) {
    return new JobRouting({
        snapshots: { get: async () => ok(targetSnapshot()) },
        endpointCommands: { setEndpoint: async () => ok(undefined) },
        endpointMutex: { run: async (run: () => Promise<unknown>) => run() },
        routeExecutor: { execute },
        serverAccess: { ensureAccess },
        tabs: { findCor3Tab: async () => 1, send: async () => ({}) },
        logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    } as unknown as JobRoutingDeps);
}

describe('JobRouting.routeJobToTarget access recovery', () => {
    const hackFailure = {
        ok: false as const,
        error: { code: 'ROUTE_FAILED', message: 'All route attempts failed (direct: GAME_HACK_FAILED sai-hack-not-available)', attempts: [] },
    };
    const routeSuccess = {
        ok: true as const,
        route: { nodes: [{ id: homeId, name: 'home' }, { id: targetId, name: 'server-1' }], edgeIds: [], hiddenEdgeCount: 0, maintenanceFree: true, blocker: null },
        direct: true,
        finalEndpoint: targetId,
    };

    it('hacks the target and retries the route after a hack-related failure', async () => {
        const execute = vi.fn()
            .mockResolvedValueOnce(hackFailure)
            .mockResolvedValueOnce(hackFailure)
            .mockResolvedValueOnce(routeSuccess);
        const ensureAccess = vi.fn(async () => ok(undefined));
        const result = await targetRouting(execute, ensureAccess).routeJobToTarget(job());

        expect(result.ok).toBe(true);
        expect(ensureAccess).toHaveBeenCalledTimes(2);
        expect(execute).toHaveBeenCalledTimes(3);
    });

    it('does not retry the route when target access recovery fails', async () => {
        const execute = vi.fn().mockResolvedValue(hackFailure);
        const ensureAccess = vi.fn(async () => ({ ok: false as const, error: { code: 'NO_ACCESS', message: 'No access granted after hack' } }));
        const result = await targetRouting(execute, ensureAccess).routeJobToTarget(job());

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('ROUTE_FAILED');
        expect(ensureAccess).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(2);
    });
});
