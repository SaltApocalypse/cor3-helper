import { describe, expect, it } from 'vitest';
import { projectUnknownJobs } from './unknown-jobs.js';
import type { JobLifecycleStatus, JobStateRecord } from '../../../contracts/job-state.js';
import type { JobStateListResult } from '../../../application/auto-job/job-state-port.js';
import type { MarketCompletionStateReadResult } from '../../../application/auto-job/market-completion.js';
import { JobStateStore } from '../../../infrastructure/storage/job-state-store.js';
import { MarketCompletedJobsStore } from '../../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';

const at = '2026-11-20T11:00:00.000Z';

function record(
    marketKey: string,
    jobId: string,
    resetAt: string | null,
    patch: Partial<Pick<JobStateRecord, 'status' | 'errorCode' | 'unconfirmed'>> = {},
): JobStateRecord {
    const status: JobLifecycleStatus = patch.status ?? 'unknown';
    return {
        marketKey,
        jobId,
        resetAt,
        status,
        createdAt: at,
        updatedAt: at,
        lastTransitionAt: at,
        ...(patch.errorCode ? { errorCode: patch.errorCode } : {}),
        ...(patch.unconfirmed !== undefined ? { unconfirmed: patch.unconfirmed } : {}),
    };
}

function jobStates(input: {
    readonly records?: readonly JobStateRecord[];
    readonly status?: JobStateListResult['status'];
    readonly error?: Error;
}) {
    return {
        listWithHealth: async (): Promise<JobStateListResult> => {
            if (input.error) throw input.error;
            return { records: input.records ?? [], status: input.status ?? 'loaded', shardResults: [] };
        },
    };
}

function completions(input: {
    readonly value?: Record<string, Record<string, string>>;
    readonly status?: MarketCompletionStateReadResult['status'];
    readonly error?: Error;
}) {
    return {
        getStateWithHealth: async (): Promise<MarketCompletionStateReadResult> => {
            if (input.error) throw input.error;
            const status = input.status ?? 'ok';
            if (status === 'ok') {
                return {
                    status: 'ok',
                    value: {
                        byMarket: {},
                        ...(input.value ? { unconfirmedByMarket: input.value } : {}),
                    },
                };
            }
            return { status } as MarketCompletionStateReadResult;
        },
    };
}

describe('projectUnknownJobs health integration', () => {
    it('T01 keeps loaded when Job State is loaded and Completion Store is ok', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [record('home', 'a', at, { unconfirmed: true })] }),
            completions: completions({ value: {} }),
        });
        expect(result.status).toBe('loaded');
        expect(result.jobs).toEqual([{ marketKey: 'home', jobId: 'a', resetAt: at }]);
    });

    it('T02 treats a missing Completion Store as a trusted empty source', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [record('home', 'a', at, { unconfirmed: true })] }),
            completions: completions({ status: 'missing' }),
        });
        expect(result.status).toBe('loaded');
        expect(result.jobs).toHaveLength(1);
    });

    it('T03 keeps successful-shard Unknown records when Job State is partial', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({
                status: 'partial',
                records: [record('home', 'a', at, { unconfirmed: true })],
            }),
            completions: completions({ value: {} }),
        });
        expect(result.status).toBe('partial');
        expect(result.jobs).toEqual([{ marketKey: 'home', jobId: 'a', resetAt: at }]);
    });

    it('T04 does not turn an unavailable Job State into confirmed empty data', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ status: 'unavailable' }),
            completions: completions({ status: 'missing' }),
        });
        expect(result.status).toBe('unavailable');
        expect(result.jobs).toEqual([]);
    });

    it('T05 does not report loaded when the Completion Store is corrupt', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [record('home', 'a', at, { unconfirmed: true })] }),
            completions: completions({ status: 'corrupt' }),
        });
        expect(result.status).toBe('partial');
        expect(result.jobs).toHaveLength(1);
    });

    it('T06 does not report loaded when the Completion Store is unavailable', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [] }),
            completions: completions({ status: 'unavailable' }),
        });
        expect(result.status).toBe('partial');
    });

    it('T07 reports unavailable when both sources are unavailable', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ status: 'unavailable' }),
            completions: completions({ status: 'unavailable' }),
        });
        expect(result.status).toBe('unavailable');
        expect(result.jobs).toEqual([]);
    });

    it('P08 keeps completion data when Job State is unavailable', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ status: 'unavailable' }),
            completions: completions({ value: { home: { a: at } } }),
        });
        expect(result.status).toBe('partial');
        expect(result.jobs).toEqual([{ marketKey: 'home', jobId: 'a', resetAt: at }]);
    });

    it('P09 merges both sources and deduplicates the same identity', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [record('home', 'a', at, { unconfirmed: true })] }),
            completions: completions({ value: { home: { a: at, b: 'unknown' } } }),
        });
        expect(result.status).toBe('loaded');
        expect(result.jobs).toEqual(expect.arrayContaining([
            { marketKey: 'home', jobId: 'a', resetAt: at },
            { marketKey: 'home', jobId: 'b', resetAt: null },
        ]));
        expect(result.jobs).toHaveLength(2);
    });

    it('P10 keeps different resets for the same market/job', async () => {
        const next = '2026-11-20T12:00:00.000Z';
        const result = await projectUnknownJobs({
            jobStates: jobStates({ records: [record('home', 'a', at, { unconfirmed: true })] }),
            completions: completions({ value: { home: { a: next } } }),
        });
        expect(result.jobs).toEqual(expect.arrayContaining([
            { marketKey: 'home', jobId: 'a', resetAt: at },
            { marketKey: 'home', jobId: 'a', resetAt: next },
        ]));
        expect(result.jobs).toHaveLength(2);
    });

    it('P11 keeps the same job id independent across markets', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({
                records: [
                    record('home', 'shared', at, { unconfirmed: true }),
                    record('dark', 'shared', at, { unconfirmed: true }),
                ],
            }),
            completions: completions({ value: {} }),
        });
        expect(result.jobs).toHaveLength(2);
    });

    it('P12 does not project completed or ordinary unknown records', async () => {
        const result = await projectUnknownJobs({
            jobStates: jobStates({
                records: [
                    record('home', 'done', at, { status: 'completed', unconfirmed: true }),
                    record('home', 'ordinary', at, { status: 'unknown', errorCode: 'GAME_TIMEOUT' }),
                ],
            }),
            completions: completions({ status: 'missing' }),
        });
        expect(result.jobs).toEqual([]);
        expect(result.status).toBe('loaded');
    });
});

describe('Unknown projection fallback lifecycle', () => {
    it('F14 projects an unresolved fallback until confirmed completion, then stops projecting it', async () => {
        const completionArea = new MemoryStorageArea();
        const completions = new MarketCompletedJobsStore(completionArea, { now: () => 1 });
        const jobStates = new JobStateStore(new MemoryStorageArea(), { now: () => 1 });
        await completions.markUnconfirmed({ marketKey: 'home', jobId: 'job-1', resetAt: null });

        const before = await projectUnknownJobs({ jobStates, completions });
        expect(before.status).toBe('loaded');
        expect(before.jobs).toEqual([{ marketKey: 'home', jobId: 'job-1', resetAt: null }]);

        await completions.recordCompletion({ marketKey: 'home', jobId: 'job-1', resetAt: at });

        const after = await projectUnknownJobs({ jobStates, completions });
        expect(after.status).toBe('loaded');
        expect(after.jobs).toEqual([]);

        const restarted = new MarketCompletedJobsStore(completionArea);
        expect((await projectUnknownJobs({ jobStates, completions: restarted })).jobs).toEqual([]);
    });
});
