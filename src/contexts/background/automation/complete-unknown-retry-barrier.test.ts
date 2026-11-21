import { describe, expect, it, vi } from 'vitest';
import { AutoFinishCoordinator } from './auto-finish.js';
import type { AutoFinishDeps } from './auto-finish-types.js';
import { JobLockRegistry } from './job-locks.js';
import { AutoJobQueueService } from '../../../application/auto-job/queue.js';
import { AutoJobRunner } from '../../../application/auto-job/runner.js';
import { JobExecutionService } from '../../../application/auto-job/execution-service.js';
import { JobStateRecorder } from '../../../application/auto-job/job-state-recorder.js';
import { JobStateReconciler } from '../../../application/auto-job/job-state-reconciler.js';
import { JobStateStore } from '../../../infrastructure/storage/job-state-store.js';
import { MarketCompletedJobsStore } from '../../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from '../../../infrastructure/storage/storage-area.js';
import type { JobActionPort } from '../../../application/auto-job/job-actions.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import { settingsV1Schema } from '../../../contracts/storage.js';
import type { JobStateRecord } from '../../../contracts/job-state.js';
import type { MarketCompletionStorePort } from '../../../application/auto-job/market-completion.js';

const resetAt = '2026-11-20T11:00:00.000Z';

function job(marketKey: string, marketId: string, id = 'shared'): JobOffer {
    return {
        id,
        name: 'IP Injection',
        type: 'IP Injection',
        marketId,
        marketKey,
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

function logger() {
    return { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
}

function locks(): JobLockRegistry {
    return {
        isLocked: () => false,
        lockUntil: () => undefined,
        isRetryExhausted: () => false,
        deleteLock: () => undefined,
        clearAttempts: () => undefined,
        clearLocks: () => undefined,
        pruneExpiredLocks: () => undefined,
        persist: async () => undefined,
        reconcileResets: () => undefined,
        setLock: () => undefined,
        recordRetry: () => undefined,
    } as unknown as JobLockRegistry;
}

function makeHarness(options: {
    readonly jobs: readonly JobOffer[];
    readonly markets: readonly { marketKey: string; label: string; ok: true; skipped: number; resetAt: string }[];
    readonly complete: (job: JobOffer) => { ok: true; value: { credits: number; reputation: number; renown: number } } | { ok: false; error: { code: string; message: string } };
    readonly completions?: MarketCompletionStorePort;
    readonly failJobStateUnconfirmed?: boolean;
    readonly jobStateArea?: StorageArea;
    readonly completionArea?: StorageArea;
}) {
    const calls: string[] = [];
    const actions: JobActionPort = {
        take: async (job) => { calls.push(`take:${job.id}`); return { ok: true as const, value: undefined }; },
        complete: async (job) => {
            calls.push(`complete:${job.id}`);
            return options.complete(job);
        },
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
    const jobStateArea = options.jobStateArea ?? new MemoryStorageArea();
    const jobStore = new JobStateStore(jobStateArea, { now: () => 1 });
    if (options.failJobStateUnconfirmed) {
        const originalUpsert = jobStore.upsert.bind(jobStore);
        jobStore.upsert = async (record) => {
            if (record.unconfirmed === true) throw new Error('job state write failed');
            return originalUpsert(record);
        };
    }
    const completionArea = options.completionArea ?? new MemoryStorageArea();
    const completionStore = options.completions ?? new MarketCompletedJobsStore(completionArea, { now: () => 1 });
    const log = logger();
    const recorder = new JobStateRecorder({ store: jobStore, logger: log, now: () => 1, resetAtForMarket: () => resetAt });
    const execution = new JobExecutionService(
        actions,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        recorder,
        undefined,
        completionStore,
        jobStore,
    );
    const runner = new AutoJobRunner(execution);
    const queue = new AutoJobQueueService(runner);
    const queueRun = vi.spyOn(queue, 'run');
    const settings = settingsV1Schema.parse({ autoFinishEnabled: true, autoCompleteJobTypes: ['IP Injection'] });
    const deps = {
        settings: { get: async () => settings, update: async () => settings },
        scheduler: { create: () => undefined, clear: async () => undefined, get: async () => null },
        events: { publish: () => undefined },
        logger: log,
        runLogs: { add: () => undefined },
        clock: { now: () => 1 },
        store: {
            get: async () => ({ last: null, completedResets: {}, completedJobs: {} }),
            set: async () => undefined,
        },
        completions: completionStore,
        jobStates: jobStore,
        locks: locks(),
        history: { record: async () => undefined },
        queue,
        markets: {
            syncAll: vi.fn(async () => ({ jobs: options.jobs, markets: options.markets })),
            refreshCachedOptions: vi.fn(async () => undefined),
        },
        snapshots: { get: async () => ({ ok: false as const, error: { code: 'NONE', message: 'none' } }) },
        networkOps: { enqueue: vi.fn() },
        humanDelay: async () => undefined,
    } as unknown as AutoFinishDeps;
    const coordinator = new AutoFinishCoordinator(deps);
    coordinator.attachAutoJobs({
        publishSnapshot: () => undefined,
        scheduleNextRefresh: async () => undefined,
        snapshotView: () => null,
        dismissFailedJobs: async () => ({ dismissed: 0, failed: 0, markets: [], errors: [] }),
    });
    return { calls, actions, jobStore, completionStore, recorder, execution, queue, queueRun, deps, coordinator, jobStateArea, completionArea };
}

function prefetched(jobs: readonly JobOffer[], markets: readonly { marketKey: string; label: string; ok: true; skipped: number; resetAt: string }[]) {
    return { jobs, markets };
}

describe('Complete unknown retry barrier', () => {
    it('does not execute the job again through AutoFinish deferred retry', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }),
        });

        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take:shared')).toHaveLength(0);
        expect(made.queueRun).toHaveBeenCalledTimes(1);
        expect((made.deps.markets as unknown as { syncAll: ReturnType<typeof vi.fn> }).syncAll).not.toHaveBeenCalled();
        expect(made.coordinator.lastRun()?.failures?.[0]?.unconfirmed).toBe(true);
        const record = await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt });
        expect(record).toMatchObject({ status: 'unknown', unconfirmed: true });
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
    });

    it('does not execute a previously unconfirmed job on a later AutoFinish selection', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt, status: 'unknown', unconfirmed: true,
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(0);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt }))?.status).toBe('unknown');
    });

    it('releases the barrier only after explicit remote completed and a sidecar write', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }),
        });
        await made.coordinator.run('owner', {}, prefetched([home], [market]));
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt }))?.unconfirmed).toBe(true);

        const reconciler = new JobStateReconciler({
            store: made.jobStore,
            writer: made.recorder,
            completions: made.completionStore,
            logger: logger(),
            now: () => 2,
        });
        const reconciled = await reconciler.reconcile({
            marketKey: 'home',
            resetAt,
            observedAt: 2,
            jobs: [],
            skippedJobs: [{ id: 'shared', name: 'IP Injection', serverName: 'server', status: 'completed', reason: 'completed' }],
        });
        expect(reconciled.completionWrites).toBe(1);
        expect(await made.completionStore.getCompletion('home', 'shared')).toBe(resetAt);
        const completed = await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt });
        expect(completed?.status).toBe('completed');
        expect(completed?.unconfirmed).toBeUndefined();

        await made.coordinator.run('owner', {}, prefetched([home], [market]));
        expect(made.queueRun).toHaveBeenCalledTimes(1);
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
    });

    it('keeps the barrier in the completion store when the Job State write fails', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: false, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } }),
            failJobStateUnconfirmed: true,
        });

        await made.coordinator.run('owner', {}, prefetched([home], [market]));
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
        expect(made.queueRun).toHaveBeenCalledTimes(1);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt }))?.status).toBe('claiming');
        expect(await (made.completionStore as MarketCompletedJobsStore).getUnconfirmedState()).toEqual({ home: { shared: resetAt } });

        await made.coordinator.run('owner', {}, prefetched([home], [market]));
        expect(made.queueRun).toHaveBeenCalledTimes(1);
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
    });

    it('keeps the unknown barrier when the completion sidecar write fails, then recovers', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const real = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => 1 });
        let fail = true;
        const flaky: MarketCompletionStorePort = {
            getState: () => real.getState(),
            getCompletion: (marketKey, jobId) => {
                if (fail) throw new Error('sidecar unavailable');
                return real.getCompletion(marketKey, jobId);
            },
            clear: () => real.clear(),
            pruneMarketBeforeReset: (marketKey, reset) => real.pruneMarketBeforeReset(marketKey, reset),
            recordCompletion: (input) => {
                if (fail) throw new Error('sidecar unavailable');
                return real.recordCompletion(input);
            },
        };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
            completions: flaky,
        });

        await made.coordinator.run('owner', {}, prefetched([home], [market]));
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
        expect(made.queueRun).toHaveBeenCalledTimes(1);
        const blocked = await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt });
        expect(blocked).toMatchObject({ status: 'unknown', unconfirmed: true });
        expect(await real.getState()).toEqual({ byMarket: {} });

        fail = false;
        const reconciler = new JobStateReconciler({
            store: made.jobStore,
            writer: made.recorder,
            completions: real,
            logger: logger(),
            now: () => 2,
        });
        await reconciler.reconcile({
            marketKey: 'home',
            resetAt,
            observedAt: 2,
            jobs: [],
            skippedJobs: [{ id: 'shared', name: 'IP Injection', serverName: 'server', status: 'completed', reason: 'completed' }],
        });
        expect(await real.getCompletion('home', 'shared')).toBe(resetAt);
        const recovered = await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt });
        expect(recovered?.status).toBe('completed');
        expect(recovered?.unconfirmed).toBeUndefined();
    });

    it('fails closed when the Job State barrier is unavailable', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        (made.deps as unknown as { jobStates: { list: () => Promise<never> } }).jobStates = {
            list: async () => { throw new Error('job state unavailable'); },
        };

        await expect(made.coordinator.run('owner', {}, prefetched([home], [market]))).rejects.toThrow('unavailable');
        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(0);
    });

    it('treats a legacy unknown COMPLETE_FAILED record as blocked without backfilling it', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt, status: 'unknown', errorCode: 'COMPLETE_FAILED',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.queueRun).not.toHaveBeenCalled();
        const record = await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt });
        expect(record?.status).toBe('unknown');
        expect(record?.unconfirmed).toBeUndefined();
    });

    it('blocks a null-reset unknown across runs without migrating it', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({
            jobs: [home],
            markets: [market],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt: null, status: 'unknown', unconfirmed: true,
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.queueRun).not.toHaveBeenCalled();
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt: null }))?.status).toBe('unknown');
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt }))?.status).toBeUndefined();
    });

    it('prefers an active Job State reset for a direct Complete over the current snapshot', async () => {
        const made = makeHarness({
            jobs: [],
            markets: [],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt, status: 'claiming',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        expect(await made.coordinator.resolveDirectReset('home', 'shared', '2026-11-21T11:00:00.000Z')).toEqual({ ok: true, resetAt });

        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt, status: 'completed',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', '2026-11-21T11:00:00.000Z')).toEqual({ ok: true, resetAt: '2026-11-21T11:00:00.000Z' });
    });

    it('fails closed on ambiguous multiple active Reset identities', async () => {
        const made = makeHarness({
            jobs: [], markets: [],
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        const state = (resetAtValue: string | null, status: JobStateRecord['status'] = 'unknown'): JobStateRecord => ({
            marketKey: 'home', jobId: 'shared', resetAt: resetAtValue, status,
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        });
        const setRecords = (records: readonly JobStateRecord[]) => {
            (made.deps as unknown as { jobStates: { list: () => Promise<readonly JobStateRecord[]> } }).jobStates = {
                list: async () => records,
            };
        };

        setRecords([]);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', resetAt)).toEqual({ ok: true, resetAt });
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toMatchObject({
            ok: false,
            error: { code: 'COMPLETE_RESET_UNKNOWN' },
        });

        setRecords([state(resetAt), state('2026-11-21T11:00:00.000Z')]);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toMatchObject({
            ok: false,
            error: { code: 'COMPLETE_IDENTITY_AMBIGUOUS' },
        });

        setRecords([state(resetAt), state(resetAt)]);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toEqual({ ok: true, resetAt });

        setRecords([state(resetAt), state(null)]);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toMatchObject({
            ok: false,
            error: { code: 'COMPLETE_IDENTITY_AMBIGUOUS' },
        });

        setRecords([state(resetAt, 'completed'), state('2026-11-21T11:00:00.000Z')]);
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toEqual({
            ok: true,
            resetAt: '2026-11-21T11:00:00.000Z',
        });

        (made.deps as unknown as { jobStates: { list: () => Promise<never> } }).jobStates = {
            list: async () => { throw new Error('store unavailable'); },
        };
        expect(await made.coordinator.resolveDirectReset('home', 'shared', null)).toMatchObject({
            ok: false,
            error: { code: 'COMPLETE_BARRIER_UNAVAILABLE' },
        });
    });

    it('does not let one market unconfirmed block the same job id in another market', async () => {
        const home = job('home', 'home-market');
        const dark = job('dark', 'dark-market');
        const markets = [
            { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt },
            { marketKey: 'dark', label: 'DARK', ok: true as const, skipped: 0, resetAt },
        ];
        const made = makeHarness({
            jobs: [home, dark],
            markets,
            complete: () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 0 } }),
        });
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'shared', resetAt, status: 'unknown', unconfirmed: true,
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        await made.coordinator.run('owner', {}, prefetched([home, dark], markets));

        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
        expect(made.calls).toContain('complete:shared');
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'shared', resetAt }))?.status).toBe('unknown');
        expect((await made.jobStore.get({ marketKey: 'dark', jobId: 'shared', resetAt }))?.status).toBe('completed');
    });
});

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

