import { describe, expect, it, vi } from 'vitest';
import type { JobOffer } from '../../../domains/jobs/model.js';
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
