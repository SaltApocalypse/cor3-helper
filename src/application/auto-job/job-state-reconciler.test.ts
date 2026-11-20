import { describe, expect, it, vi } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { JobLifecycleStatus, JobStateKey, JobStateRecord } from '../../contracts/job-state.js';
import { decideJobStateReconciliation, JobStateReconciler } from './job-state-reconciler.js';
import { JobStateRecorder } from './job-state-recorder.js';
import type { JobStateStorePort } from './job-state-port.js';
import { JobStateStore } from '../../infrastructure/storage/job-state-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import type { MarketCompletionStorePort } from './market-completion.js';

const at = '2026-11-20T10:00:00.000Z';
const observedAt = Date.parse('2026-11-20T10:01:00.000Z');
const resetA = '2026-11-20T11:00:00.000Z';
const resetB = '2026-11-20T12:00:00.000Z';

function job(id: string, extra: Partial<JobOffer> = {}): JobOffer {
    return {
        id,
        name: id,
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
        ...extra,
    };
}

function record(overrides: Partial<JobStateRecord> = {}): JobStateRecord {
    return {
        marketKey: 'home',
        jobId: 'job-1',
        resetAt: resetA,
        status: 'taking',
        createdAt: at,
        updatedAt: at,
        lastTransitionAt: at,
        ...overrides,
    };
}

function logger() {
    return { info: vi.fn(), warn: vi.fn() };
}

async function harness(records: readonly JobStateRecord[], options: {
    readonly active?: (key: JobStateKey) => boolean;
    readonly writer?: { update: (key: unknown, status: JobLifecycleStatus) => Promise<boolean> };
    readonly completions?: MarketCompletionStorePort;
} = {}) {
    const area = new MemoryStorageArea();
    const store = new JobStateStore(area, { now: () => observedAt });
    for (const entry of records) await store.upsert(entry);
    const log = logger();
    const writer = options.writer ?? new JobStateRecorder({ store, logger: log, now: () => observedAt });
    const completions = options.completions ?? new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => observedAt });
    const reconciler = new JobStateReconciler({
        store,
        writer: writer as never,
        completions,
        logger: log,
        now: () => observedAt,
        ...(options.active ? { isActive: options.active } : {}),
    });
    return { area, store, reconciler, log, writer, completions };
}

