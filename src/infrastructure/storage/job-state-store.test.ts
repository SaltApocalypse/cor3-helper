import { describe, expect, it } from 'vitest';
import { jobStateKeyId, normalizeJobStateResetAt, sameJobStateKey, type JobStateRecord } from '../../contracts/job-state.js';
import { JobStateStore } from './job-state-store.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from './storage-area.js';

const at = '2026-11-20T10:00:00.000Z';

function record(overrides: Partial<JobStateRecord> = {}): JobStateRecord {
    return {
        marketKey: 'home',
        jobId: 'job-1',
        resetAt: 'reset-a',
        status: 'available',
        createdAt: at,
        updatedAt: at,
        lastTransitionAt: at,
        ...overrides,
    };
}

describe('JobStateStore', () => {
    it('persists a record across a new store instance (worker/browser restart)', async () => {
        const area = new MemoryStorageArea();
        const first = new JobStateStore(area, { now: () => 1 });
        await first.upsert(record({ status: 'taken' }));

        const restarted = new JobStateStore(area, { now: () => 2 });
        const loaded = await restarted.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' });
        expect(loaded?.status).toBe('taken');
        expect(loaded?.createdAt).toBe(at);
    });

    it('isolates the same job id in different markets', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ marketKey: 'home', status: 'taken' }));
        await store.upsert(record({ marketKey: 'dark', status: 'completed' }));

        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' }))?.status).toBe('taken');
        expect((await store.get({ marketKey: 'dark', jobId: 'job-1', resetAt: 'reset-a' }))?.status).toBe('completed');
    });

    it('isolates the same job id across resets and never equates unknown with a known reset', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ resetAt: 'reset-a', status: 'completed' }));
        await store.upsert(record({ resetAt: 'reset-b', status: 'failed' }));
        await store.upsert(record({ resetAt: null, status: 'taken' }));

        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' }))?.status).toBe('completed');
        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-b' }))?.status).toBe('failed');
        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('taken');
        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'unknown' }))?.status).toBe('taken');
        expect(sameJobStateKey(
            { marketKey: 'home', jobId: 'job-1', resetAt: 'unknown' },
            { marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' },
        )).toBe(false);
        expect(normalizeJobStateResetAt('unknown')).toBeNull();
        expect(jobStateKeyId({ marketKey: 'home', jobId: 'job-1', resetAt: 'unknown' }))
            .toBe(jobStateKeyId({ marketKey: 'home', jobId: 'job-1', resetAt: null }));
    });

    it('keeps concurrent updates to different jobs and shards', async () => {
        const area = new MemoryStorageArea();
        const store = new JobStateStore(area);
        const writes = Array.from({ length: 40 }, (_, index) => store.upsert(record({
            marketKey: ['home', 'dark', 'soyuz', 'usol'][index % 4]!,
            jobId: `job-${index}`,
            resetAt: `reset-${index % 3}`,
            status: index % 2 === 0 ? 'taken' : 'completed',
        })));
        await Promise.all(writes);

        const restarted = new JobStateStore(area);
        const list = await restarted.list();
        expect(list).toHaveLength(40);
        expect(new Set(list.map((entry) => entry.jobId)).size).toBe(40);
    });

    it('prunes aged terminal records but keeps every recoverable in-flight record', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'old-completed', status: 'completed', updatedAt: '2026-11-01T00:00:00.000Z' }));
        await store.upsert(record({ jobId: 'old-taken', status: 'taken', updatedAt: '2026-11-01T00:00:00.000Z' }));
        await store.upsert(record({ jobId: 'old-executing', status: 'executing', updatedAt: '2026-11-01T00:00:00.000Z' }));
        await store.upsert(record({ jobId: 'recent-completed', status: 'completed', updatedAt: '2026-11-20T09:59:00.000Z' }));

        const removed = await store.prune({ now: Date.parse(at), maxAgeMs: 60 * 60_000 });

        expect(removed).toBe(1);
        expect((await store.get({ marketKey: 'home', jobId: 'old-completed', resetAt: 'reset-a' }))).toBeNull();
        expect((await store.get({ marketKey: 'home', jobId: 'old-taken', resetAt: 'reset-a' }))?.status).toBe('taken');
        expect((await store.get({ marketKey: 'home', jobId: 'old-executing', resetAt: 'reset-a' }))?.status).toBe('executing');
        expect((await store.get({ marketKey: 'home', jobId: 'recent-completed', resetAt: 'reset-a' }))?.status).toBe('completed');
    });

    it('rejects a malformed record instead of writing it', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await expect(store.upsert({ ...record(), status: 'not-a-status' } as unknown as JobStateRecord))
            .rejects.toThrow();
    });
});

