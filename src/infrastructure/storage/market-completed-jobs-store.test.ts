import { describe, expect, it } from 'vitest';
import { MarketCompletedJobsStore } from './market-completed-jobs-store.js';
import { AutoFinishStateStore } from './auto-finish-state-store.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from './storage-area.js';

const resetA = '2026-11-20T11:00:00.000Z';
const resetB = '2026-11-20T12:00:00.000Z';
const resetC = '2026-11-20T13:00:00.000Z';

function input(overrides: Partial<{
    marketKey: string;
    jobId: string;
    resetAt: string;
    expectedExistingResetAt: string | null;
}> = {}) {
    return { marketKey: 'home', jobId: 'job-1', resetAt: resetA, ...overrides };
}

describe('MarketCompletedJobsStore', () => {
    it('persists the sidecar envelope and reads it from a new store instance', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 7 });
        await store.recordCompletion(input());

        const raw = (await area.get('v2.auto-finish.completedJobs'))['v2.auto-finish.completedJobs'];
        expect(raw).toMatchObject({ schemaVersion: 1, data: { byMarket: { home: { 'job-1': resetA } } } });

        const restarted = new MarketCompletedJobsStore(area);
        expect(await restarted.getCompletion('home', 'job-1')).toBe(resetA);
        expect(await restarted.getCompletion('dark', 'job-1')).toBeNull();
    });

    it('isolates markets and jobs', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'shared', resetAt: resetA }));
        await store.recordCompletion(input({ marketKey: 'dark', jobId: 'shared', resetAt: resetB }));
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'other', resetAt: resetB }));

        expect(await store.getCompletion('home', 'shared')).toBe(resetA);
        expect(await store.getCompletion('dark', 'shared')).toBe(resetB);
        expect(await store.getCompletion('home', 'other')).toBe(resetB);
        expect(await store.getCompletion('soyuz', 'shared')).toBeNull();
    });

    it('returns already-recorded for the same reset and mismatch for a different reset', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input());

        expect(await store.recordCompletion(input())).toEqual({ status: 'already-recorded' });
        expect(await store.recordCompletion(input({ resetAt: resetB }))).toEqual({
            status: 'reset-mismatch',
            existingResetAt: resetA,
        });
    });

    it('supports compare-and-set reset advancement and rejects stale expectations', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ resetAt: resetA }));

        expect(await store.recordCompletion(input({
            resetAt: resetB,
            expectedExistingResetAt: resetA,
        }))).toEqual({ status: 'written', previousResetAt: resetA });
        expect(await store.recordCompletion(input({
            resetAt: resetC,
            expectedExistingResetAt: resetA,
        }))).toEqual({ status: 'reset-mismatch', existingResetAt: resetB });
        expect(await store.getCompletion('home', 'job-1')).toBe(resetB);
    });

    it('allows expectedExistingResetAt=null only when no record exists', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        expect(await store.recordCompletion(input({ expectedExistingResetAt: null })))
            .toEqual({ status: 'written' });
        expect(await store.recordCompletion(input({ resetAt: resetB, expectedExistingResetAt: null })))
            .toEqual({ status: 'reset-mismatch', existingResetAt: resetA });
    });

    it('serializes a concurrent compare-and-set so only the first writer wins', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ resetAt: resetA }));

        const [second, third] = await Promise.all([
            store.recordCompletion(input({ resetAt: resetB, expectedExistingResetAt: resetA })),
            store.recordCompletion(input({ resetAt: resetC, expectedExistingResetAt: resetA })),
        ]);

        expect(second).toEqual({ status: 'written', previousResetAt: resetA });
        expect(third).toEqual({ status: 'reset-mismatch', existingResetAt: resetB });
        expect(await store.getCompletion('home', 'job-1')).toBe(resetB);
    });

    it('keeps all records under concurrent writes to different markets and jobs', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        const writes = Array.from({ length: 30 }, (_, index) => store.recordCompletion(input({
            marketKey: ['home', 'dark', 'soyuz', 'usol'][index % 4]!,
            jobId: `job-${index}`,
            resetAt: index % 2 === 0 ? resetA : resetB,
        })));

        await Promise.all(writes);

        const state = await store.get();
        expect(Object.values(state.byMarket).reduce((sum, jobs) => sum + Object.keys(jobs).length, 0)).toBe(30);
    });

    it('does not read or write the legacy v2.auto-finish completion map', async () => {
        const area = new MemoryStorageArea();
        const legacy = new AutoFinishStateStore(area, { now: () => 1 });
        await legacy.set({
            last: null,
            completedResets: { home: resetA },
            completedJobs: { 'job-1': resetA },
        });
        const store = new MarketCompletedJobsStore(area);

        expect(await store.getCompletion('home', 'job-1')).toBeNull();
        await store.recordCompletion(input({ marketKey: 'dark', resetAt: resetB }));

        expect((await legacy.get()).completedJobs).toEqual({ 'job-1': resetA });
        expect((await legacy.get()).completedResets).toEqual({ home: resetA });
    });

    it('clears every market record without touching the legacy state', async () => {
        const area = new MemoryStorageArea();
        const legacy = new AutoFinishStateStore(area);
        await legacy.set({ last: null, completedResets: { home: resetA }, completedJobs: { legacy: resetA } });
        const store = new MarketCompletedJobsStore(area);
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'a', resetAt: resetA }));
        await store.recordCompletion(input({ marketKey: 'dark', jobId: 'b', resetAt: resetB }));

        await store.clear();

        expect(await store.getState()).toEqual({ byMarket: {} });
        expect((await legacy.get()).completedJobs).toEqual({ legacy: resetA });
    });

    it('prunes only older resets in the requested market', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'old', resetAt: resetA }));
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'current', resetAt: resetB }));
        await store.recordCompletion(input({ marketKey: 'dark', jobId: 'shared', resetAt: resetA }));

        const pruned = await store.pruneMarketBeforeReset('home', resetB);

        expect(pruned).toMatchObject({ status: 'pruned', removed: 1 });
        expect(await store.getCompletion('home', 'old')).toBeNull();
        expect(await store.getCompletion('home', 'current')).toBe(resetB);
        expect(await store.getCompletion('dark', 'shared')).toBe(resetA);
    });

    it('does not prune a newer or invalid reset and skips unknown resets', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'newer', resetAt: resetC }));
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'invalid', resetAt: 'not-a-date' }));

        expect(await store.pruneMarketBeforeReset('home', resetB)).toMatchObject({ status: 'pruned', removed: 0 });
        expect(await store.getCompletion('home', 'newer')).toBe(resetC);
        expect(await store.getCompletion('home', 'invalid')).toBe('not-a-date');
        expect(await store.pruneMarketBeforeReset('home', 'unknown')).toMatchObject({ status: 'skipped', reason: 'unknown-reset' });
        expect(await store.pruneMarketBeforeReset('home', 'not-a-date')).toMatchObject({ status: 'skipped', reason: 'invalid-reset' });
    });

    it('is idempotent when pruning the same market reset twice', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'old', resetAt: resetA }));

        const first = await store.pruneMarketBeforeReset('home', resetB);
        const second = await store.pruneMarketBeforeReset('home', resetB);
        expect(first.status).toBe('pruned');
        expect(second.status).toBe('pruned');
        if (first.status === 'pruned') expect(first.removed).toBe(1);
        if (second.status === 'pruned') expect(second.removed).toBe(0);
    });

    it('does not lose a new completion when pruning overlaps a write', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'old', resetAt: resetA }));

        const [pruned] = await Promise.all([
            store.pruneMarketBeforeReset('home', resetB),
            store.recordCompletion(input({ marketKey: 'home', jobId: 'new', resetAt: resetC })),
        ]);

        expect(pruned).toMatchObject({ status: 'pruned', removed: 1 });
        expect(await store.getCompletion('home', 'old')).toBeNull();
        expect(await store.getCompletion('home', 'new')).toBe(resetC);
    });

    it('rejects invalid direct writes', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        await expect(store.recordCompletion(input({ marketKey: ' ' }))).rejects.toThrow('marketKey');
        await expect(store.recordCompletion(input({ jobId: '' }))).rejects.toThrow('jobId');
        await expect(store.recordCompletion(input({ resetAt: 'unknown' }))).rejects.toThrow('known reset');
    });
});

