import { describe, expect, it } from 'vitest';
import { jobStateKeyId, normalizeJobStateResetAt, sameJobStateKey, type JobStateRecord } from '../../contracts/job-state.js';
import { JobStateStore } from './job-state-store.js';
import { MemoryStorageArea } from './storage-area.js';

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