describe('decideJobStateReconciliation', () => {
    it('recovers taking/taken jobs only when the game says they are claimable', () => {
        expect(decideJobStateReconciliation('taking', 'taken-claimable')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'ready-to-claim',
            recoverable: true,
        });
        expect(decideJobStateReconciliation('taken', 'taken-claimable')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'ready-to-claim',
            recoverable: true,
        });
        expect(decideJobStateReconciliation('ready-to-claim', 'taken-claimable')).toMatchObject({
            outcome: 'recoverable',
            recoverable: true,
        });
    });

    it('keeps every protected request-boundary state pending when the market row is open', () => {
        for (const status of ['taking', 'taken', 'executing', 'waiting-minigame', 'ready-to-claim', 'claiming', 'unknown'] as const) {
            const decision = decideJobStateReconciliation(status, 'available');
            expect(decision).toMatchObject({ outcome: 'pending', recoverable: false });
            expect(decision.nextStatus).toBeUndefined();
        }
        expect(decideJobStateReconciliation('claiming', 'available')).not.toMatchObject({ nextStatus: 'completed' });
        expect(decideJobStateReconciliation('available', 'available')).toMatchObject({ outcome: 'unchanged' });
        expect(decideJobStateReconciliation('blocked', 'available')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'available',
        });
    });

    it('keeps taking pending when the job is absent from a successful snapshot', () => {
        expect(decideJobStateReconciliation('taking', 'absent')).toMatchObject({
            outcome: 'pending',
            recoverable: false,
        });
        expect(decideJobStateReconciliation('taking', 'absent').nextStatus).toBeUndefined();
    });

    it('keeps claiming/unknown pending when the job is taken but not claimable', () => {
        expect(decideJobStateReconciliation('claiming', 'taken')).toMatchObject({
            outcome: 'pending',
            recoverable: false,
        });
        expect(decideJobStateReconciliation('unknown', 'taken')).toMatchObject({
            outcome: 'pending',
            recoverable: false,
        });
    });

    it('recovers claiming/unknown only when the game says canComplete', () => {
        expect(decideJobStateReconciliation('claiming', 'taken-claimable')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'ready-to-claim',
            recoverable: true,
        });
        expect(decideJobStateReconciliation('unknown', 'taken-claimable')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'ready-to-claim',
            recoverable: true,
        });
    });

    it('marks completed only from explicit completed evidence', () => {
        expect(decideJobStateReconciliation('claiming', 'completed')).toMatchObject({
            outcome: 'reconciled',
            nextStatus: 'completed',
        });
        expect(decideJobStateReconciliation('unknown', 'absent')).toMatchObject({
            outcome: 'pending',
        });
        expect(decideJobStateReconciliation('unknown', 'absent').nextStatus).toBeUndefined();
    });

    it('never clears a local completion from a weaker remote observation', () => {
        for (const observation of ['available', 'taken', 'taken-claimable', 'expired', 'failed'] as const) {
            expect(decideJobStateReconciliation('completed', observation)).toMatchObject({
                outcome: 'conflict',
                recoverable: false,
            });
        }
        expect(decideJobStateReconciliation('completed', 'completed').outcome).toBe('unchanged');
    });

    it('keeps taken/executing facts and applies explicit expired/failed evidence', () => {
        expect(decideJobStateReconciliation('taken', 'taken')).toMatchObject({ outcome: 'unchanged' });
        expect(decideJobStateReconciliation('executing', 'taken')).toMatchObject({ outcome: 'unchanged' });
        expect(decideJobStateReconciliation('taken', 'expired')).toMatchObject({ outcome: 'reconciled', nextStatus: 'expired' });
        expect(decideJobStateReconciliation('taken', 'failed')).toMatchObject({ outcome: 'reconciled', nextStatus: 'failed' });
    });

    it('uses taken when a blocked/available record is actually taken remotely', () => {
        expect(decideJobStateReconciliation('blocked', 'taken')).toMatchObject({ outcome: 'reconciled', nextStatus: 'taken' });
        expect(decideJobStateReconciliation('available', 'taken')).toMatchObject({ outcome: 'reconciled', nextStatus: 'taken' });
    });
});

