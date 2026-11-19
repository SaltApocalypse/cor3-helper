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

    it('reports jobs completed for the current reset as done, not skipped', () => {
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
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'old-job')?.status).toBe('done');
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'new-job')?.status).toBe('pending');
    });

    it('keeps previous job rows for a failed market and marks it stale', () => {
        const previous = {
            marketKey: 'usol',
            label: 'USOL',
            ok: true,
            skipped: 0,
            resetAt,
            jobTotal: 1,
            success: 0,
            jobs: [{ jobId: 'a', name: 'A', serverName: null, marketKey: 'usol', status: 'done' as const }],
        };
        const markets = buildFinalMarkets({
            synced: { jobs: [], markets: [failedMarket] },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobs: {},
            resetByMarket: new Map(),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
            previousMarkets: [previous],
        });
        expect(markets[0]?.stale).toBe(true);
        expect(markets[0]?.jobs?.map((entry) => entry.jobId)).toEqual(['a']);
    });

    it('keeps the rows of markets that were not refreshed', () => {
        const previous = {
            marketKey: 'dark',
            label: 'DARK',
            ok: true,
            skipped: 0,
            jobs: [{ jobId: 'dark-1', name: 'D', serverName: null, marketKey: 'dark', status: 'pending' as const }],
        };
        const markets = buildFinalMarkets({
            synced: {
                jobs: [job('home-1')],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt }],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobs: {},
            resetByMarket: new Map([['home', resetAt]]),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
            previousMarkets: [previous],
        });
        expect(markets.map((market) => market.marketKey)).toEqual(['home', 'dark']);
        expect(markets[1]?.jobs?.[0]?.jobId).toBe('dark-1');
    });

    it('marks decrypt jobs retryable while the game minigame lock is active', () => {
        const lockedJob: JobOffer = { ...job('locked'), type: 'File Decryption' };
        const markets = buildFinalMarkets({
            synced: {
                jobs: [lockedJob],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt }],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobs: {},
            resetByMarket: new Map([['home', resetAt]]),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
            globalLock: 5_000,
        });
        expect(markets[0]?.jobs?.[0]).toMatchObject({
            status: 'retry',
            code: 'MINIGAME_FAILED',
            lockExpiresAt: 5_000,
        });
    });

    it('adds cached claim-only completions to a failed market report', () => {
        const runJob: JobOffer = {
            ...job('claimed'),
            type: 'File Decryption',
            marketKey: 'usol',
            alreadyTaken: true,
            canComplete: true,
        };
        const markets = buildFinalMarkets({
            synced: { jobs: [], markets: [failedMarket] },
            allowedTypes: new Set(['File Decryption']),
            doneIds: new Set(['claimed']),
            completedJobs: {},
            resetByMarket: new Map(),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
            doneJobs: [runJob],
        });
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'claimed')?.status).toBe('done');
        expect(markets[0]?.success).toBe(1);
    });
});