describe('MarketCompletedJobsStore unconfirmed barrier', () => {
    it('persists known and unknown barriers and clears them on completion', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'known', resetAt: resetA });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'unknown', resetAt: null });

        const restarted = new MarketCompletedJobsStore(area);
        expect(await restarted.getUnconfirmedState()).toEqual({ home: { known: resetA, unknown: 'unknown' } });

        await restarted.recordCompletion(input({ jobId: 'known', resetAt: resetA }));
        expect(await restarted.getUnconfirmedState()).toEqual({ home: { unknown: 'unknown' } });
        expect(await restarted.getCompletion('home', 'known')).toBe(resetA);
    });

    it('clears one fallback barrier without touching completions or other resets', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.recordCompletion(input({ jobId: 'done', resetAt: resetA }));
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'same', resetAt: resetA });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'other', resetAt: resetB });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'unknown', resetAt: null });
        await store.markUnconfirmed({ marketKey: 'dark', jobId: 'dark-job', resetAt: resetA });

        await store.clearUnconfirmed({ marketKey: 'home', jobId: 'same', resetAt: resetA });
        expect(await store.getUnconfirmedState()).toEqual({
            home: { other: resetB, unknown: 'unknown' },
            dark: { 'dark-job': resetA },
        });

        await store.clearUnconfirmed({ marketKey: 'home', jobId: 'other', resetAt: resetA });
        expect(await store.getUnconfirmedState()).toEqual({
            home: { other: resetB, unknown: 'unknown' },
            dark: { 'dark-job': resetA },
        });

        await store.clearUnconfirmed({ marketKey: 'home', jobId: 'other', resetAt: resetB });
        await store.clearUnconfirmed({ marketKey: 'home', jobId: 'unknown', resetAt: null });
        expect(await store.getUnconfirmedState()).toEqual({ dark: { 'dark-job': resetA } });
        expect(await store.getCompletion('home', 'done')).toBe(resetA);
    });

    it('keeps barriers when pruning older completion resets', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.recordCompletion(input({ jobId: 'old', resetAt: resetA }));
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'blocked', resetAt: resetB });

        await store.pruneMarketBeforeReset('home', resetC);

        expect(await store.getUnconfirmedState()).toEqual({ home: { blocked: resetB } });
        expect(await store.getCompletion('home', 'old')).toBeNull();
    });
});