async function corruptJobStateShard(area: StorageArea, index: number): Promise<void> {
    await area.set({
        [`v2.job.state.${index}`]: {
            schemaVersion: 1,
            writtenAt: 1,
            data: { records: { broken: { status: 'not-a-status' } } },
        },
    });
}

const successCompletion = () => ({ ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } });

describe('AutoFinish completion barrier storage health', () => {
    it('T23 keeps the normal empty-store behavior when every shard reads cleanly', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion });

        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
        expect(made.queueRun).toHaveBeenCalledTimes(1);
    });

    it('T24 fails closed when one Job State shard is corrupt', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const area = new MemoryStorageArea();
        await corruptJobStateShard(area, 0);
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion, jobStateArea: area });

        await expect(made.coordinator.run('owner', {}, prefetched([home], [market])))
            .rejects.toThrow('Job state barrier unavailable');

        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls).toEqual([]);
    });

    it('T25 fails closed when one Job State shard is unavailable', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const area = new SelectiveRejectingArea(new MemoryStorageArea(), (key) => key === 'v2.job.state.1');
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion, jobStateArea: area });

        await expect(made.coordinator.run('owner', {}, prefetched([home], [market])))
            .rejects.toThrow('Job state barrier unavailable');

        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls).toEqual([]);
    });

    it('T26 fails closed when the Completion Store is corrupt', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const area = new MemoryStorageArea();
        await area.set({
            'v2.auto-finish.completedJobs': {
                schemaVersion: 1,
                writtenAt: 1,
                data: { byMarket: 'not-a-map' },
            },
        });
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion, completionArea: area });

        await expect(made.coordinator.run('owner', {}, prefetched([home], [market])))
            .rejects.toThrow('unavailable');

        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls).toEqual([]);
    });

    it('T27 fails closed when the Completion Store is unavailable', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const area = new SelectiveRejectingArea(new MemoryStorageArea(), (key) => key === 'v2.auto-finish.completedJobs');
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion, completionArea: area });

        await expect(made.coordinator.isCompletionBlocked('home', 'shared', resetAt))
            .rejects.toThrow('Completion barrier unavailable');
        await expect(made.coordinator.run('owner', {}, prefetched([home], [market]))).rejects.toThrow();

        expect(made.queueRun).not.toHaveBeenCalled();
        expect(made.calls).toEqual([]);
    });

    it('T28 treats Job State and Completion Store missing keys as normal empty data', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion });

        expect(await made.coordinator.isCompletionBlocked('home', 'shared', resetAt)).toBe(false);
        await made.coordinator.run('owner', {}, prefetched([home], [market]));

        expect(made.calls.filter((call) => call === 'complete:shared')).toHaveLength(1);
    });

    it('T29 a failed barrier never reaches the task execution path', async () => {
        const home = job('home', 'home-market');
        const market = { marketKey: 'home', label: 'HOME', ok: true as const, skipped: 0, resetAt };
        const area = new MemoryStorageArea();
        await corruptJobStateShard(area, 2);
        const made = makeHarness({ jobs: [home], markets: [market], complete: successCompletion, jobStateArea: area });

        await expect(made.coordinator.run('owner', {}, prefetched([home], [market]))).rejects.toThrow();

        expect(made.calls.filter((call) => call.startsWith('take:') || call.startsWith('complete:'))).toEqual([]);
        expect(made.queueRun).not.toHaveBeenCalled();
    });
});
