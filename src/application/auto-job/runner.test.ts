import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import { AutoJobRunner } from './runner.js';

const job: JobOffer = {
    id: 'job1', name: 'IP Injection', type: 'IP Injection', marketId: 'm', marketKey: 'home',
    serverId: 'target', serverName: 'target', rewardCredits: 100, rewardReputation: 10,
    deposit: 0, alreadyTaken: false, canComplete: false,
};

describe('AutoJobRunner', () => {
    it('executes the job through the execution port', async () => {
        let executed = 0;
        const runner = new AutoJobRunner({
            execute: async () => {
                executed++;
                return { ok: true, value: { credits: 100, reputation: 10, renown: 1 } };
            },
        });
        const result = await runner.run(job);
        expect(result.ok).toBe(true);
        expect(executed).toBe(1);
        if (result.ok) expect(result.value.reward.credits).toBe(100);
    });

    it('returns NO_SERVER for an unbound job', async () => {
        const runner = new AutoJobRunner({
            execute: async () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 1 } }),
        });
        const result = await runner.run({ ...job, serverId: null });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('NO_SERVER');
    });

    it('allows serverless File Decryption jobs', async () => {
        const runner = new AutoJobRunner({
            execute: async () => ({ ok: true, value: { credits: 1, reputation: 1, renown: 1 } }),
        });
        const result = await runner.run({
            ...job,
            name: 'File Decryption',
            type: 'File Decryption',
            serverId: null,
            serverName: null,
        });
        expect(result.ok).toBe(true);
    });
});