describe('MarketCompletedJobsStore barrier reset identity', () => {
    it('clears exact-reset and identity-less barriers on confirmed completion but keeps other resets', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'same', resetAt: resetA });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'newer', resetAt: resetA });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'older', resetAt: resetB });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'unknown', resetAt: null });

        await store.recordCompletion(input({ jobId: 'same', resetAt: resetA }));
        await store.recordCompletion(input({ jobId: 'newer', resetAt: resetB }));
        await store.recordCompletion(input({ jobId: 'older', resetAt: resetA }));
        await store.recordCompletion(input({ jobId: 'unknown', resetAt: resetA }));

        expect(await store.getUnconfirmedState()).toEqual({
            home: {
                newer: resetA,
                older: resetB,
            },
        });
    });
});

describe('MarketCompletedJobsStore clear semantics', () => {
    it('clears fallback barriers together with completion records', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.recordCompletion(input());
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'blocked', resetAt: resetA });

        await store.clear();

        expect(await store.getState()).toEqual({ byMarket: {} });
        expect(await store.getUnconfirmedState()).toEqual({});
    });
});

const COMPLETION_KEY = 'v2.auto-finish.completedJobs';

class RejectingCompletionArea implements StorageArea {
    async get(_keys: StorageKey): Promise<Record<string, unknown>> {
        throw new Error('completion storage unavailable');
    }

    async set(_items: Record<string, unknown>): Promise<void> {
        throw new Error('completion storage unavailable');
    }

    async remove(_keys: StorageKey): Promise<void> {
        throw new Error('completion storage unavailable');
    }
}

describe('MarketCompletedJobsStore health reads', () => {
    it('T17 treats a missing key as a normal empty store', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea());
        expect(await store.getStateWithHealth()).toEqual({ status: 'missing' });
        expect(await store.getState()).toEqual({ byMarket: {} });
        expect(await store.getUnconfirmedState()).toEqual({});
    });

    it('T18 reports a valid store as ok with both maps', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.recordCompletion(input());
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'blocked', resetAt: resetB });

        const result = await store.getStateWithHealth();
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;
        expect(result.value.byMarket).toEqual({ home: { 'job-1': resetA } });
        expect(result.value.unconfirmedByMarket).toEqual({ home: { blocked: resetB } });
    });

    it('T19 reports schema corruption as corrupt instead of an empty store', async () => {
        const area = new MemoryStorageArea();
        await area.set({ [COMPLETION_KEY]: { schemaVersion: 1, writtenAt: 1, data: { byMarket: 'not-a-map' } } });
        const store = new MarketCompletedJobsStore(area);

        expect(await store.getStateWithHealth()).toMatchObject({ status: 'corrupt' });
        expect(await store.getState()).toEqual({ byMarket: {} });
    });

    it('T20 reports a storage rejection as unavailable', async () => {
        const store = new MarketCompletedJobsStore(new RejectingCompletionArea());
        expect(await store.getStateWithHealth()).toMatchObject({ status: 'unavailable' });
        await expect(store.getState()).rejects.toThrow('completion storage unavailable');
    });

    it('T21 derives byMarket and unconfirmedByMarket from the same complete read', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 1 });
        await store.recordCompletion(input({ marketKey: 'home', jobId: 'done', resetAt: resetA }));
        await store.markUnconfirmed({ marketKey: 'dark', jobId: 'unknown', resetAt: null });

        const result = await store.getStateWithHealth();
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') return;
        expect(result.value).toMatchObject({
            byMarket: { home: { done: resetA } },
            unconfirmedByMarket: { dark: { unknown: 'unknown' } },
        });
    });

    it('T22 preserves the legacy reading APIs for missing and corrupt stores', async () => {
        const missing = new MarketCompletedJobsStore(new MemoryStorageArea());
        expect(await missing.getState()).toEqual({ byMarket: {} });
        expect(await missing.getUnconfirmedState()).toEqual({});
        expect(await missing.getCompletion('home', 'job-1')).toBeNull();

        const area = new MemoryStorageArea();
        await area.set({ [COMPLETION_KEY]: { nope: true } });
        const corrupt = new MarketCompletedJobsStore(area);
        expect(await corrupt.getState()).toEqual({ byMarket: {} });
        expect(await corrupt.getUnconfirmedState()).toEqual({});
        expect(await corrupt.getCompletion('home', 'job-1')).toBeNull();
    });
});

