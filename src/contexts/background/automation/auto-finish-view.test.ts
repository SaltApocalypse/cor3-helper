import { describe, expect, it } from 'vitest';
import {
    autoFinishLastRunSchema,
    autoFinishMarketSchema,
    autoFinishStateSchema,
    type AutoFinishJobResult,
    type AutoFinishMarketResult,
} from '../../../contracts/auto-finish.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { JobMarketSyncEntry } from './job-market-sync.js';
import { jobIdentityKey } from '../../../contracts/jobs.js';
import { autoFinishMarketBase, buildFinalMarkets, buildLiveMarkets, mergeFinalWithLive } from './auto-finish-view.js';

const failedMarket: JobMarketSyncEntry = {
    marketKey: 'usol',
    label: 'USOL',
    ok: false,
    skipped: 0,
    error: 'market-not-reachable',
    errorCode: 'MARKET_FETCH_FAILED',
    reconciliationStatus: 'partial',
};

describe('auto-finish market view', () => {
    it('drops Auto Jobs diagnostic fields from Auto Finish market payloads', () => {
        const base = autoFinishMarketBase(failedMarket);
        expect('errorCode' in base).toBe(false);
        expect('reconciliationStatus' in base).toBe(false);
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
            completedJobsByMarket: { byMarket: { home: { 'old-job': resetAt } } },
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
            completedJobsByMarket: { byMarket: {} },
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
            completedJobsByMarket: { byMarket: {} },
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

    it('keeps a per-job minigame lock scoped to the locked file', () => {
        const lockedJob: JobOffer = { ...job('locked'), type: 'File Decryption' };
        const otherJob: JobOffer = { ...job('other'), type: 'File Decryption' };
        const jobLocks = {
            lockUntil: (_marketKey: string, jobId: string) => jobId === 'locked' ? 5_000 : undefined,
            isRetryExhausted: () => false,
        } as unknown as JobLockRegistry;
        const markets = buildFinalMarkets({
            synced: {
                jobs: [lockedJob, otherJob],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt }],
            },
            allowedTypes: new Set(['File Decryption']),
            doneIds: new Set(),
            completedJobsByMarket: { byMarket: {} },
            resetByMarket: new Map([['home', resetAt]]),
            locks: jobLocks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'locked')).toMatchObject({
            status: 'retry',
            code: 'MINIGAME_FAILED',
            lockExpiresAt: 5_000,
        });
        expect(markets[0]?.jobs?.find((entry) => entry.jobId === 'other')?.status).toBe('pending');
    });

    it('keeps a lock in one market from blocking another market', () => {
        const homeJob: JobOffer = { ...job('home-locked'), marketKey: 'home', type: 'File Decryption' };
        const darkJob: JobOffer = { ...job('dark-ok'), marketKey: 'dark', type: 'File Decryption' };
        const jobLocks = {
            lockUntil: (marketKey: string, jobId: string) => marketKey === 'home' && jobId === 'home-locked' ? 5_000 : undefined,
            isRetryExhausted: () => false,
        } as unknown as JobLockRegistry;
        const markets = buildFinalMarkets({
            synced: {
                jobs: [homeJob, darkJob],
                markets: [
                    { marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt },
                    { marketKey: 'dark', label: 'DARK', ok: true, skipped: 0, resetAt },
                ],
            },
            allowedTypes: new Set(['File Decryption']),
            doneIds: new Set(),
            completedJobsByMarket: { byMarket: {} },
            resetByMarket: new Map([['home', resetAt], ['dark', resetAt]]),
            locks: jobLocks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });
        expect(markets.find((market) => market.marketKey === 'home')?.jobs?.[0]?.status).toBe('retry');
        expect(markets.find((market) => market.marketKey === 'dark')?.jobs?.[0]?.status).toBe('pending');
    });

    it('does not suppress the same job id in a different market', () => {
        const darkJob: JobOffer = { ...job('shared'), marketKey: 'dark', marketId: 'dark-market' };
        const markets = buildFinalMarkets({
            synced: {
                jobs: [job('shared'), darkJob],
                markets: [
                    { marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt },
                    { marketKey: 'dark', label: 'DARK', ok: true, skipped: 0, resetAt },
                ],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobsByMarket: { byMarket: { home: { shared: resetAt } } },
            resetByMarket: new Map([['home', resetAt], ['dark', resetAt]]),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });

        expect(markets.find((market) => market.marketKey === 'home')?.jobs?.[0]?.status).toBe('done');
        expect(markets.find((market) => market.marketKey === 'dark')?.jobs?.[0]?.status).toBe('pending');
    });

    it('keeps a completed job suppressed when the current reset is unknown', () => {
        const markets = buildFinalMarkets({
            synced: {
                jobs: [job('completed-job')],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: null }],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobsByMarket: { byMarket: { home: { 'completed-job': 'reset-a' } } },
            resetByMarket: new Map(),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });
        expect(markets[0]?.jobs?.[0]?.status).toBe('done');
    });

    it('allows a job whose completion belongs to a different, known reset', () => {
        const markets = buildFinalMarkets({
            synced: {
                jobs: [job('completed-job')],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: 'reset-b' }],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set(),
            completedJobsByMarket: { byMarket: { home: { 'completed-job': 'reset-a' } } },
            resetByMarket: new Map([['home', 'reset-b']]),
            locks,
            outcomes: new Map(),
            failedById: new Map(),
            stopped: false,
            now: 1,
        });
        expect(markets[0]?.jobs?.[0]?.status).toBe('pending');
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
            doneIds: new Set([jobIdentityKey('usol', 'claimed')]),
            completedJobsByMarket: { byMarket: {} },
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

    it('keeps done and failure independently for the same job id in two markets', () => {
        const homeJob: JobOffer = { ...job('shared'), marketKey: 'home', marketId: 'home-market' };
        const darkJob: JobOffer = { ...job('shared'), marketKey: 'dark', marketId: 'dark-market' };
        const markets = buildFinalMarkets({
            synced: {
                jobs: [homeJob, darkJob],
                markets: [
                    { marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt },
                    { marketKey: 'dark', label: 'DARK', ok: true, skipped: 0, resetAt },
                ],
            },
            allowedTypes: new Set(['Data Upload']),
            doneIds: new Set([jobIdentityKey('home', 'shared')]),
            completedJobsByMarket: { byMarket: {} },
            resetByMarket: new Map([['home', resetAt], ['dark', resetAt]]),
            locks,
            outcomes: new Map([[jobIdentityKey('dark', 'shared'), { status: 'failed', reason: 'unknown' }]]),
            failedById: new Map([[jobIdentityKey('dark', 'shared'), {
                job: darkJob,
                error: { code: 'JOB_FAILED', message: 'dark only' },
            }]]),
            stopped: false,
            now: 1,
        });
        expect(markets.find((market) => market.marketKey === 'home')?.jobs?.[0]?.status).toBe('done');
        expect(markets.find((market) => market.marketKey === 'dark')?.jobs?.[0]).toMatchObject({
            status: 'failed',
            error: 'dark only',
        });
    });
});

describe('mergeFinalWithLive', () => {
    const resetAt = '2026-11-20T11:00:00.000Z';

    const market = (overrides: Partial<AutoFinishMarketResult> = {}): AutoFinishMarketResult => ({
        marketKey: 'usol',
        label: 'USOL',
        ok: true,
        skipped: 0,
        jobTotal: 0,
        success: 0,
        retry: 0,
        failed: 0,
        expired: 0,
        pending: 0,
        jobs: [],
        resetAt,
        ...overrides,
    });

    const job = (
        id: string,
        status: AutoFinishJobResult['status'],
        overrides: Partial<AutoFinishJobResult> = {},
    ): AutoFinishJobResult => ({
        jobId: id,
        name: id,
        serverName: null,
        marketKey: 'usol',
        status,
        ...overrides,
    });

    it('T01 keeps a failed market that is absent from live', () => {
        const final = [market({ ok: false, stale: true, error: 'market-not-reachable' })];
        const merged = mergeFinalWithLive(final, []);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ marketKey: 'usol', ok: false, stale: true, error: 'market-not-reachable' });
    });

    it('T02 keeps a claim-only row that is absent from live', () => {
        const final = [market({ jobs: [job('claimed', 'pending')] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [] })]);
        expect(merged[0]?.jobs?.map((entry) => entry.jobId)).toEqual(['claimed']);
        expect(merged[0]?.pending).toBe(1);
    });

    it('T03 does not let live Ready overwrite a final Unknown/failed row', () => {
        const final = [market({ jobs: [job('shared', 'failed', { code: 'COMPLETE_FAILED', error: 'Completion result unconfirmed' })] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [job('shared', 'pending')] })]);
        expect(merged[0]?.jobs?.[0]).toMatchObject({ jobId: 'shared', status: 'failed', code: 'COMPLETE_FAILED' });
        expect(merged[0]?.failed).toBe(1);
    });

    it('T04 keeps a final claim-only row when live does not contain the job', () => {
        const final = [market({ jobs: [job('claimed', 'pending')] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [] })]);
        expect(merged[0]?.jobs?.[0]).toMatchObject({ jobId: 'claimed', status: 'pending' });
    });

    it('T05 uses final fields for the same market/job and keeps live-only jobs', () => {
        const final = [market({ jobs: [job('shared', 'failed', { error: 'final failure', code: 'JOB_FAILED' })] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [
            job('shared', 'pending'),
            job('live-only', 'pending'),
        ] })]);
        expect(merged[0]?.jobs).toEqual([
            expect.objectContaining({ jobId: 'live-only', status: 'pending' }),
            expect.objectContaining({ jobId: 'shared', status: 'failed', error: 'final failure', code: 'JOB_FAILED' }),
        ]);
        expect(merged[0]?.failed).toBe(1);
        expect(merged[0]?.pending).toBe(1);
    });

    it('T06 keeps a cached claim-only row in a failed market when live has no job', () => {
        const final = [market({ ok: false, stale: true, jobs: [job('cached', 'pending')] })];
        const merged = mergeFinalWithLive(final, [market({ ok: false, stale: true, jobs: [] })]);
        expect(merged[0]?.ok).toBe(false);
        expect(merged[0]?.stale).toBe(true);
        expect(merged[0]?.jobs?.[0]).toMatchObject({ jobId: 'cached', status: 'pending' });
    });

    it('T07 keeps one failed market while another market completes', () => {
        const failed = market({ marketKey: 'usol', label: 'USOL', ok: false, error: 'market-not-reachable', jobs: [job('failed', 'failed')] });
        const healthy = market({ marketKey: 'home', label: 'HOME', ok: true, jobs: [job('done', 'done')] });
        const merged = mergeFinalWithLive([failed, healthy], [market({ marketKey: 'home', label: 'HOME', ok: true, jobs: [job('done', 'done')] })]);
        expect(merged.map((entry) => entry.marketKey)).toEqual(['usol', 'home']);
        expect(merged[0]?.ok).toBe(false);
        expect(merged[0]?.jobs?.[0]?.status).toBe('failed');
        expect(merged[1]?.jobs?.[0]?.status).toBe('done');
    });

    it('T08 includes a fresh live-only job without inventing completed', () => {
        const final = [market({ marketKey: 'home', label: 'HOME', ok: true, jobs: [] })];
        const live = [market({ marketKey: 'home', label: 'HOME', ok: true, jobs: [job('fresh', 'pending')] })];
        const merged = mergeFinalWithLive(final, live);
        expect(merged[0]?.jobs?.[0]).toMatchObject({ jobId: 'fresh', status: 'pending' });
        expect(merged[0]?.success).toBe(0);
    });

    it('T09 keeps claim-only pending when live says done', () => {
        const final = [market({ jobs: [job('claim-only', 'pending')] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [job('claim-only', 'done')] })]);
        expect(merged[0]?.jobs?.[0]?.status).toBe('pending');
        expect(merged[0]?.success).toBe(0);
    });

    it('T10 keeps a failed/unconfirmed final row when live says done', () => {
        const final = [market({ jobs: [job('unknown', 'failed', { code: 'COMPLETE_FAILED', error: 'Completion result unconfirmed' })] })];
        const merged = mergeFinalWithLive(final, [market({ jobs: [job('unknown', 'done')] })]);
        expect(merged[0]?.jobs?.[0]).toMatchObject({ jobId: 'unknown', status: 'failed', code: 'COMPLETE_FAILED' });
        expect(merged[0]?.success).toBe(0);
        expect(merged[0]?.failed).toBe(1);
    });

    it('T12 does not merge the same job id across final and live markets', () => {
        const final = [
            market({ marketKey: 'home', label: 'HOME', jobs: [job('shared', 'failed')] }),
            market({ marketKey: 'dark', label: 'DARK', jobs: [job('shared', 'pending')] }),
        ];
        const live = [
            market({ marketKey: 'home', label: 'HOME', jobs: [job('shared', 'done')] }),
            market({ marketKey: 'dark', label: 'DARK', jobs: [job('other', 'pending')] }),
        ];
        const merged = mergeFinalWithLive(final, live);
        const home = merged.find((entry) => entry.marketKey === 'home');
        const dark = merged.find((entry) => entry.marketKey === 'dark');
        expect(home?.jobs?.find((entry) => entry.jobId === 'shared')?.status).toBe('failed');
        expect(dark?.jobs?.find((entry) => entry.jobId === 'shared')?.status).toBe('pending');
        expect(dark?.jobs?.find((entry) => entry.jobId === 'other')?.status).toBe('pending');
    });
});
