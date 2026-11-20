import { describe, expect, it } from 'vitest';
import { isCompletedForMarketReset, MarketCompletionReader } from './market-completion.js';
import type { MarketCompletedJobsState } from '../../contracts/market-completed-jobs.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import { AutoFinishStateStore } from '../../infrastructure/storage/auto-finish-state-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';

const resetA = '2026-11-20T11:00:00.000Z';
const resetB = '2026-11-20T12:00:00.000Z';

const state: MarketCompletedJobsState = {
    byMarket: {
        home: { shared: resetA },
        dark: { shared: resetB },
    },
};

describe('isCompletedForMarketReset', () => {
    it('isolates markets with the same job id', () => {
        expect(isCompletedForMarketReset(state, 'home', 'shared', resetA)).toBe(true);
        expect(isCompletedForMarketReset(state, 'home', 'shared', resetB)).toBe(false);
        expect(isCompletedForMarketReset(state, 'dark', 'shared', resetB)).toBe(true);
        expect(isCompletedForMarketReset(state, 'dark', 'shared', resetA)).toBe(false);
        expect(isCompletedForMarketReset(state, 'soyuz', 'shared', resetA)).toBe(false);
    });

    it('does not treat an unknown current reset as a different known reset', () => {
        expect(isCompletedForMarketReset(state, 'home', 'shared', null)).toBe(true);
        expect(isCompletedForMarketReset(state, 'home', 'shared', 'unknown')).toBe(true);
        expect(isCompletedForMarketReset(state, 'home', 'missing', null)).toBe(false);
    });

    it('rejects incomplete identity without guessing', () => {
        expect(isCompletedForMarketReset(state, '', 'shared', resetA)).toBe(false);
        expect(isCompletedForMarketReset(state, 'home', ' ', resetA)).toBe(false);
    });
});

describe('MarketCompletionReader', () => {
    it('queries only the sidecar store', async () => {
        const area = new MemoryStorageArea();
        const store = new MarketCompletedJobsStore(area);
        const reader = new MarketCompletionReader(store);
        await store.recordCompletion({ marketKey: 'home', jobId: 'shared', resetAt: resetA });

        expect(await reader.isCompletedForMarketReset('home', 'shared', resetA)).toBe(true);
        expect(await reader.isCompletedForMarketReset('dark', 'shared', resetA)).toBe(false);
        expect(await reader.isCompletedForMarketReset('home', 'shared', resetB)).toBe(false);
        expect(await reader.isCompletedForMarketReset('home', 'shared', null)).toBe(true);
    });

    it('does not use legacy jobId-only completedJobs as market evidence', async () => {
        const area = new MemoryStorageArea();
        const legacy = new AutoFinishStateStore(area);
        await legacy.set({
            last: null,
            completedResets: { home: resetA },
            completedJobs: { shared: resetA },
        });
        const reader = new MarketCompletionReader(new MarketCompletedJobsStore(area));

        expect(await reader.isCompletedForMarketReset('home', 'shared', resetA)).toBe(false);
        expect(await reader.isCompletedForMarketReset('dark', 'shared', resetA)).toBe(false);
    });

    it('treats a stored unknown marker conservatively', async () => {
        const area = new MemoryStorageArea();
        await area.set({
            'v2.auto-finish.completedJobs': {
                schemaVersion: 1,
                writtenAt: 1,
                data: { byMarket: { home: { shared: 'unknown' } } },
            },
        });
        const reader = new MarketCompletionReader(new MarketCompletedJobsStore(area));

        expect(await reader.isCompletedForMarketReset('home', 'shared', null)).toBe(true);
        expect(await reader.isCompletedForMarketReset('home', 'shared', resetA)).toBe(false);
    });
});
