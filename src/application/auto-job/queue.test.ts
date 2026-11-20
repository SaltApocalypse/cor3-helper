import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import { AutoJobQueueService } from './queue.js';

const job = (id: string, server: string): JobOffer => ({
    id, name: 'IP Injection', type: 'IP Injection', marketId: 'm', marketKey: 'home',
    serverId: 's', serverName: server, rewardCredits: 1, rewardReputation: 1, deposit: 0,
    alreadyTaken: false, canComplete: false,
});

describe('AutoJobQueueService', () => {
    it('runs selected jobs and records failures', async () => {
        const jobs = [job('1', 'far'), job('2', 'near'), job('3', 'near')];
        const seen: string[] = [];
        const queue = new AutoJobQueueService({
            run: async (entry) => {
                seen.push(entry.id);
                if (entry.id === '2') return { ok: false, error: { code: 'JOB_FAILED', message: 'no' } };
                return { ok: true, value: { route: [], reward: { credits: 1, reputation: 1, renown: 1 } } };
            },
        });
        const result = await queue.run(jobs, { owner: 'auto', serverPriority: (name) => name === 'far' ? 0 : 1 });
        expect(seen).toEqual(['1', '2', '3']);
        expect(result.done.map((entry) => entry.id)).toEqual(['1', '3']);
        expect(result.failed.map((entry) => entry.job.id)).toEqual(['2']);
        expect(result.stopped).toBe(false);
    });

    it('stops before the next job and reports progress', async () => {
        const seen: string[] = [];
        let stop = false;
        const queue = new AutoJobQueueService({
            run: async (entry) => {
                seen.push(entry.id);
                stop = true;
                return { ok: true, value: { route: [], reward: { credits: 1, reputation: 1, renown: 1 } } };
            },
        });
        const result = await queue.run([job('1', 'near'), job('2', 'near')], {
            owner: 'auto',
            serverPriority: () => 0,
            shouldStop: () => stop,
            onProgress: (progress) => seen.push(`progress:${progress.marketKey}:${progress.jobId}`),
        });
        expect(seen).toEqual(['progress:home:1', '1']);
        expect(result.stopped).toBe(true);
        expect(result.done.map((entry) => entry.id)).toEqual(['1']);
    });
});
