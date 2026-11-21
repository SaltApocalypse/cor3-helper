import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { JobActionPort } from './job-actions.js';
import { JobExecutionService } from './execution-service.js';
import { JobStateStore } from '../../infrastructure/storage/job-state-store.js';
import { MarketCompletedJobsStore } from '../../infrastructure/storage/market-completed-jobs-store.js';
import { MemoryStorageArea } from '../../infrastructure/storage/storage-area.js';
import { JobStateRecorder } from './job-state-recorder.js';
import { JobStateReconciler } from './job-state-reconciler.js';
import { isCompletedForMarketReset, type MarketCompletionStorePort } from './market-completion.js';
import type { JobStateRecord } from '../../contracts/job-state.js';
import { interpretJobCommandResponse } from '../../infrastructure/game-ws/game-socket-hub.js';
import { buildLiveMarkets } from '../../contexts/background/automation/auto-finish-view.js';
import type { JobLockRegistry } from '../../contexts/background/automation/job-locks.js';

const resetA = '2026-11-20T11:00:00.000Z';
const resetB = '2026-11-21T11:00:00.000Z';

function logger() {
    const warnings: Array<{ scope: string; message: string; data?: unknown }> = [];
    return {
        warnings,
        debug: () => undefined,
        info: () => undefined,
        warn: (scope: string, message: string, data?: unknown) => { warnings.push({ scope, message, data }); },
        error: () => undefined,
    };
}

function job(overrides: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job-1',
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: 'market-home',
        marketKey: 'home',
        message: undefined,
        serverId: 'server-1',
        serverName: 'server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
        conditions: [{ details: { ips: ['1.1.1.1'] } }],
        ...overrides,
    } as JobOffer;
}

function makeHarness(
    completeError: { code: string; message: string; unconfirmed?: boolean } = { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' },
    configureCompletions?: (store: MarketCompletedJobsStore) => MarketCompletionStorePort,
    options: { readonly resetAtForMarket?: () => string | null; readonly now?: () => number } = {},
) {
    const calls: string[] = [];
    const actions: JobActionPort = {
        take: async () => { calls.push('take'); return { ok: true as const, value: undefined }; },
        complete: async () => { calls.push('complete'); return { ok: false as const, error: completeError }; },
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
    const now = options.now ?? (() => 1);
    const jobStore = new JobStateStore(new MemoryStorageArea(), { now });
    const completionStore = new MarketCompletedJobsStore(new MemoryStorageArea(), { now });
    const activeCompletions = configureCompletions ? configureCompletions(completionStore) : completionStore;
    const log = logger();
    const recorder = new JobStateRecorder({
        store: jobStore,
        logger: log,
        now,
        resetAtForMarket: options.resetAtForMarket ?? (() => resetA),
    });
    const service = new JobExecutionService(
        actions,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        recorder,
        undefined,
        activeCompletions,
        jobStore,
        options.resetAtForMarket,
    );
    return { actions, calls, jobStore, completionStore, recorder, service, log };
}

async function makeUnknownJob(completeError?: { code: string; message: string; unconfirmed?: boolean }) {
    const made = makeHarness(completeError);
    const result = await made.service.executeDetailed(job());
    expect(result.ok).toBe(false);
    const record = await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA });
    expect(record?.status).toBe('unknown');
    expect(record?.unconfirmed).toBe(true);
    expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
    return made;
}