class ToggleRejectingArea implements StorageArea {
    failWrites = false;
    private readonly base = new MemoryStorageArea();

    get(keys: StorageKey): Promise<Record<string, unknown>> {
        return this.base.get(keys);
    }

    set(items: Record<string, unknown>): Promise<void> {
        if (this.failWrites) return Promise.reject(new Error('write failed'));
        return this.base.set(items);
    }

    remove(keys: StorageKey): Promise<void> {
        return this.base.remove(keys);
    }
}

describe('Completion fallback lifecycle', () => {
    it('F01 persists an identity-less fallback across restarts and duplicate writes', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'job-1', resetAt: null });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'job-1', resetAt: null });

        const restarted = new MarketCompletedJobsStore(area);
        expect(await restarted.getUnconfirmedState()).toEqual({ home: { 'job-1': 'unknown' } });
    });

    it('F02 keeps an identity-less fallback when a reset changes or older records are pruned', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'legacy', resetAt: null });
        await store.pruneMarketBeforeReset('home', resetB);

        expect(await store.getUnconfirmedState()).toEqual({ home: { legacy: 'unknown' } });
    });

    it('F03 releases an identity-less fallback only after a confirmed completion', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'legacy', resetAt: null });

        await store.recordCompletion(input({ jobId: 'legacy', resetAt: resetA }));

        expect(await store.getUnconfirmedState()).toEqual({});
        const restarted = new MarketCompletedJobsStore(area);
        expect(await restarted.getUnconfirmedState()).toEqual({});
    });

    it('F04 keeps a different-reset fallback untouched by an older-reset completion', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'newer', resetAt: resetB });

        await store.recordCompletion(input({ jobId: 'newer', resetAt: resetA }));

        expect(await store.getUnconfirmedState()).toEqual({ home: { newer: resetB } });
    });

    it('F05 does not report release when the completion write fails', async () => {
        const area = new ToggleRejectingArea();
        const store = new MarketCompletedJobsStore(area, { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'legacy', resetAt: null });
        area.failWrites = true;

        await expect(store.recordCompletion(input({ jobId: 'legacy', resetAt: resetA }))).rejects.toThrow('write failed');

        expect(await store.getUnconfirmedState()).toEqual({ home: { legacy: 'unknown' } });
    });

    it('F06 keeps market and job isolation for identity-less fallbacks', async () => {
        const store = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'shared', resetAt: null });
        await store.markUnconfirmed({ marketKey: 'dark', jobId: 'shared', resetAt: null });
        await store.markUnconfirmed({ marketKey: 'home', jobId: 'other', resetAt: null });

        await store.recordCompletion(input({ marketKey: 'home', jobId: 'shared', resetAt: resetA }));

        expect(await store.getUnconfirmedState()).toEqual({
            home: { other: 'unknown' },
            dark: { shared: 'unknown' },
        });
    });
});

describe('Completion Store write safety on corrupt data', () => {
    it('F15 refuses to overwrite corrupt fallback data from write paths', async () => {
        const area = new MemoryStorageArea();
        const corrupt = {
            schemaVersion: 1,
            writtenAt: 1,
            data: {
                byMarket: {},
                unconfirmedByMarket: { home: { 'job-1': 'unknown' } },
                extra: 'not-allowed',
            },
        };
        await area.set({ [COMPLETION_KEY]: corrupt });
        const store = new MarketCompletedJobsStore(area);

        await expect(store.recordCompletion(input())).rejects.toThrow('Stored payload is invalid');
        await expect(store.markUnconfirmed({ marketKey: 'home', jobId: 'job-1', resetAt: null })).rejects.toThrow('Stored payload is invalid');
        await expect(store.pruneMarketBeforeReset('home', resetB)).rejects.toThrow('Stored payload is invalid');

        expect((await area.get(COMPLETION_KEY))[COMPLETION_KEY]).toEqual(corrupt);
    });
});
