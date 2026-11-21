import { describe, expect, it } from 'vitest';
import { failureOf, jobFailureView } from './job-outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { JobOffer } from '../../../domains/jobs/model.js';

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
            detailCode: 'COMPLETE_FAILED',
            message,
            unconfirmed: true,
            stage: 'complete',
        },
    };
}

describe('job failure identity', () => {
    it('keeps the market key for the same job id in different markets', () => {
        const home = failure(job('home'), 'home failure');
        const dark = failure(job('dark'), 'dark failure');

        expect(failureOf(home)).toMatchObject({
            jobId: 'shared',
            marketKey: 'home',
            message: 'home failure',
            unconfirmed: true,
        });
        expect(failureOf(dark)).toMatchObject({
            jobId: 'shared',
            marketKey: 'dark',
            message: 'dark failure',
            unconfirmed: true,
        });
        expect(jobFailureView(home)).toMatchObject({ marketKey: 'home', jobId: 'shared' });
        expect(jobFailureView(dark)).toMatchObject({ marketKey: 'dark', jobId: 'shared' });
    });
});
