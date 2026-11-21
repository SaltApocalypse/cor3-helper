import { describe, expect, it, vi } from 'vitest';
import { AutoFinishCoordinator } from './auto-finish.js';
import type { AutoFinishDeps } from './auto-finish-types.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { JobStateRecord } from '../../../contracts/job-state.js';
import type { AutoJobQueueOptions } from '../../../application/auto-job/queue.js';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { MarketCompletedJobsStore } from '../../../infrastructure/storage/market-completed-jobs-store.js';
import type { MarketCompletionStateReadResult, MarketCompletionStorePort } from '../../../application/auto-job/market-completion.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';

const resetAt = '2026-11-20T11:00:00.000Z';

function makeCoordinator(options: { readonly failingCompletionRead?: boolean; readonly failingClear?: boolean } = {}) {
    const settings = settingsV1Schema.parse({ autoFinishEnabled: true });
    const legacy = {
        get: vi.fn(async () => ({ last: null, completedResets: { home: resetAt }, completedJobs: { legacy: resetAt } })),
        set: vi.fn(async () => undefined),
    };
    const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
    const deps = {
        settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) },
        scheduler: { create: vi.fn(), clear: vi.fn(async () => undefined), get: vi.fn(async () => null) },
        events: { publish: vi.fn() },
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        runLogs: { add: vi.fn() },
        clock: { now: () => 1 },
        store: legacy,
        completions: options.failingCompletionRead
            ? {
                getState: async () => { throw new Error('sidecar unavailable'); },
                getCompletion: async () => null,
                clear: async () => undefined,
                pruneMarketBeforeReset: async () => ({ status: 'pruned' as const, removed: 0, state: { byMarket: {} } }),
                recordCompletion: async () => ({ status: 'written' as const }),
            }
            : options.failingClear
                ? {
                    getState: async () => ({ byMarket: { home: { shared: resetAt } } }),
                    getCompletion: async () => resetAt,
                    clear: async () => { throw new Error('clear failed'); },
                    pruneMarketBeforeReset: async () => ({ status: 'pruned' as const, removed: 0, state: { byMarket: {} } }),
                    recordCompletion: async () => ({ status: 'written' as const }),
                }
                : completions,
        locks: {
            isLocked: () => false,
            lockUntil: () => undefined,
            isRetryExhausted: () => false,
            deleteLock: vi.fn(),
            clearAttempts: vi.fn(),
            clearLocks: vi.fn(),
            pruneExpiredLocks: vi.fn(),
            persist: vi.fn(async () => undefined),
            reconcileResets: vi.fn(),
        },
        history: { record: vi.fn(async () => undefined) },
        queue: { run: vi.fn() },
        markets: { syncAll: vi.fn(), syncOne: vi.fn(), refreshCachedOptions: vi.fn(async () => undefined) },
        snapshots: { get: vi.fn(async () => ({ ok: false as const, error: { code: 'NONE', message: 'none' } })) },
        networkOps: { enqueue: vi.fn() },
        humanDelay: async () => undefined,
    } as unknown as AutoFinishDeps;
    const coordinator = new AutoFinishCoordinator(deps);
    const sink = {
        publishSnapshot: vi.fn(),
        scheduleNextRefresh: vi.fn(async () => undefined),
        snapshotView: () => null,
        dismissFailedJobs: vi.fn(async () => ({ dismissed: 0, failed: 0, markets: [], errors: [] })),
    };
    coordinator.attachAutoJobs(sink);
    return { coordinator, deps, legacy, completions, sink };
}

function prefetched() {
    return { jobs: [], markets: [] };
}