describe('JobStateStore Unknown retention', () => {
    const old = '2026-11-01T00:00:00.000Z';
    const now = Date.parse(at);
    const options = { now, maxAgeMs: 60 * 60_000 };

    it('T01 removes an ordinary failed record after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'failed', status: 'failed', updatedAt: old }));
        expect(await store.prune(options)).toBe(1);
        expect(await store.get({ marketKey: 'home', jobId: 'failed', resetAt: 'reset-a' })).toBeNull();
    });

    it('T02 removes an ordinary completed record after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'completed', status: 'completed', updatedAt: old }));
        expect(await store.prune(options)).toBe(1);
        expect(await store.get({ marketKey: 'home', jobId: 'completed', resetAt: 'reset-a' })).toBeNull();
    });

    it('T03 keeps a legacy Complete Unknown after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'unknown', status: 'unknown', errorCode: 'COMPLETE_FAILED', updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'unknown', resetAt: 'reset-a' }))?.status).toBe('unknown');
    });

    it('T04 keeps an unconfirmed record after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'unconfirmed', status: 'unknown', unconfirmed: true, updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'unconfirmed', resetAt: 'reset-a' }))?.unconfirmed).toBe(true);
    });

    it('T05 keeps an unknown with an undefined errorCode after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'legacy-unknown', status: 'unknown', updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'legacy-unknown', resetAt: 'reset-a' }))?.status).toBe('unknown');
    });

    it('T06 removes a non-Complete unknown after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'ordinary-unknown', status: 'unknown', errorCode: 'GAME_TIMEOUT', updatedAt: old }));
        expect(await store.prune(options)).toBe(1);
        expect(await store.get({ marketKey: 'home', jobId: 'ordinary-unknown', resetAt: 'reset-a' })).toBeNull();
    });

    it('T07 keeps recoverable statuses after the TTL', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'taken', status: 'taken', updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'taken', resetAt: 'reset-a' }))?.status).toBe('taken');
    });

    it('T08 preserves the existing invalid updatedAt behavior', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'invalid-date', status: 'failed', updatedAt: 'not-a-date' }));
        expect(await store.prune(options)).toBe(1);
        expect(await store.get({ marketKey: 'home', jobId: 'invalid-date', resetAt: 'reset-a' })).toBeNull();
    });

    it('T09 keeps Unknown records across resets in the same market', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'shared', resetAt: 'reset-a', status: 'unknown', unconfirmed: true, updatedAt: old }));
        await store.upsert(record({ jobId: 'shared', resetAt: 'reset-b', status: 'unknown', unconfirmed: true, updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'shared', resetAt: 'reset-a' }))?.unconfirmed).toBe(true);
        expect((await store.get({ marketKey: 'home', jobId: 'shared', resetAt: 'reset-b' }))?.unconfirmed).toBe(true);
    });

    it('T10 keeps Unknown records for same job id in different markets', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ marketKey: 'home', jobId: 'shared', status: 'unknown', unconfirmed: true, updatedAt: old }));
        await store.upsert(record({ marketKey: 'dark', jobId: 'shared', status: 'unknown', unconfirmed: true, updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'shared', resetAt: 'reset-a' }))?.unconfirmed).toBe(true);
        expect((await store.get({ marketKey: 'dark', jobId: 'shared', resetAt: 'reset-a' }))?.unconfirmed).toBe(true);
    });

    it('T11 repeated prunes do not remove an unresolved Unknown', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'unknown', status: 'unknown', unconfirmed: true, updatedAt: old }));
        expect(await store.prune(options)).toBe(0);
        expect(await store.prune(options)).toBe(0);
        expect((await store.get({ marketKey: 'home', jobId: 'unknown', resetAt: 'reset-a' }))?.status).toBe('unknown');
    });

    it('T12 returns a resolved completed record to ordinary TTL behavior', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'resolved', status: 'completed', updatedAt: old }));
        expect(await store.prune(options)).toBe(1);
        expect(await store.get({ marketKey: 'home', jobId: 'resolved', resetAt: 'reset-a' })).toBeNull();
    });

    it('T13 pending reconciliation does not refresh or delete an Unknown', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({ jobId: 'pending', status: 'unknown', unconfirmed: true, updatedAt: old }));
        await store.prune(options);
        const after = await store.get({ marketKey: 'home', jobId: 'pending', resetAt: 'reset-a' });
        expect(after).toMatchObject({ status: 'unknown', unconfirmed: true, updatedAt: old });
    });

    it('T14 prune leaves Unknown identity and business fields unchanged', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert(record({
            marketKey: 'usol', jobId: 'identity', resetAt: 'reset-usol',
            status: 'unknown', errorCode: 'COMPLETE_FAILED', lastError: 'unknown result', stage: 'complete',
            unconfirmed: true, updatedAt: old,
        }));
        await store.prune(options);
        expect(await store.get({ marketKey: 'usol', jobId: 'identity', resetAt: 'reset-usol' })).toMatchObject({
            marketKey: 'usol',
            jobId: 'identity',
            resetAt: 'reset-usol',
            status: 'unknown',
            errorCode: 'COMPLETE_FAILED',
            lastError: 'unknown result',
            stage: 'complete',
            unconfirmed: true,
            updatedAt: old,
        });
    });
});

