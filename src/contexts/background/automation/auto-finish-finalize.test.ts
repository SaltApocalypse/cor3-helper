import { describe, expect, it, vi } from 'vitest';
import { autoFinishStateSchema, type AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import type { MarketCompletionStorePort } from '../../../application/auto-job/market-completion.js';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { MarketCompletedJobsStore } from '../../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { finalizeAutoFinish, type FinalizeAutoFinishDeps } from './auto-finish-finalize.js';

const resetAt = '2026-11-16T04:00:00.000Z';
const olderReset = '2026-11-15T04:00:00.000Z';
const newerReset = '2026-11-17T04:00:00.000Z';

function market(overrides: Partial<AutoFinishMarketResult> = {}): AutoFinishMarketResult {
    return {
        marketKey: 'home',
        label: 'HOME',
        ok: true,
        skipped: 0,
        jobTotal: 2,
        success: 1,
        failed: 0,
        retry: 0,
        pending: 0,
        resetAt,
        jobs: [
            { jobId: 'old-job', name: 'old', serverName: null, marketKey: 'home', status: 'done' },
            { jobId: 'new-job', name: 'new', serverName: null, marketKey: 'home', status: 'pending' },
        ],
        ...overrides,
    };
}

function deps(options: { readonly completions?: MarketCompletionStorePort } = {}) {
    const settings = settingsV1Schema.parse({ autoFinishEnabled: true });
    const store = { set: vi.fn(async () => undefined), get: vi.fn(async () => ({ last: null, completedResets: {}, completedJobs: {} })) };
    const completions = options.completions ?? new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
    const value = {
        store,
        completions,
        events: { publish: vi.fn() },
        runLogs: { add: vi.fn() },
        settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) },
        scheduler: { create: vi.fn(), clear: vi.fn(async () => undefined), get: vi.fn(async () => null) },
        snapshots: { get: vi.fn(async () => ({ ok: false as const, error: { code: 'NONE', message: 'none' } })) },
        autoJobs: { dismissFailedJobs: vi.fn(async () => ({ dismissed: 0, failed: 0, markets: [], errors: [] })) },
        now: () => 1_000,
    } as unknown as FinalizeAutoFinishDeps;
    return { deps: value, store, completions, settings };
}

function input(markets: readonly AutoFinishMarketResult[], completedJobs: Readonly<Record<string, string>> = {}) {
    return {
        runId: 'run-1',
        owner: 'test',
        syncedJobs: 2,
        markets,
        failures: [],
        retryEntries: [],
        retryFailuresForSchedule: [],
        completedResets: {},
        completedJobs,
        runDoneCount: 1,
        runnableCount: 1,
        totalRetry: 0,
        totalSkipped: 0,
        totalExpired: 0,
        stopped: false,
        currentSettings: settingsV1Schema.parse({ autoFinishEnabled: true }),
        cancelRequested: () => false,
    };
}