describe('AutoFinish completion lifecycle', () => {
    it('clears sidecar persistence and coordinator memory together', async () => {
        const made = makeCoordinator();
        await made.completions.recordCompletion({ marketKey: 'home', jobId: 'shared', resetAt });
        await made.coordinator.restore();
        expect(made.coordinator.completedJobsByMarketSnapshot().byMarket.home?.shared).toBe(resetAt);

        await made.coordinator.run('owner', { clearLocalState: true }, prefetched());

        expect(await made.completions.getState()).toEqual({ byMarket: {} });
        expect(made.coordinator.completedJobsByMarketSnapshot()).toEqual({ byMarket: {} });
        expect(made.legacy.set).toHaveBeenCalledWith(expect.objectContaining({
            completedResets: {},
            completedJobs: {},
        }));
        expect(await made.coordinator.status()).toMatchObject({
            completedJobsByMarket: { byMarket: {} },
            completionStateStatus: 'loaded',
        });
    });

    it('projects durable Unknown jobs in status without changing existing fields', async () => {
        const made = makeCoordinator();
        const record: JobStateRecord = {
            marketKey: 'home',
            jobId: 'shared',
            resetAt,
            status: 'unknown',
            createdAt: resetAt,
            updatedAt: resetAt,
            lastTransitionAt: resetAt,
            errorCode: 'COMPLETE_FAILED',
            unconfirmed: true,
        };
        (made.deps as unknown as { jobStates: { listWithHealth: () => Promise<unknown> } }).jobStates = {
            listWithHealth: async () => ({
                records: [record],
                status: 'loaded',
                shardResults: [],
            }),
        };

        const status = await made.coordinator.status();
        expect(status.unknownJobs).toEqual([{ marketKey: 'home', jobId: 'shared', resetAt }]);
        expect(status.unknownStateStatus).toBe('loaded');
        expect(status.enabled).toBe(true);
        expect(status.running).toBe(false);
        expect(status.completionStateStatus).toBe('not-loaded');
    });

    it('reports a clear failure and does not pretend the cache was emptied', async () => {
        const made = makeCoordinator({ failingClear: true });
        await made.coordinator.restore();
        expect(made.coordinator.completedJobsByMarketSnapshot().byMarket.home?.shared).toBe(resetAt);

        await expect(made.coordinator.run('owner', { clearLocalState: true }, prefetched())).rejects.toThrow('clear failed');
        expect(made.coordinator.completedJobsByMarketSnapshot().byMarket.home?.shared).toBe(resetAt);
    });

    it('does not treat an unreadable sidecar as empty and blocks the run', async () => {
        const made = makeCoordinator({ failingCompletionRead: true });

        await expect(made.coordinator.run('owner', {}, prefetched())).rejects.toThrow('unavailable');
        expect(made.coordinator.completionStateStatus()).toBe('unavailable');
        expect(made.coordinator.completionsAvailable()).toBe(false);
    });

    it('applies a pruned sidecar state to the coordinator cache', () => {
        const made = makeCoordinator();
        made.coordinator.applyCompletedByMarket({ byMarket: { dark: { job: '2026-11-20T12:00:00.000Z' } } });
        expect(made.coordinator.completedJobsByMarketSnapshot()).toEqual({
            byMarket: { dark: { job: '2026-11-20T12:00:00.000Z' } },
        });
    });

    it('keeps a claim-only completion from a failed market in the final report', async () => {
        const made = makeCoordinator();
        const claimOnly: JobOffer = {
            id: 'claimed',
            name: 'Claimed job',
            type: 'Data Upload',
            marketId: 'usol-market',
            marketKey: 'usol',
            serverId: 'server-1',
            serverName: 'Server 1',
            rewardCredits: 0,
            rewardReputation: 0,
            deposit: 0,
            alreadyTaken: true,
            canComplete: true,
        };
        const failedMarket = {
            marketKey: 'usol',
            label: 'USOL',
            ok: false as const,
            skipped: 0,
            error: 'market-not-reachable',
        };
        const queueRun = made.deps.queue.run as unknown as ReturnType<typeof vi.fn>;
        queueRun.mockImplementation(async (jobs: readonly JobOffer[], options: AutoJobQueueOptions) => {
            options.onJobResult?.(jobs[0]!, {
                ok: true,
                value: { route: [], reward: { credits: 1, reputation: 1, renown: 0 } },
            });
            return { stopped: false, done: [...jobs], failed: [] };
        });

        await made.coordinator.run('owner', {}, { jobs: [claimOnly], markets: [failedMarket] });

        const last = made.coordinator.lastRun();
        expect(last?.markets.find((market) => market.marketKey === 'usol')?.jobs)
            .toEqual([expect.objectContaining({ jobId: 'claimed', status: 'done' })]);
    });

    it('updates the live report only for the completed market when job ids match', async () => {
        const made = makeCoordinator();
        const home: JobOffer = {
            id: 'shared', name: 'Shared', type: 'Data Upload', marketId: 'home-market', marketKey: 'home',
            serverId: 'server-1', serverName: 'Server 1', rewardCredits: 0, rewardReputation: 0, deposit: 0,
            alreadyTaken: false, canComplete: false,
        };
        const dark: JobOffer = { ...home, marketId: 'dark-market', marketKey: 'dark' };
        const markets = [
            { marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt },
            { marketKey: 'dark', label: 'DARK', ok: true, skipped: 0, resetAt },
        ];
        const queueRun = made.deps.queue.run as unknown as ReturnType<typeof vi.fn>;
        queueRun.mockImplementation(async (jobs: readonly JobOffer[], options: AutoJobQueueOptions) => {
            options.onJobResult?.(jobs[0]!, {
                ok: true,
                value: { route: [], reward: { credits: 1, reputation: 1, renown: 0 } },
            });
            return { stopped: false, done: jobs.slice(0, 1), failed: [] };
        });

        await made.coordinator.run('owner', {}, { jobs: [home, dark], markets });

        const last = made.coordinator.lastRun();
        expect(last?.markets.find((market) => market.marketKey === 'home')?.jobs?.[0]?.status).toBe('done');
        expect(last?.markets.find((market) => market.marketKey === 'dark')?.jobs?.[0]?.status).toBe('pending');
    });
});

