import { describe, expect, it } from 'vitest';
import { JobExecutionService } from './execution-service.js';
import type { JobActionPort } from './job-actions.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { JobStateRecorderPort } from './job-state-recorder.js';
import type { MarketCompletionStorePort } from './market-completion.js';
import { JobStateStore } from '../../infrastructure/storage/job-state-store.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from '../../infrastructure/storage/storage-area.js';
import { jobStateKeyId } from '../../contracts/job-state.js';

const resetAt = '2026-11-20T11:00:00.000Z';
const key = { marketKey: 'home', jobId: 'job-1', resetAt };

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

function actions(complete: () => { ok: true; value: { credits: number; reputation: number; renown: number } } | { ok: false; error: { code: string; message: string; unconfirmed?: boolean } }) {
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

function recorder(): JobStateRecorderPort {
    return {
        start: async () => ({ key, transition: async () => undefined }),
    };
}

function service(
    port: JobActionPort,
    options: {
        readonly stateRecorder?: JobStateRecorderPort;
        readonly completions?: MarketCompletionStorePort;
        readonly jobStates?: JobStateStore;
    } = {},
): JobExecutionService {
    return new JobExecutionService(
        port,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        options.stateRecorder,
        undefined,
        options.completions,
        options.jobStates,
    );
}

function hashBucket(id: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < id.length; index++) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % 8;
}

function shardKey(bucket: number): string {
    return `v2.job.state.${bucket}`;
}

async function corruptShard(area: MemoryStorageArea, bucket: number): Promise<void> {
    await area.set({
        [shardKey(bucket)]: {
            schemaVersion: 1,
            writtenAt: 1,
            data: { records: { broken: { status: 'not-a-status' } } },
        },
    });
}

class SelectiveRejectingArea implements StorageArea {
    constructor(
        private readonly base: StorageArea,
        private readonly reject: (key: string) => boolean,
    ) {}

    async get(keys: StorageKey): Promise<Record<string, unknown>> {
        const list = typeof keys === 'string' ? [keys] : keys;
        if (list.some((key) => this.reject(key))) throw new Error('storage unavailable');
        return this.base.get(keys);
    }

    set(items: Record<string, unknown>): Promise<void> {
        return this.base.set(items);
    }

    remove(keys: StorageKey): Promise<void> {
        return this.base.remove(keys);
    }
}

describe('JobExecutionService completion barrier storage health', () => {
    it('T30 blocks when the current job Job State record is corrupt', async () => {
        const area = new MemoryStorageArea();
        const bucket = hashBucket(jobStateKeyId(key));
        await new JobStateStore(area).upsert({
            ...key,
            status: 'claiming',
            createdAt: '2026-11-20T10:00:00.000Z',
            updatedAt: '2026-11-20T10:00:00.000Z',
            lastTransitionAt: '2026-11-20T10:00:00.000Z',
        });
        await corruptShard(area, bucket);
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));

        const result = await service(fake.port, {
            stateRecorder: recorder(),
            completions: new MarketCompletedJobsStore(new MemoryStorageArea()),
            jobStates: new JobStateStore(area),
        }).executeDetailed(job());

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.unconfirmed).toBe(true);
            expect(result.error.message).toContain('Completion state unavailable');
        }
        expect(fake.calls).toEqual([]);
    });

    it('T31 blocks when any Job State shard is only partially readable', async () => {
        const area = new MemoryStorageArea();
        await corruptShard(area, (hashBucket(jobStateKeyId(key)) + 1) % 8);
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));

        const result = await service(fake.port, {
            stateRecorder: recorder(),
            completions: new MarketCompletedJobsStore(new MemoryStorageArea()),
            jobStates: new JobStateStore(area),
        }).executeDetailed(job());

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.unconfirmed).toBe(true);
            expect(result.error.message).toContain('Job state barrier unavailable: partial');
        }
        expect(fake.calls).toEqual([]);
    });

    it('T32 blocks when the Completion Store is corrupt', async () => {
        const completionArea = new MemoryStorageArea();
        await completionArea.set({
            'v2.auto-finish.completedJobs': {
                schemaVersion: 1,
                writtenAt: 1,
                data: { byMarket: 'not-a-map' },
            },
        });
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));

        const result = await service(fake.port, {
            stateRecorder: recorder(),
            completions: new MarketCompletedJobsStore(completionArea),
            jobStates: new JobStateStore(new MemoryStorageArea()),
        }).executeDetailed(job());

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.unconfirmed).toBe(true);
            expect(result.error.message).toContain('Completion barrier unavailable: corrupt');
        }
        expect(fake.calls).toEqual([]);
    });

    it('T33 blocks when the Completion Store is unavailable', async () => {
        const completionArea = new SelectiveRejectingArea(
            new MemoryStorageArea(),
            (candidate) => candidate === 'v2.auto-finish.completedJobs',
        );
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));

        const result = await service(fake.port, {
            stateRecorder: recorder(),
            completions: new MarketCompletedJobsStore(completionArea),
            jobStates: new JobStateStore(new MemoryStorageArea()),
        }).executeDetailed(job());

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.unconfirmed).toBe(true);
            expect(result.error.message).toContain('Completion barrier unavailable: unavailable');
        }
        expect(fake.calls).toEqual([]);
    });

    it('T34 does not block a job when both stores are genuinely missing', async () => {
        const fake = actions(() => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }));

        const result = await service(fake.port, {
            stateRecorder: recorder(),
            completions: new MarketCompletedJobsStore(new MemoryStorageArea()),
            jobStates: new JobStateStore(new MemoryStorageArea()),
        }).executeDetailed(job());

        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['complete']);
    });

    it('T35 keeps the runtimeBarrierFailures protection when the fallback write fails', async () => {
        const completions: MarketCompletionStorePort = {
            recordCompletion: async () => ({ status: 'written' }),
            getCompletion: async () => null,
            getState: async () => ({ byMarket: {} }),
            getStateWithHealth: async () => ({ status: 'ok', value: { byMarket: {} } }),
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            getUnconfirmedState: async () => ({}),
            markUnconfirmed: async () => { throw new Error('fallback unavailable'); },
        };
        const fake = actions(() => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }));
        const execution = service(fake.port, {
            stateRecorder: { start: async () => { throw new Error('job state start failed'); } },
            completions,
        });

        const first = await execution.executeDetailed(job());
        expect(first.ok).toBe(false);
        const second = await execution.executeDetailed(job());
        expect(second.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
    });
});
