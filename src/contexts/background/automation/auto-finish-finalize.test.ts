import { describe, expect, it, vi } from 'vitest';
import { autoFinishStateSchema, type AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { finalizeAutoFinish, type FinalizeAutoFinishDeps } from './auto-finish-finalize.js';

const resetAt = '2026-11-16T04:00:00.000Z';

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

function deps(onPersisted = vi.fn()) {
    const settings = settingsV1Schema.parse({ autoFinishEnabled: true });
    const store = { set: vi.fn(async () => undefined) };
    const value = {
        store,
        events: { publish: vi.fn() },
        runLogs: { add: vi.fn() },
        settings: { get: vi.fn(async () => settings), update: vi.fn(async () => settings) },
        scheduler: { create: vi.fn(), clear: vi.fn(async () => undefined), get: vi.fn(async () => null) },
        snapshots: { get: vi.fn(async () => ({ ok: false as const, error: { code: 'NONE', message: 'none' } })) },
        autoJobs: { dismissFailedJobs: vi.fn(async () => ({ dismissed: 0, failed: 0, markets: [], errors: [] })) },
        now: () => 1_000,
        onPersisted,
    } as unknown as FinalizeAutoFinishDeps;
    return { deps: value, store, settings };
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
    it('persists completed job ids without completing a partially finished market', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([market()]));
        expect(finalized.completedJobs).toEqual({ 'old-job': resetAt });
        expect(finalized.completedResets).toEqual({});
        const calls = made.store.set.mock.calls as unknown[][];
        const stored = calls[0]?.[0];
        expect(autoFinishStateSchema.safeParse(stored).success).toBe(true);
    });

    it('does not mark a zero-job market complete for the reset', async () => {
        const made = deps();
        const finalized = await finalizeAutoFinish(made.deps, input([
            market({ jobTotal: 0, success: 0, pending: 0, jobs: [] }),
        ]));
        expect(finalized.completedResets).toEqual({});
    });
});