describe('AutoFinish status storage health', () => {
    function completionWithHealth(
        status: 'ok' | 'missing' | 'corrupt' | 'unavailable',
        barriers: Record<string, Record<string, string>> = {},
    ): MarketCompletionStorePort {
        return {
            getState: async () => ({ byMarket: {} }),
            getStateWithHealth: async (): Promise<MarketCompletionStateReadResult> => {
                if (status === 'ok') return { status: 'ok', value: { byMarket: {}, unconfirmedByMarket: barriers } };
                return { status } as MarketCompletionStateReadResult;
            },
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            recordCompletion: async () => ({ status: 'written' }),
            getUnconfirmedState: async () => barriers,
        };
    }

    it('T27 exposes unknownStateStatus partial while keeping successful Unknown data', async () => {
        const made = makeCoordinator();
        (made.deps as unknown as { jobStates: { listWithHealth: () => Promise<unknown> } }).jobStates = {
            listWithHealth: async () => ({
                status: 'partial',
                records: [{
                    marketKey: 'home', jobId: 'shared', resetAt, status: 'unknown', unconfirmed: true,
                    createdAt: resetAt, updatedAt: resetAt, lastTransitionAt: resetAt,
                }],
                shardResults: [],
            }),
        };

        const status = await made.coordinator.status();
        expect(status.unknownStateStatus).toBe('partial');
        expect(status.unknownJobs).toEqual([{ marketKey: 'home', jobId: 'shared', resetAt }]);
    });

    it('T28 exposes unknownStateStatus unavailable when both sources are unreadable', async () => {
        const made = makeCoordinator();
        (made.deps as unknown as { jobStates: { listWithHealth: () => Promise<unknown> } }).jobStates = {
            listWithHealth: async () => ({ status: 'unavailable', records: [], shardResults: [] }),
        };
        (made.deps as unknown as { completions: MarketCompletionStorePort }).completions = completionWithHealth('unavailable');

        const status = await made.coordinator.status();
        expect(status.unknownStateStatus).toBe('unavailable');
        expect(status.unknownJobs).toEqual([]);
    });

    it('T29 never reports completionStateStatus loaded for corrupt or unavailable stores', async () => {
        for (const health of ['corrupt', 'unavailable'] as const) {
            const made = makeCoordinator();
            (made.deps as unknown as { completions: MarketCompletionStorePort }).completions = completionWithHealth(health);

            await made.coordinator.restore();

            expect(made.coordinator.completionStateStatus()).toBe('unavailable');
            expect((await made.coordinator.status()).completionStateStatus).toBe('unavailable');
        }
    });

    it('T30 reports loaded empty for a genuinely missing completion store', async () => {
        const made = makeCoordinator();

        await made.coordinator.restore();

        expect(made.coordinator.completionStateStatus()).toBe('loaded');
        expect(made.coordinator.completedJobsByMarketSnapshot()).toEqual({ byMarket: {} });
        expect((await made.coordinator.status()).completionStateStatus).toBe('loaded');
    });
});