const SHARD_KEY_PREFIX = 'v2.job.state';

function hashBucket(id: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < id.length; index++) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % 8;
}

function idInBucket(bucket: number, prefix: string, marketKey = 'home', resetAt = 'reset-a'): string {
    for (let index = 0; ; index++) {
        const id = `${prefix}-${index}`;
        if (hashBucket(jobStateKeyId({ marketKey, jobId: id, resetAt })) === bucket) return id;
    }
}

function shardKey(bucket: number): string {
    return `${SHARD_KEY_PREFIX}.${bucket}`;
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

class ConditionalRejectingStorageArea implements StorageArea {
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

describe('JobStateStore health reads', () => {
    it('T09 reports loaded when every shard is normally empty', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        const result = await store.listWithHealth();
        expect(result.status).toBe('loaded');
        expect(result.records).toEqual([]);
        expect(result.shardResults).toEqual(Array.from({ length: 8 }, (_, index) => ({ shardIndex: index, status: 'missing' })));
    });

    it('T10 treats missing shards as normal empty while retaining readable records', async () => {
        const area = new MemoryStorageArea();
        const store = new JobStateStore(area);
        await store.upsert(record({ jobId: 'readable' }));

        const result = await store.listWithHealth();
        expect(result.status).toBe('loaded');
        expect(result.records.map((entry) => entry.jobId)).toContain('readable');
        expect(result.shardResults.filter((entry) => entry.status === 'ok')).toHaveLength(1);
        expect(result.shardResults.filter((entry) => entry.status === 'missing')).toHaveLength(7);
    });

    it('T11 reports partial and keeps readable records when one shard is corrupt', async () => {
        const area = new MemoryStorageArea();
        const firstId = idInBucket(0, 'first');
        const secondId = idInBucket(1, 'second');
        const writer = new JobStateStore(area);
        await writer.upsert(record({ jobId: firstId }));
        await writer.upsert(record({ jobId: secondId }));
        await corruptShard(area, 0);

        const result = await new JobStateStore(area).listWithHealth();
        expect(result.status).toBe('partial');
        expect(result.records.map((entry) => entry.jobId)).toEqual([secondId]);
        expect(result.shardResults[0]).toMatchObject({ shardIndex: 0, status: 'corrupt' });
        expect(result.shardResults[1]).toMatchObject({ shardIndex: 1, status: 'ok' });
    });

    it('T12 reports partial and keeps readable records when one shard is unavailable', async () => {
        const base = new MemoryStorageArea();
        const firstId = idInBucket(0, 'first');
        const secondId = idInBucket(1, 'second');
        const writer = new JobStateStore(base);
        await writer.upsert(record({ jobId: firstId }));
        await writer.upsert(record({ jobId: secondId }));
        const area = new ConditionalRejectingStorageArea(base, (key) => key === shardKey(1));

        const result = await new JobStateStore(area).listWithHealth();
        expect(result.status).toBe('partial');
        expect(result.records.map((entry) => entry.jobId)).toEqual([firstId]);
        expect(result.shardResults[0]).toMatchObject({ shardIndex: 0, status: 'ok' });
        expect(result.shardResults[1]).toMatchObject({ shardIndex: 1, status: 'unavailable' });
    });

    it('T13 reports unavailable when no shard can be confirmed', async () => {
        const base = new MemoryStorageArea();
        for (let bucket = 0; bucket < 4; bucket++) await corruptShard(base, bucket);
        const area = new ConditionalRejectingStorageArea(
            base,
            (key) => Array.from({ length: 4 }, (_, index) => shardKey(index + 4)).includes(key),
        );

        const result = await new JobStateStore(area).listWithHealth();
        expect(result.status).toBe('unavailable');
        expect(result.records).toEqual([]);
        expect(result.shardResults.filter((entry) => entry.status === 'corrupt')).toHaveLength(4);
        expect(result.shardResults.filter((entry) => entry.status === 'unavailable')).toHaveLength(4);
    });

    it('T14 does not cache a corrupt shard as a normal empty shard', async () => {
        const area = new MemoryStorageArea();
        const readableId = idInBucket(1, 'readable');
        await new JobStateStore(area).upsert(record({ jobId: readableId }));
        await corruptShard(area, 0);
        const store = new JobStateStore(area);

        expect(await store.list()).toEqual([expect.objectContaining({ jobId: readableId })]);

        const health = await store.listWithHealth();
        expect(health.status).toBe('partial');
        expect(health.shardResults[0]).toMatchObject({ shardIndex: 0, status: 'corrupt' });
    });

    it('T15 preserves the existing successful-read cache behavior', async () => {
        const area = new MemoryStorageArea();
        const jobId = idInBucket(0, 'cached');
        const store = new JobStateStore(area);
        await store.upsert(record({ jobId }));

        await area.set({
            [shardKey(0)]: { schemaVersion: 1, writtenAt: 2, data: { records: {} } },
        });

        expect(await store.get({ marketKey: 'home', jobId, resetAt: 'reset-a' })).toMatchObject({ jobId });
        expect((await store.listWithHealth()).status).toBe('loaded');
    });

    it('T16 keeps market, job and reset identities separate in health reads', async () => {
        const area = new MemoryStorageArea();
        const store = new JobStateStore(area);
        const identities = [
            { marketKey: 'home', jobId: 'shared', resetAt: 'reset-a' },
            { marketKey: 'home', jobId: 'shared', resetAt: 'reset-b' },
            { marketKey: 'dark', jobId: 'shared', resetAt: 'reset-a' },
            { marketKey: 'dark', jobId: 'other', resetAt: 'reset-a' },
        ];
        for (const identity of identities) await store.upsert(record(identity));

        const result = await store.listWithHealth();
        expect(result.status).toBe('loaded');
        expect(result.records).toHaveLength(identities.length);
        for (const identity of identities) {
            expect(await store.getWithHealth(identity)).toMatchObject({ status: 'ok', record: identity });
        }
    });
});
