import { describe, expect, it } from 'vitest';
import { autoFinishLastRunSchema, autoFinishMarketSchema, autoFinishStateSchema } from '../../../contracts/auto-finish.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { autoFinishMarketBase, buildFinalMarkets, buildLiveMarkets } from './auto-finish-view.js';

const failedMarket: JobMarketSyncEntry = {
    marketKey: 'usol',
    label: 'USOL',
    ok: false,
    skipped: 0,
    error: 'market-not-reachable',
    errorCode: 'MARKET_FETCH_FAILED',
};

describe('auto-finish market view', () => {
    it('drops Auto Jobs errorCode from Auto Finish market payloads', () => {
        const base = autoFinishMarketBase(failedMarket);
        expect('errorCode' in base).toBe(false);
        expect(autoFinishMarketSchema.safeParse({ ...base, jobs: [] }).success).toBe(true);
        const last = {
            runId: 'run-1',
            finishedAt: 1,
            jobs: 0,
            done: 0,
            failed: 0,
            stopped: false,
            markets: [{ ...base, jobs: [] }],
        };
        expect(autoFinishLastRunSchema.safeParse(last).success).toBe(true);
        expect(autoFinishStateSchema.safeParse({ last, completedResets: {} }).success).toBe(true);
    });

    it('keeps failed markets valid after a market refresh failure', () => {
        const markets = buildLiveMarkets(
            { jobs: [], markets: [failedMarket] },
            [],
            new Set(),
            {} as JobLockRegistry,
            1,
        );
        expect(markets).toHaveLength(1);
        expect(autoFinishMarketSchema.safeParse(markets[0]).success).toBe(true);
    });
});

describe('Auto Finish job-level completion', () => {
    const resetAt = '2026-11-16T04:00:00.000Z';
    const job = (id: string): JobOffer => ({
        id,
        name: id,
        type: 'Data Upload',
        marketId: 'home-market',
        marketKey: 'home',
        serverId: 'server-1',
        serverName: 'Server 1',
        rewardCredits: 0,
        rewardReputation: 0,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
    });
    const locks = {
        lockUntil: () => undefined,
        isRetryExhausted: () => false,
    } as unknown as JobLockRegistry;

    it('skips only jobs completed for the current reset, not new jobs in the same market', () => {
        const markets = buildFinalMarkets({
            synced: {
                jobs: [job('old-job'), job('new-job')],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt }],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobs: { 'old-job': resetAt },
            resetByMarket: new Map([['home', resetAt]]),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'old-job')?.status).toBe('skipped');
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'old-job')?.code).toBe('ALREADY_COMPLETED');
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'new-job')?.status).toBe('pending');
    });
});