describe('JobStateReconciler', () => {
    it('updates the matching market/reset and leaves other identities untouched', async () => {
        const made = await harness([
            record({ marketKey: 'home', jobId: 'shared', resetAt: resetA, status: 'taking' }),
            record({ marketKey: 'dark', jobId: 'shared', resetAt: resetA, status: 'taking' }),
            record({ marketKey: 'home', jobId: 'shared', resetAt: resetB, status: 'taking' }),
            record({ marketKey: 'home', jobId: 'shared', resetAt: null, status: 'taking' }),
        ]);

        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('shared', { alreadyTaken: true, canComplete: true })],
        });

        expect((await made.store.get({ marketKey: 'home', jobId: 'shared', resetAt: resetA }))?.status).toBe('ready-to-claim');
        expect((await made.store.get({ marketKey: 'dark', jobId: 'shared', resetAt: resetA }))?.status).toBe('taking');
        expect((await made.store.get({ marketKey: 'home', jobId: 'shared', resetAt: resetB }))?.status).toBe('taking');
        expect((await made.store.get({ marketKey: 'home', jobId: 'shared', resetAt: null }))?.status).toBe('taking');
    });

    it('does not match a known reset record while the current reset is unknown', async () => {
        const made = await harness([
            record({ resetAt: resetA, status: 'claiming' }),
            record({ resetAt: null, status: 'claiming' }),
        ]);

        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: null,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('ready-to-claim');
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('claiming');
    });

    it('treats skipped completed/expired rows as explicit terminal evidence', async () => {
        const made = await harness([
            record({ jobId: 'done', status: 'claiming' }),
            record({ jobId: 'expired', status: 'taken' }),
        ]);

        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [
                { id: 'done', name: 'done', serverName: null, status: 'completed', reason: 'Job already completed' },
                { id: 'expired', name: 'expired', serverName: null, status: 'expired', reason: 'Job expired', expired: true },
            ],
        });

        expect((await made.store.get({ marketKey: 'home', jobId: 'done', resetAt: resetA }))?.status).toBe('completed');
        expect((await made.store.get({ marketKey: 'home', jobId: 'expired', resetAt: resetA }))?.status).toBe('expired');
    });

    it('does not overwrite an actively executing job', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'executing' })], {
            active: (key) => key.marketKey === 'home' && key.jobId === 'job-1',
        });

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(result.skippedActive).toBe(1);
        expect(result.recoverable).toEqual([]);
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('executing');
    });

    it('does not overwrite a record written after the market observation', async () => {
        const made = await harness([record({
            jobId: 'job-1',
            status: 'executing',
            updatedAt: new Date(observedAt + 1).toISOString(),
        })]);

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(result.skippedActive).toBe(1);
        expect(result.recoverable).toEqual([]);
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('executing');
    });

    it('reports a failed write without claiming recovery', async () => {
        const writer = { update: vi.fn(async () => false) };
        const made = await harness([record({ jobId: 'job-1', status: 'taking' })], { writer });

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(writer.update).toHaveBeenCalled();
        expect(result.failedWrites).toBe(1);
        expect(result.updated).toBe(0);
        expect(result.recoverable).toEqual([]);
        expect(result.decisions[0]?.persisted).toBe(false);
    });

    it('does not reconcile when the local record list cannot be read', async () => {
        const store: JobStateStorePort = {
            get: async () => null,
            list: async () => { throw new Error('store unavailable'); },
            upsert: async () => undefined,
            prune: async () => 0,
        };
        const log = logger();
        const reconciler = new JobStateReconciler({
            store,
            writer: { update: async () => true },
            logger: log,
            now: () => observedAt,
        });

        const result = await reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(result.storeFailed).toBe(true);
        expect(result.updated).toBe(0);
        expect(result.recoverable).toEqual([]);
        expect(log.warn).toHaveBeenCalled();
    });
});

describe('JobStateReconciler active identity', () => {
    it('does not let an active home job skip the same job id in another market', async () => {
        const made = await harness([
            record({ marketKey: 'home', jobId: 'shared', status: 'taking' }),
            record({ marketKey: 'dark', jobId: 'shared', status: 'taking' }),
        ], {
            active: (key) => key.marketKey === 'home' && key.jobId === 'shared',
        });

        const home = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('shared', { alreadyTaken: true, canComplete: true })],
        });
        const dark = await made.reconciler.reconcile({
            marketKey: 'dark',
            resetAt: resetA,
            observedAt,
            jobs: [job('shared', { marketKey: 'dark', marketId: 'market-dark', alreadyTaken: true, canComplete: true })],
        });

        expect(home.skippedActive).toBe(1);
        expect(dark.skippedActive).toBe(0);
        expect(dark.recoverable).toEqual(['shared']);
        expect((await made.store.get({ marketKey: 'home', jobId: 'shared', resetAt: resetA }))?.status).toBe('taking');
        expect((await made.store.get({ marketKey: 'dark', jobId: 'shared', resetAt: resetA }))?.status).toBe('ready-to-claim');
    });

    it('treats an active-check failure conservatively and keeps the local record', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'executing' })], {
            active: () => { throw new Error('runner unavailable'); },
        });

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(result.skippedActive).toBe(1);
        expect(result.recoverable).toEqual([]);
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('executing');
        expect(made.log.warn).toHaveBeenCalledWith('job-state', 'Active job check failed; keeping lifecycle state', expect.objectContaining({
            marketKey: 'home',
            jobId: 'job-1',
        }));
    });
});