describe('finalizeAutoFinish', () => {
    it('writes done jobs to the sidecar and leaves the legacy map unchanged', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([market()]));

        expect(finalized.completedJobs).toEqual({});
        expect(finalized.completedJobsByMarket.byMarket).toEqual({ home: { 'old-job': resetAt } });
        expect(finalized.completedResets).toEqual({});
        const calls = made.store.set.mock.calls as unknown[][];
        const stored = calls[0]?.[0] as { completedJobs: Record<string, string> } | undefined;
        expect(autoFinishStateSchema.safeParse(stored).success).toBe(true);
        expect(stored?.completedJobs).toEqual({});
        expect(await made.completions.getCompletion('home', 'old-job')).toBe(resetAt);
    });

    it('preserves an existing legacy completedJobs map verbatim', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([market()], { legacy: olderReset }));

        expect(finalized.completedJobs).toEqual({ legacy: olderReset });
        const calls = made.store.set.mock.calls as unknown[][];
        const stored = calls[0]?.[0] as { completedJobs: Record<string, string> } | undefined;
        expect(stored?.completedJobs).toEqual({ legacy: olderReset });
    });

    it('does not mark a zero-job market complete for the reset', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([
            market({ jobTotal: 0, success: 0, pending: 0, jobs: [] }),
        ]));
        expect(finalized.completedResets).toEqual({});
    });

    it('does not write an unknown-reset completion', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([
            market({
                resetAt: null,
                jobTotal: 1,
                success: 1,
                jobs: [{ jobId: 'unknown-job', name: 'unknown', serverName: null, marketKey: 'home', status: 'done' }],
            }),
        ]));
        expect(finalized.completedJobs).toEqual({});
        expect(finalized.completedJobsByMarket.byMarket).toEqual({});
        expect((made.deps.runLogs.add as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
            String(call[3]).includes('reset is unknown'))).toBe(true);
    });

    it('does not write completions from a failed or stale market row', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([
            market({ ok: false, stale: true }),
        ]));

        expect(finalized.completedJobsByMarket.byMarket).toEqual({});
        expect(await made.completions.getCompletion('home', 'old-job')).toBeNull();
    });

    it('is idempotent across repeated finalize passes', async () => {
        const made = deps();
        await finalizeAutoFinish(made.deps, input([market()]));
        const second = await finalizeAutoFinish(made.deps, input([market()]));

        expect(second.completedJobsByMarket.byMarket).toEqual({ home: { 'old-job': resetAt } });
        expect(await made.completions.getCompletion('home', 'old-job')).toBe(resetAt);
    });

    it('records the same job id independently in different markets', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([
            market({
                marketKey: 'home',
                jobs: [{ jobId: 'shared', name: 'shared', serverName: null, marketKey: 'home', status: 'done' }],
            }),
            market({
                marketKey: 'dark',
                label: 'DARK',
                jobs: [{ jobId: 'shared', name: 'shared', serverName: null, marketKey: 'dark', status: 'done' }],
            }),
        ]));

        expect(finalized.completedJobsByMarket.byMarket).toEqual({
            home: { shared: resetAt },
            dark: { shared: resetAt },
        });
    });

    it('advances an older reset with compare-and-set', async () => {
        const made = deps();
        await made.completions.recordCompletion({
            marketKey: 'home',
            jobId: 'old-job',
            resetAt: olderReset,
        });

        await finalizeAutoFinish(made.deps, input([market()]));

        expect(await made.completions.getCompletion('home', 'old-job')).toBe(resetAt);
    });

    it('does not overwrite a newer sidecar reset with an older finalize reset', async () => {
        const made = deps();
        await made.completions.recordCompletion({
            marketKey: 'home',
            jobId: 'old-job',
            resetAt: newerReset,
        });

        const finalized = await finalizeAutoFinish(made.deps, input([market()]));

        expect(finalized.completionWriteFailures).toBe(0);
        expect(await made.completions.getCompletion('home', 'old-job')).toBe(newerReset);
        expect((made.deps.runLogs.add as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
            String(call[3]).includes('not older'))).toBe(true);
    });

    it('keeps completions from concurrent finalize passes for different markets', async () => {
        const made = deps();
        await Promise.all([
            finalizeAutoFinish(made.deps, input([market()])),
            finalizeAutoFinish(made.deps, input([market({
                marketKey: 'dark',
                label: 'DARK',
                jobs: [{ jobId: 'dark-job', name: 'dark', serverName: null, marketKey: 'dark', status: 'done' }],
            })])),
        ]);

        expect((await made.completions.getState()).byMarket).toEqual({
            home: { 'old-job': resetAt },
            dark: { 'dark-job': resetAt },
        });
    });

    it('does not write completions when the sidecar cannot be read', async () => {
        const record = vi.fn(async () => ({ status: 'written' as const }));
        const unavailable: MarketCompletionStorePort = {
            getState: async () => { throw new Error('read failed'); },
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            recordCompletion: record,
        };
        const made = deps({ completions: unavailable });
        const finalized = await finalizeAutoFinish(made.deps, input([market()]));

        expect(finalized.completionStateAvailable).toBe(false);
        expect(finalized.completionWriteFailures).toBe(0);
        expect(record).not.toHaveBeenCalled();
        expect((made.deps.runLogs.add as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
            String(call[3]).includes('Unable to read market-scoped completions'))).toBe(true);
    });

    it('reports a sidecar persistence failure without pretending completion was recorded', async () => {
        const failing: MarketCompletionStorePort = {
            getState: async () => ({ byMarket: {} }),
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            recordCompletion: async () => { throw new Error('sidecar unavailable'); },
        };
        const made = deps({ completions: failing });
        const finalized = await finalizeAutoFinish(made.deps, input([market()]));

        expect(finalized.completionWriteFailures).toBe(1);
        expect(finalized.completedJobs).toEqual({});
        expect(finalized.completedJobsByMarket.byMarket).toEqual({});
        expect((made.deps.runLogs.add as ReturnType<typeof vi.fn>).mock.calls.some((call) =>
            String(call[3]).includes('COMPLETION_STORE_FAILED'))).toBe(true);
    });
});