async function executeSuccessfulAck(made: ReturnType<typeof makeHarness>) {
    made.actions.complete = async () => {
        made.calls.push('complete');
        return { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
    };
    return made.service.executeDetailed(job({ alreadyTaken: true, canComplete: true }));
}

function reconcilerFor(made: ReturnType<typeof makeHarness>, completions: MarketCompletionStorePort = made.completionStore) {
    return new JobStateReconciler({
        store: made.jobStore,
        writer: made.recorder,
        completions,
        logger: made.log,
        now: () => 1,
    });
}

function completedSkip(id = 'job-1') {
    return [{ id, name: 'completed', serverName: null, status: 'completed', reason: 'Job already completed' }];
}

describe('Complete unknown recovery integration', () => {
    it('recovers through market completed evidence and suppresses later selection', async () => {
        const made = await makeUnknownJob();
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(1);

        const reconciler = reconcilerFor(made);
        const result = await reconciler.reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt: 2,
            jobs: [],
            skippedJobs: completedSkip(),
        });

        expect(result.updated).toBe(1);
        expect(result.completionWrites).toBe(1);
        expect(result.completionFailures).toBe(0);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        const sidecar = await made.completionStore.getState();
        expect(isCompletedForMarketReset(sidecar, 'home', 'job-1', resetA)).toBe(true);
        // This is the same predicate Auto Finish uses to build its runnable
        // list, so a completed job is no longer selectable.
        const locks = { lockUntil: () => undefined, isRetryExhausted: () => false } as unknown as JobLockRegistry;
        const markets = buildLiveMarkets(
            {
                jobs: [job()],
                markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: resetA }],
            },
            [],
            new Set<JobOffer['type']>(),
            locks,
            1,
            { completedJobsByMarket: sidecar, resetByMarket: new Map([['home', resetA]]) },
        );
        expect(markets[0]?.jobs?.[0]?.status).toBe('done');
        expect(markets[0]?.success).toBe(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
    });

    it('keeps unknown pending when the remote row is taken but not claimable', async () => {
        const made = await makeUnknownJob();
        await reconcilerFor(made).reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt: 2,
            jobs: [job({ alreadyTaken: true, canComplete: false })],
        });
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
    });

    it('keeps a remote claimable row blocked after an unconfirmed Complete', async () => {
        const made = await makeUnknownJob();
        await reconcilerFor(made).reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt: 2,
            jobs: [job({ alreadyTaken: true, canComplete: true })],
        });
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        const blocked = await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA });
        expect(blocked?.status).toBe('unknown');
        expect(blocked?.unconfirmed).toBe(true);

        // alreadyTaken + canComplete cannot release the unconfirmed barrier.
        made.actions.complete = async () => {
            made.calls.push('complete');
            return { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
        };
        const executed = await made.service.executeDetailed(job({ alreadyTaken: true, canComplete: true }));
        expect(executed.ok).toBe(false);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
    });

    it('does not fall back to available when the remote row is open', async () => {
        const made = await makeUnknownJob();
        await reconcilerFor(made).reconcile({
            marketKey: 'home',
            resetAt: resetA,
            observedAt: 2,
            jobs: [job({ alreadyTaken: false, canComplete: false })],
        });
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
    });

    it('retries the sidecar write after a failure without marking completed early', async () => {
        const made = await makeUnknownJob();
        let fail = true;
        const flaky: MarketCompletionStorePort = {
            getState: () => made.completionStore.getState(),
            getStateWithHealth: () => made.completionStore.getStateWithHealth(),
            getCompletion: (marketKey, jobId) => made.completionStore.getCompletion(marketKey, jobId),
            clear: () => made.completionStore.clear(),
            pruneMarketBeforeReset: (marketKey, reset) => made.completionStore.pruneMarketBeforeReset(marketKey, reset),
            recordCompletion: async (input) => {
                if (fail) throw new Error('sidecar write failed');
                return made.completionStore.recordCompletion(input);
            },
        };

        const failed = await reconcilerFor(made, flaky).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 2, jobs: [], skippedJobs: completedSkip(),
        });
        expect(failed.completionFailures).toBe(1);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect(made.log.warnings.some((entry) => entry.message === 'Completion sidecar bridge failed')).toBe(true);

        fail = false;
        const retried = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 3, jobs: [], skippedJobs: completedSkip(),
        });
        expect(retried.completionFailures).toBe(0);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
    });

    it('does not recover when the sidecar is unavailable', async () => {
        const made = await makeUnknownJob();
        const unavailable: MarketCompletionStorePort = {
            getState: async () => { throw new Error('sidecar unavailable'); },
            getStateWithHealth: async () => ({ status: 'unavailable' }),
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
            recordCompletion: async () => ({ status: 'written' }),
        };
        const result = await reconcilerFor(made, unavailable).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 2, jobs: [], skippedJobs: completedSkip(),
        });
        expect(result.storeStatus).toBe('partial');
        expect(result.completionFailures).toBe(0);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });

        const recovered = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 3, jobs: [], skippedJobs: completedSkip(),
        });
        expect(recovered.completionFailures).toBe(0);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
    });

    it('keeps Reset A and Reset B isolated', async () => {
        const made = await makeUnknownJob();
        const result = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetB, observedAt: 2, jobs: [], skippedJobs: completedSkip(),
        });
        expect(result.updated).toBe(0);
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
    });

    it('recovers only the matching reset when the same job has two reset records', async () => {
        const made = await makeUnknownJob();
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'job-1', resetAt: resetB, status: 'unknown',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);
        const observedAt = Date.parse('2026-11-21T12:00:00.000Z');

        await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt, jobs: [], skippedJobs: completedSkip(),
        });
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetB }))?.status).toBe('unknown');

        await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetB, observedAt, jobs: [], skippedJobs: completedSkip(),
        });
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetB);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetB }))?.status).toBe('completed');
    });

    it('keeps different markets isolated for the same job id', async () => {
        const made = await makeUnknownJob();
        await made.jobStore.upsert({
            marketKey: 'dark', jobId: 'job-1', resetAt: resetA, status: 'unknown',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);
        await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 2, jobs: [], skippedJobs: completedSkip(),
        });
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect(await made.completionStore.getCompletion('dark', 'job-1')).toBeNull();
    });

    it('treats a valid empty Complete ACK as completion after writing the sidecar', async () => {
        const response = interpretJobCommandResponse({ data: undefined, error: undefined });
        expect(response.ok).toBe(true);

        const made = makeHarness();
        made.actions.complete = async () => {
            made.calls.push('complete');
            return { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
        };
        const result = await made.service.executeDetailed(job({ alreadyTaken: true, canComplete: true }));
        expect(result.ok).toBe(true);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(0);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
    });

    it('writes the sidecar for a non-empty Complete ACK before marking completed', async () => {
        const response = interpretJobCommandResponse({ data: { jobId: 'job-1' }, error: undefined });
        expect(response.ok).toBe(true);

        const made = makeHarness();
        const result = await executeSuccessfulAck(made);
        expect(result.ok).toBe(true);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(0);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
    });

    it('does not mark completed when the sidecar write fails, then recovers from remote completed', async () => {
        let fail = true;
        const made = makeHarness(undefined, (store) => ({
            getState: () => store.getState(),
            getCompletion: (marketKey, jobId) => store.getCompletion(marketKey, jobId),
            clear: () => store.clear(),
            pruneMarketBeforeReset: (marketKey, reset) => store.pruneMarketBeforeReset(marketKey, reset),
            recordCompletion: async (input) => {
                if (fail) throw new Error('sidecar write failed');
                return store.recordCompletion(input);
            },
        }));

        const failed = await executeSuccessfulAck(made);
        expect(failed.ok).toBe(false);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(0);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });

        fail = false;
        const recovered = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: 2, jobs: [], skippedJobs: completedSkip(),
        });
        expect(recovered.completionWrites).toBe(1);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(0);
    });

    it('does not mark completed when the sidecar is unavailable', async () => {
        const made = makeHarness(undefined, () => ({
            getState: async () => { throw new Error('sidecar unavailable'); },
            getCompletion: async () => { throw new Error('sidecar unavailable'); },
            clear: async () => { throw new Error('sidecar unavailable'); },
            pruneMarketBeforeReset: async () => { throw new Error('sidecar unavailable'); },
            recordCompletion: async () => { throw new Error('sidecar unavailable'); },
        }));

        const result = await executeSuccessfulAck(made);
        expect(result.ok).toBe(false);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
    });

    it('advances an older sidecar reset before marking completed', async () => {
        const made = makeHarness();
        await made.completionStore.recordCompletion({
            marketKey: 'home', jobId: 'job-1', resetAt: '2026-11-19T11:00:00.000Z',
        });

        const result = await executeSuccessfulAck(made);
        expect(result.ok).toBe(true);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('completed');
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
    });

    it('does not mark completed on a sidecar reset/CAS mismatch', async () => {
        const made = makeHarness();
        await made.completionStore.recordCompletion({ marketKey: 'home', jobId: 'job-1', resetAt: resetB });

        const result = await executeSuccessfulAck(made);
        expect(result.ok).toBe(false);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: resetA }))?.status).toBe('unknown');
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetB);
    });

    it('keeps the start reset when the market reset advances during execution', async () => {
        let currentReset: string | null = resetA;
        const made = makeHarness(undefined, undefined, {
            resetAtForMarket: () => currentReset,
            now: () => Date.parse('2026-11-20T12:00:00.000Z'),
        });
        made.actions.complete = async () => {
            made.calls.push('complete');
            currentReset = resetB;
            return { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
        };

        const result = await made.service.executeDetailed(job({ alreadyTaken: true, canComplete: true }));

        expect(result.ok).toBe(true);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect(await made.completionStore.getCompletion('home', 'job-1')).not.toBe(resetB);
    });

    it('does not write a sidecar for a null-reset ACK, then recovers it in the current reset', async () => {
        const made = makeHarness(undefined, undefined, {
            resetAtForMarket: () => null,
            now: () => Date.parse('2026-11-20T12:00:00.000Z'),
        });
        const executed = await executeSuccessfulAck(made);
        expect(executed.ok).toBe(false);
        const pending = await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: null });
        expect(pending).toMatchObject({ status: 'unknown', unconfirmed: true });
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });

        const reconciled = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: Date.parse('2026-11-20T12:30:00.000Z'),
            jobs: [], skippedJobs: completedSkip(),
        });
        expect(reconciled.completionWrites).toBe(1);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('completed');
    });

    it('recovers a null-reset unknown record from explicit remote completed in the current reset', async () => {
        const made = makeHarness();
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'job-1', resetAt: null, status: 'unknown', unconfirmed: true,
            createdAt: '2026-11-20T12:00:00.000Z', updatedAt: '2026-11-20T12:00:00.000Z', lastTransitionAt: '2026-11-20T12:00:00.000Z',
        } as JobStateRecord);

        const result = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: Date.parse('2026-11-20T12:30:00.000Z'),
            jobs: [], skippedJobs: completedSkip(),
        });

        expect(result.completionWrites).toBe(1);
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('completed');
    });

    it('does not migrate a null-reset record into a new reset by job id alone', async () => {
        const made = makeHarness();
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'job-1', resetAt: null, status: 'unknown', unconfirmed: true,
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);

        const result = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: resetA, observedAt: Date.parse('2026-11-20T12:30:00.000Z'),
            jobs: [job({ alreadyTaken: true, canComplete: false })],
        });

        expect(result.completionWrites).toBe(0);
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: null }))?.status).toBe('unknown');
    });

    it('does not bridge an unparseable reset into the sidecar', async () => {
        const made = makeHarness();
        await made.jobStore.upsert({
            marketKey: 'home', jobId: 'job-1', resetAt: 'not-a-date', status: 'unknown',
            createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', lastTransitionAt: '2026-11-20T10:00:00.000Z',
        } as JobStateRecord);
        const result = await reconcilerFor(made).reconcile({
            marketKey: 'home', resetAt: 'not-a-date',
            observedAt: Date.parse('2026-11-20T11:00:00.000Z'),
            jobs: [], skippedJobs: completedSkip(),
        });
        expect(result.completionWrites).toBe(0);
        expect(result.completionFailures).toBe(1);
        expect(result.decisions[0]?.completionStatus).toBe('skipped-unknown-reset');
        expect(result.decisions[0]?.outcome).toBe('pending');
        expect(await made.completionStore.getState()).toEqual({ byMarket: {} });
        expect((await made.jobStore.get({ marketKey: 'home', jobId: 'job-1', resetAt: 'not-a-date' }))?.status).toBe('unknown');
    });

    it('is idempotent for repeated completed evidence', async () => {
        const made = await makeUnknownJob();
        const input = { marketKey: 'home', resetAt: resetA, observedAt: 2, jobs: [], skippedJobs: completedSkip() };
        const first = await reconcilerFor(made).reconcile(input);
        const second = await reconcilerFor(made).reconcile({ ...input, observedAt: 3 });
        expect(first.completionWrites).toBe(1);
        expect(second.completionWrites).toBe(0);
        expect(second.updated).toBe(0);
        expect(second.decisions[0]?.outcome).toBe('unchanged');
        expect(second.decisions[0]?.previousStatus).toBe('completed');
        expect(await made.completionStore.getCompletion('home', 'job-1')).toBe(resetA);
        expect(made.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(made.calls.filter((call) => call === 'complete')).toHaveLength(1);
    });
});