describe('JobStateReconciler completion bridge', () => {
    it('writes explicit completed evidence to the market-scoped sidecar', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'claiming' })]);

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'Job already completed' }],
        });

        expect(result.completionWrites).toBe(1);
        expect(result.completionFailures).toBe(0);
        expect(result.decisions[0]?.completionStatus).toBe('written');
        expect(await made.completions.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
    });

    it('does not write canComplete or other non-completed observations', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'taken' })]);

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [job('job-1', { alreadyTaken: true, canComplete: true })],
        });

        expect(result.completionWrites).toBe(0);
        expect(result.decisions[0]?.completionStatus).toBeUndefined();
        expect(await made.completions.getCompletion('home', 'job-1')).toBeNull();
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('ready-to-claim');
    });

    it('does not write when the current reset is unknown', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'claiming', resetAt: null })]);

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: null,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        });

        expect(result.completionWrites).toBe(0);
        expect(result.decisions[0]?.completionStatus).toBe('skipped-unknown-reset');
        expect(await made.completions.getState()).toEqual({ byMarket: {} });
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('completed');
    });

    it('isolates the same job id across markets', async () => {
        const made = await harness([
            record({ marketKey: 'home', jobId: 'shared', status: 'claiming' }),
            record({ marketKey: 'dark', jobId: 'shared', status: 'claiming' }),
        ]);

        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'shared', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        });
        expect(await made.completions.getCompletion('home', 'shared')).toBe(resetA);
        expect(await made.completions.getCompletion('dark', 'shared')).toBeNull();
    });

    it('is idempotent for repeated completed evidence', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'claiming' })]);
        const input = {
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        };

        const first = await made.reconciler.reconcile(input);
        const second = await made.reconciler.reconcile(input);

        expect(first.completionWrites).toBe(1);
        expect(second.completionWrites).toBe(0);
        expect(second.decisions[0]?.completionStatus).toBe('already-recorded');
        expect((await made.completions.getState()).byMarket.home).toEqual({ 'job-1': resetA });
    });

    it('advances an older sidecar reset and preserves a newer one', async () => {
        const made = await harness([record({ jobId: 'job-1', status: 'claiming' })]);
        await made.completions.recordCompletion({ marketKey: 'home', jobId: 'job-1', resetAt: '2026-11-20T09:00:00.000Z' });

        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        });
        expect(await made.completions.getCompletion('home', 'job-1')).toBe(resetA);

        await made.completions.recordCompletion({ marketKey: 'home', jobId: 'later', resetAt: resetB });
        await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'later', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        });
        expect(await made.completions.getCompletion('home', 'later')).toBe(resetB);
    });

    it('keeps Job State incomplete when the completion write fails, then retries', async () => {
        let fail = true;
        const base = new MarketCompletedJobsStore(new MemoryStorageArea(), { now: () => observedAt });
        const completions: MarketCompletionStorePort = {
            getState: () => base.getState(),
            getCompletion: (marketKey, jobId) => base.getCompletion(marketKey, jobId),
            clear: () => base.clear(),
            pruneMarketBeforeReset: (marketKey, currentResetAt) => base.pruneMarketBeforeReset(marketKey, currentResetAt),
            recordCompletion: async (input) => {
                if (fail) throw new Error('sidecar write failed');
                return base.recordCompletion(input);
            },
        };
        const made = await harness([record({ jobId: 'job-1', status: 'claiming' })], { completions });
        const input = {
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        };

        const failed = await made.reconciler.reconcile(input);
        expect(failed.completionFailures).toBe(1);
        expect(failed.decisions[0]?.completionStatus).toBe('failed');
        expect(failed.decisions[0]?.outcome).toBe('pending');
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('claiming');
        expect(await made.completions.getCompletion('home', 'job-1')).toBeNull();

        fail = false;
        const retried = await made.reconciler.reconcile(input);
        expect(retried.completionWrites).toBe(1);
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect(await made.completions.getCompletion('home', 'job-1')).toBe(resetA);
    });

    it('keeps Job State incomplete when the completion read is unavailable', async () => {
        const unavailable: MarketCompletionStorePort = {
            getState: async () => { throw new Error('read failed'); },
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            recordCompletion: async () => ({ status: 'written' }),
        };
        const made = await harness([record({ jobId: 'job-1', status: 'claiming' })], { completions: unavailable });

        const result = await made.reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt,
            jobs: [],
            skippedJobs: [{ id: 'job-1', name: 'job', serverName: null, status: 'completed', reason: 'completed' }],
        });

        expect(result.completionFailures).toBe(1);
        expect(result.decisions[0]?.completionStatus).toBe('unavailable');
        expect(result.decisions[0]?.outcome).toBe('pending');
        expect((await made.store.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('claiming');
    });
});
