import { describe, expect, it } from 'vitest';
import { CompletionRecordWriter } from './completion-record.js';
import { AutoFinishStateStore } from '../../infrastructure/storage/auto-finish-state-store.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';

const resetA = '2026-11-20T11:00:00.000Z';
const resetB = '2026-11-20T12:00:00.000Z';

function makeWriter(area: MemoryStorageArea = new MemoryStorageArea()) {
    const store = new MarketCompletedJobsStore(area, { now: () => 1 });
    return { area, store, writer: new CompletionRecordWriter(store) };
}

function identity(overrides: Partial<{
    marketKey: string;
    jobId: string;
    resetAt: string | null;
    expectedExistingResetAt: string | null;
}> = {}) {
    return { marketKey: 'home', jobId: 'job-1', resetAt: resetA, ...overrides };
}

class FailingStorageArea extends MemoryStorageArea {
    failNextSet = false;

    override async set(items: Record<string, unknown>): Promise<void> {
        if (this.failNextSet) {
            this.failNextSet = false;
            throw new Error('storage write failed');
        }
        await super.set(items);
    }
}

describe('CompletionRecordWriter market-scoped writes', () => {
    it('writes one market-scoped record and identifies its scope', async () => {
        const made = makeWriter();
        const result = await made.writer.record(identity());

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toMatchObject({
                status: 'written',
                marketKey: 'home',
                jobId: 'job-1',
                resetAt: resetA,
                identityScope: 'market-key',
            });
        }
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetA } });
    });

    it('is idempotent for the same market/job/reset', async () => {
        const made = makeWriter();
        await made.writer.record(identity());
        const second = await made.writer.record(identity());

        expect(second.ok).toBe(true);
        if (second.ok) expect(second.value.status).toBe('already-recorded');
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetA } });
    });

    it('keeps different markets and jobs independent', async () => {
        const made = makeWriter();
        await made.writer.record(identity({ marketKey: 'home', jobId: 'shared', resetAt: resetA }));
        await made.writer.record(identity({ marketKey: 'dark', jobId: 'shared', resetAt: resetB }));
        await made.writer.record(identity({ marketKey: 'home', jobId: 'other', resetAt: resetB }));

        expect((await made.store.get()).byMarket).toEqual({
            home: { shared: resetA, other: resetB },
            dark: { shared: resetB },
        });
    });

    it('returns reset-mismatch for a different reset without an explicit guard', async () => {
        const made = makeWriter();
        await made.writer.record(identity({ resetAt: resetA }));

        const result = await made.writer.record(identity({ resetAt: resetB }));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('COMPLETION_RESET_MISMATCH');
            expect(result.error.existingResetAt).toBe(resetA);
        }
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetA } });
    });

    it('allows explicit compare-and-set reset advancement', async () => {
        const made = makeWriter();
        await made.writer.record(identity({ resetAt: resetA }));

        const result = await made.writer.record(identity({
            resetAt: resetB,
            expectedExistingResetAt: resetA,
        }));

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe('written');
            expect(result.value.previousResetAt).toBe(resetA);
        }
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetB } });
    });

    it('rejects a compare-and-set mismatch', async () => {
        const made = makeWriter();
        await made.writer.record(identity({ resetAt: resetA }));

        const result = await made.writer.record(identity({
            resetAt: resetB,
            expectedExistingResetAt: resetB,
        }));

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('COMPLETION_RESET_MISMATCH');
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetA } });
    });

    it('uses expectedExistingResetAt=null to require an absent record', async () => {
        const made = makeWriter();
        const first = await made.writer.record(identity({ expectedExistingResetAt: null }));
        expect(first.ok).toBe(true);

        const second = await made.writer.record(identity({ expectedExistingResetAt: null }));
        expect(second.ok).toBe(false);
        if (!second.ok) expect(second.error.code).toBe('COMPLETION_RESET_MISMATCH');
    });

    it('rejects a guarded write when the expected old record is absent', async () => {
        const made = makeWriter();
        const result = await made.writer.record(identity({ expectedExistingResetAt: resetA }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('COMPLETION_RESET_MISMATCH');
        expect((await made.store.get()).byMarket).toEqual({});
    });

    it('rejects incomplete or unknown identity without writing', async () => {
        const made = makeWriter();
        const cases = [
            identity({ marketKey: '   ' }),
            identity({ jobId: '' }),
            identity({ resetAt: null }),
            identity({ resetAt: 'unknown' }),
            identity({ resetAt: '   ' }),
            identity({ expectedExistingResetAt: 'unknown' }),
        ];
        for (const entry of cases) {
            const result = await made.writer.record(entry);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe('COMPLETION_IDENTITY_INCOMPLETE');
        }
        expect((await made.store.get()).byMarket).toEqual({});
    });

    it('keeps the previous record when persistence fails', async () => {
        const area = new FailingStorageArea();
        const made = makeWriter(area);
        await made.writer.record(identity({ resetAt: resetA }));
        area.failNextSet = true;

        const result = await made.writer.record(identity({ resetAt: resetB, expectedExistingResetAt: resetA }));

        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('COMPLETION_STORE_FAILED');
        expect((await made.store.get()).byMarket).toEqual({ home: { 'job-1': resetA } });
    });

    it('serializes concurrent writes across markets without losing records', async () => {
        const made = makeWriter();
        const writes = Array.from({ length: 20 }, (_, index) => made.writer.record(identity({
            marketKey: ['home', 'dark', 'soyuz', 'usol'][index % 4]!,
            jobId: `job-${index}`,
            resetAt: index % 2 === 0 ? resetA : resetB,
        })));

        const results = await Promise.all(writes);

        expect(results.every((result) => result.ok)).toBe(true);
        const state = await made.store.get();
        expect(Object.values(state.byMarket).reduce((sum, jobs) => sum + Object.keys(jobs).length, 0)).toBe(20);
    });

    it('does not alter the legacy v2.auto-finish completedJobs map', async () => {
        const area = new MemoryStorageArea();
        const legacy = new AutoFinishStateStore(area, { now: () => 1 });
        await legacy.set({
            last: null,
            completedResets: { home: resetA },
            completedJobs: { shared: resetA },
        });
        const made = makeWriter(area);

        await made.writer.record(identity({ marketKey: 'dark', jobId: 'shared', resetAt: resetB }));

        expect((await legacy.get()).completedJobs).toEqual({ shared: resetA });
        expect((await made.store.get()).byMarket).toEqual({ dark: { shared: resetB } });
    });
});
