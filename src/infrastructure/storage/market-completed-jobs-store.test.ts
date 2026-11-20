import { describe, expect, it } from 'vitest';
import { MarketCompletedJobsStore } from './market-completed-jobs-store.js';
import { AutoFinishStateStore } from './auto-finish-state-store.js';
import { MemoryStorageArea } from './storage-area.js';

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
