import { describe, expect, it } from 'vitest';
import { JobExecutionService } from './execution-service.js';
import type { JobActionPort } from './job-actions.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { JobStateRecorderPort } from './job-state-recorder.js';
import type { MarketCompletionStorePort } from './market-completion.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';

const resetAt = '2026-11-20T11:00:00.000Z';
const nextResetAt = '2026-11-21T11:00:00.000Z';

function job(): JobOffer {
    return {
        id: 'job-1',
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: 'home-market',
        marketKey: 'home',
        serverId: 'server-1',
        serverName: 'server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: true,
        canComplete: true,
        conditions: [{ details: { ips: ['1.1.1.1'] } }],
    } as JobOffer;
}

function actions(complete: () => { ok: true; value: { credits: number; reputation: number; renown: number } } | { ok: false; error: { code: string; message: string } }) {
    const calls: string[] = [];
    const port: JobActionPort = {
        take: async () => { calls.push('take'); return { ok: true as const, value: undefined }; },
        complete: async () => { calls.push('complete'); return complete(); },
        getServerFiles: async () => ({ ok: true as const, value: [] }),
        deleteFile: async () => ({ ok: true as const, value: undefined }),
        getServerLogs: async () => ({ ok: true as const, value: [] }),
        deleteLog: async () => ({ ok: true as const, value: undefined }),
        downloadLog: async () => ({ ok: true as const, value: undefined }),
        downloadFile: async () => ({ ok: true as const, value: undefined }),
        getTransit: async () => ({ ok: true as const, value: [] }),
        addTransit: async () => ({ ok: true as const, value: undefined }),
        removeTransit: async () => ({ ok: true as const, value: undefined }),
        uploadFile: async () => ({ ok: true as const, value: undefined }),
        getDownloadsFolder: async () => ({ ok: true as const, value: { id: 'd' } }),
        openFolder: async () => ({ ok: true as const, value: [] }),
        getFileAnalysis: async () => ({ ok: true as const, value: { canDecrypt: true, decryptPower: 1, tags: [], source: null } }),
        decryptFile: async () => ({ ok: true as const, value: undefined }),
    };
    return { calls, port };
}

function failingRecorder(): JobStateRecorderPort {
    return {
        start: async () => { throw new Error('job state start failed'); },
    };
}

function service(
    port: JobActionPort,
    completions: MarketCompletionStorePort,
    resetAtForMarket?: (marketKey: string) => string | null,
): JobExecutionService {
    return new JobExecutionService(
        port,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        failingRecorder(),
        undefined,
        completions,
        undefined,
        resetAtForMarket,
    );
}

describe('Complete barrier when JobStateSession creation fails', () => {
    it('persists a successful ACK sidecar when the session fails but a reset is known', async () => {
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        const result = await service(fake.port, completions, () => resetAt).executeDetailed(job());

        expect(result.ok).toBe(true);
        expect(await completions.getCompletion('home', 'job-1')).toBe(resetAt);
    });

    it('uses the reset captured at execution start when the reset advances before ACK', async () => {
        let currentReset: string | null = resetAt;
        const fake = actions(() => {
            currentReset = nextResetAt;
            return { ok: true, value: { credits: 1, reputation: 1, renown: 0 } };
        });
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        const result = await service(fake.port, completions, () => currentReset).executeDetailed(job());

        expect(result.ok).toBe(true);
        expect(await completions.getCompletion('home', 'job-1')).toBe(resetAt);
        expect(await completions.getCompletion('home', 'job-1')).not.toBe(nextResetAt);
    });

    it('does not adopt a reset that first becomes known at ACK time', async () => {
        let currentReset: string | null = null;
        const fake = actions(() => {
            currentReset = resetAt;
            return { ok: true, value: { credits: 1, reputation: 1, renown: 0 } };
        });
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        const result = await service(fake.port, completions, () => currentReset).executeDetailed(job());

        expect(result.ok).toBe(false);
        expect(await completions.getCompletion('home', 'job-1')).toBeNull();
        expect(await completions.getUnconfirmedState()).toEqual({ home: { 'job-1': 'unknown' } });
    });

    it('writes the completion store fallback for an unconfirmed Complete', async () => {
        const fake = actions(() => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }));
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        const result = await service(fake.port, completions).executeDetailed(job());

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(await completions.getUnconfirmedState()).toEqual({ home: { 'job-1': 'unknown' } });
    });

    it('keeps the fallback across a new service instance after a session failure', async () => {
        const first = actions(() => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }));
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        await service(first.port, completions).executeDetailed(job());

        const second = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));
        const result = await service(second.port, completions).executeDetailed(job());

        expect(result.ok).toBe(false);
        expect(second.calls).toHaveLength(0);
    });

    it('fails closed in the current runtime if even the fallback cannot be written', async () => {
        const fake = actions(() => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }));
        const unavailable: MarketCompletionStorePort = {
            recordCompletion: async () => { throw new Error('sidecar unavailable'); },
            getCompletion: async () => { throw new Error('sidecar unavailable'); },
            getState: async () => { throw new Error('sidecar unavailable'); },
            clear: async () => { throw new Error('sidecar unavailable'); },
            pruneMarketBeforeReset: async () => { throw new Error('sidecar unavailable'); },
            getUnconfirmedState: async () => ({}),
            markUnconfirmed: async () => { throw new Error('sidecar unavailable'); },
        };
        const execution = service(fake.port, unavailable);

        const first = await execution.executeDetailed(job());
        expect(first.ok).toBe(false);
        const second = await execution.executeDetailed(job());

        expect(second.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
    });

    it('fails closed for a successful ACK when no session or reset exists', async () => {
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));
        const completions = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        const result = await service(fake.port, completions).executeDetailed(job());

        expect(result.ok).toBe(false);
        expect(await completions.getState()).toMatchObject({ byMarket: {} });
        expect(await completions.getUnconfirmedState()).toEqual({ home: { 'job-1': 'unknown' } });
    });
});
