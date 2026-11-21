import { describe, expect, it, vi } from 'vitest';
import { runDeferredRetryPass } from './auto-finish-deferred.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import { jobIdentityKey } from '../../../contracts/jobs.js';

function job(marketKey: string, id = 'shared'): JobOffer {
    return {
        id,
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: `${marketKey}-market`,
        marketKey,
        serverId: 'server-1',
        serverName: 'Server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
    };
}

function failure(jobOffer: JobOffer, message: string): AutoJobQueueFailure {
    return {
        job: jobOffer,
        error: {
            code: 'JOB_FAILED',
            detailCode: 'ACTION_FAILED',
            message,
            retryable: true,
        },
    };
}

describe('runDeferredRetryPass identity', () => {
    it('keeps deferred retry results for the same job id in separate markets', async () => {
        const home = job('home');
        const dark = job('dark');
        const homeFailure = failure(home, 'home timeout');
        const darkFailure = failure(dark, 'dark timeout');
        const runQueue = vi.fn(async (jobs: readonly JobOffer[]) => ({
            stopped: false,
            done: jobs.filter((entry) => entry.marketKey === 'home'),
            failed: jobs.filter((entry) => entry.marketKey === 'dark').map((entry) => failure(entry, 'dark still failing')),
        }));

        const result = await runDeferredRetryPass({
            owner: 'test',
            runId: 'run-1',
            done: [],
            failed: [homeFailure, darkFailure],
            cancelRequested: () => false,
            markets: {
                syncAll: async () => ({
                    jobs: [home, dark],
                    markets: [
                        { marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: 'reset-home' },
                        { marketKey: 'dark', label: 'DARK', ok: true, skipped: 0, resetAt: 'reset-dark' },
                    ],
                }),
            },
            publishSnapshot: () => undefined,
            runQueue,
            runLogs: { add: () => undefined },
            now: () => 1,
            humanDelay: async () => undefined,
        });

        expect(runQueue).toHaveBeenCalledTimes(1);
        expect(runQueue.mock.calls[0]?.[0]?.map((entry) => entry.marketKey)).toEqual(['home', 'dark']);
        expect(result.runDone.map((entry) => entry.marketKey)).toEqual(['home']);
        expect(result.failedById.get(jobIdentityKey('home', 'shared'))?.error.message).toBe('home timeout');
        expect(result.failedById.get(jobIdentityKey('dark', 'shared'))?.error.message).toBe('dark still failing');
        expect(result.deferredExpiredIds.size).toBe(0);
    });
});
