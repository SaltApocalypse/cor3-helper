import { describe, expect, it, vi } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import { JobStateRecorder } from './job-state-recorder.js';
import type { JobStateStorePort } from './job-state-port.js';
import { JobStateStore } from '../../infrastructure/storage/job-state-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';

function job(overrides: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job-1',
        name: 'Job',
        type: 'IP Injection',
        marketId: 'market-home',
        marketKey: 'home',
        serverId: 'server-1',
        serverName: 'server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
        ...overrides,
    };
}

function logger() {
    return { warn: vi.fn() };
}

describe('JobStateRecorder', () => {
    it('records a session under the known market reset and preserves createdAt', async () => {
        const area = new MemoryStorageArea();
        const store = new JobStateStore(area, { now: () => 1_000 });
        const recorder = new JobStateRecorder({
            store,
            logger: logger(),
            now: () => 1_000,
            resetAtForMarket: () => 'reset-a',
        });

        const session = await recorder.start(job());
        await session.transition('taking');
        await session.transition('taken');
        await session.transition('completed');

        const stored = await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' });
        expect(stored?.status).toBe('completed');
        expect(stored?.createdAt).toBe('1970-01-01T00:00:01.000Z');

        const restored = await recorder.start(job());
        await restored.transition('failed', { errorCode: 'TAKE_FAILED', message: 'nope' });
        const again = await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' });
        expect(again?.createdAt).toBe(stored?.createdAt);
        expect(again?.status).toBe('failed');
        expect(again?.errorCode).toBe('TAKE_FAILED');
    });

    it('stores an unknown reset as null and does not touch a known reset record', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        const recorder = new JobStateRecorder({
            store,
            logger: logger(),
            resetAtForMarket: () => 'unknown',
        });

        await store.upsert({
            marketKey: 'home',
            jobId: 'job-1',
            resetAt: 'reset-a',
            status: 'completed',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            lastTransitionAt: '2026-01-01T00:00:00.000Z',
        });
        const session = await recorder.start(job());
        await session.transition('taken');

        expect(session.key.resetAt).toBeNull();
        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('taken');
        expect((await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'reset-a' }))?.status).toBe('completed');
    });

    it('logs a storage failure and does not reject the transition', async () => {
        const log = logger();
        const store: JobStateStorePort = {
            get: async () => null,
            list: async () => [],
            upsert: async () => { throw new Error('storage full'); },
            prune: async () => 0,
        };
        const recorder = new JobStateRecorder({ store, logger: log, now: () => 1 });
        const session = await recorder.start(job());

        await expect(session.transition('taking')).resolves.toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith('job-state', 'Failed to persist job lifecycle transition', expect.objectContaining({
            jobId: 'job-1',
            status: 'taking',
            message: 'storage full',
        }));
    });

    it('redacts tokens from persisted error text', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        const recorder = new JobStateRecorder({ store, logger: logger() });
        const session = await recorder.start(job());
        await session.transition('failed', {
            errorCode: 'ACTION_FAILED',
            message: 'Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
        });

        const stored = await store.get({ marketKey: 'home', jobId: 'job-1', resetAt: null });
        expect(stored?.lastError).not.toContain('abc.def.ghi');
        expect(stored?.lastError).not.toContain('eyJhbGciOiJIUzI1NiJ9');
        expect(stored?.lastError).toContain('[REDACTED]');
    });

    it('prunes through the recorder and reports storage failures', async () => {
        const store = new JobStateStore(new MemoryStorageArea());
        await store.upsert({
            marketKey: 'home',
            jobId: 'old',
            resetAt: 'reset-a',
            status: 'completed',
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-01T00:00:00.000Z',
            lastTransitionAt: '2026-11-01T00:00:00.000Z',
        });
        const recorder = new JobStateRecorder({
            store,
            logger: logger(),
            now: () => Date.parse('2026-11-20T00:00:00.000Z'),
        });
        expect(await recorder.prune(60 * 60_000)).toBe(1);

        const log = logger();
        const failing = new JobStateRecorder({
            store: {
                get: async () => null,
                list: async () => [],
                upsert: async () => undefined,
                prune: async () => { throw new Error('prune failed'); },
            },
            logger: log,
        });
        await expect(failing.prune()).resolves.toBe(0);
        expect(log.warn).toHaveBeenCalledWith('job-state', 'Failed to prune job lifecycle state', { message: 'prune failed' });
    });
});
