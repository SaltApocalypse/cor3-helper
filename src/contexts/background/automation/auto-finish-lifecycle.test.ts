import { describe, expect, it, vi } from 'vitest';
import { AutoFinishCoordinator } from './auto-finish.js';
import type { AutoFinishDeps } from './auto-finish-types.js';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { MarketCompletedJobsStore } from '../../../infrastructure/storage/market-completed-jobs-store.js';
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
        markets: { syncAll: vi.fn(), syncOne: vi.fn() },
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
});
