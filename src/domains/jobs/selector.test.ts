import { describe, expect, it } from 'vitest';
import { selectJobs, type JobOffer } from './model.js';
import { jobIdentityKey } from '../../contracts/jobs.js';

function job(id: string, serverName: string, type: JobOffer['type'] = 'IP Injection'): JobOffer {
    return {
        id, name: type, type, marketId: 'm', marketKey: 'home', serverId: 's', serverName,
        rewardCredits: 100, rewardReputation: 10, deposit: 0, alreadyTaken: false, canComplete: false,
    };
}

describe('Job selection', () => {
    it('orders by server priority and then job type priority', () => {
        const jobs = [job('1', 'near', 'File Decryption'), job('2', 'far', 'IP Injection'), job('3', 'near', 'IP Injection')];
        const result = selectJobs(jobs, { serverPriority: (name) => name === 'far' ? 0 : 1 });
        expect(result.map((entry) => entry.id)).toEqual(['2', '3', '1']);
    });

    it('filters completed and unsupported jobs', () => {
        const jobs = [
            job('1', 'A', 'IP Injection'),
            job('2', 'A', 'Log Deletion'),
            job('3', 'D4RK RM7CE', 'Log Deletion'),
        ];
        const result = selectJobs(jobs, {
            completedIds: new Set([jobIdentityKey('home', '1')]),
            supportedTypes: new Set(['IP Injection', 'Log Deletion']),
            serverPriority: () => 0,
        });
        expect(result.map((entry) => entry.id)).toEqual(['2', '3']);
    });
});
