import { describe, expect, it, vi } from 'vitest';
import { registerJobHandlers } from './jobs.js';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';

const home = JOB_MARKETS.find((market) => market.key === 'home')!;
const resetAt = '2026-11-20T11:00:00.000Z';

function setup(options: {
    readonly blocked?: boolean;
    readonly complete?: { ok: true; value: undefined } | { ok: false; error: { code: string; message: string; unconfirmed?: boolean } };
    readonly record?: { ok: true } | { ok: false; error: { code: string; message: string } };
    readonly barrierThrows?: boolean;
    readonly markThrows?: boolean;
    readonly resolveError?: { code: string; message: string };
}) {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    const complete = vi.fn(async () => options.complete ?? { ok: true as const, value: undefined });
    const recordDirectCompletion = vi.fn(async () => options.record ?? { ok: true as const });
    const markDirectUnconfirmed = vi.fn(async () => {
        if (options.markThrows) throw new Error('barrier unavailable');
    });
    const update = vi.fn(async () => true);
    const server = {
        register: (type: string, _schema: unknown, handler: (payload: unknown) => Promise<unknown>) => handlers.set(type, handler),
    };
    const core = {
        server,
        helperModeEnabled: async () => false,
        helperModeError: { code: 'HELPER_MODE', message: 'Helper Mode' },
        runBridgeExclusive: async (_request: unknown, run: () => Promise<unknown>) => run(),
    };
    const game = { jobCommands: { complete } };
    const automation = {
        autoJobs: {
            snapshotView: () => ({
                at: 1,
                jobs: [],
                markets: [{ marketKey: 'home', label: 'CORE', ok: true, skipped: 0, resetAt }],
            }),
        },
        autoFinish: {
            resolveDirectReset: async (_marketKey: string, _jobId: string, fallback: string | null) => options.resolveError
                ? { ok: false as const, error: options.resolveError }
                : { ok: true as const, resetAt: fallback },
            isCompletionBlocked: async () => {
                if (options.barrierThrows) throw new Error('barrier unavailable');
                return options.blocked === true;
            },
            recordDirectCompletion,
            markDirectUnconfirmed,
        },
        jobStates: { update },
    };
    registerJobHandlers(server as never, { core, game, automation } as never);
    return {
        handler: handlers.get('job.complete')!,
        complete,
        recordDirectCompletion,
        markDirectUnconfirmed,
        update,
    };
}

describe('direct job.complete barrier and persistence', () => {
    it('checks the barrier before sending Complete', async () => {
        const made = setup({ blocked: true });

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toMatchObject({ ok: false, error: { code: 'COMPLETE_BLOCKED' } });
        expect(made.complete).not.toHaveBeenCalled();
        expect(made.recordDirectCompletion).not.toHaveBeenCalled();
    });

    it('persists the sidecar and Job State after a successful ACK', async () => {
        const made = setup({});

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toEqual({ ok: true, value: undefined });
        expect(made.complete).toHaveBeenCalledTimes(1);
        expect(made.recordDirectCompletion).toHaveBeenCalledWith('home', 'job-1', resetAt);
        expect(made.update).toHaveBeenCalledWith({ marketKey: 'home', jobId: 'job-1', resetAt }, 'completed');
    });

    it('writes a fallback barrier when the sidecar write fails', async () => {
        const made = setup({ record: { ok: false, error: { code: 'COMPLETION_STORE_FAILED', message: 'unavailable' } } });

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toMatchObject({ ok: false, error: { code: 'COMPLETION_STORE_FAILED' } });
        expect(made.markDirectUnconfirmed).toHaveBeenCalledWith('home', 'job-1', resetAt);
        expect(made.update).not.toHaveBeenCalled();
    });

    it('writes a fallback barrier when the Complete result is unconfirmed', async () => {
        const made = setup({ complete: { ok: false, error: { code: 'GAME_TIMEOUT', message: 'timed out', unconfirmed: true } } });

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toMatchObject({ ok: false, error: { code: 'GAME_TIMEOUT' } });
        expect(made.markDirectUnconfirmed).toHaveBeenCalledWith('home', 'job-1', resetAt);
        expect(made.recordDirectCompletion).not.toHaveBeenCalled();
    });

    it('does not send Complete when the direct identity is ambiguous', async () => {
        const made = setup({ resolveError: { code: 'COMPLETE_IDENTITY_AMBIGUOUS', message: 'multiple resets' } });

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toMatchObject({ ok: false, error: { code: 'COMPLETE_IDENTITY_AMBIGUOUS' } });
        expect(made.complete).not.toHaveBeenCalled();
        expect(made.recordDirectCompletion).not.toHaveBeenCalled();
        expect(made.markDirectUnconfirmed).not.toHaveBeenCalled();
        expect(made.update).not.toHaveBeenCalled();
    });

    it('fails closed when the barrier store is unavailable', async () => {
        const made = setup({ barrierThrows: true });

        const result = await made.handler({ marketId: home.marketId, jobId: 'job-1' });

        expect(result).toMatchObject({ ok: false, error: { code: 'COMPLETE_BARRIER_UNAVAILABLE' } });
        expect(made.complete).not.toHaveBeenCalled();
    });
});
