import { describe, expect, it } from 'vitest';
import { autoJobsSnapshotSchema } from '../../contracts/auto-jobs.js';
import { jobOfferSchema } from '../../contracts/jobs.js';
import { mapMarketJobs, mapMarketSnapshotJobs } from './market-mapper.js';

describe('mapMarketJobs', () => {
    it('maps the machine jobType instead of relying on the localized display name', () => {
        const result = mapMarketJobs([
            { id: 'j1', name: '本地化任务名', jobType: 'FILE_DECRYPTION', rewardCredits: 10, rewardReputation: 1, deposit: 0, relatedServers: [{ id: 's', serverName: 'Server' }] },
            { id: 'j2', name: 'Another localized name', jobType: 'IP_CLEANUP', rewardCredits: 10, rewardReputation: 1, deposit: 0, relatedServers: [{ id: 's', serverName: 'Server' }] },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.jobs.map((job) => job.type)).toEqual(['File Decryption', 'IP Cleanup']);
    });
    it('resolves a target server id from nested conditions', () => {
        const result = mapMarketJobs([
            {
                id: 'nested', name: 'IP Injection', jobType: 'IP_INJECTION', rewardCredits: 1, rewardReputation: 1, deposit: 0,
                relatedServers: [{ serverName: 'Server' }],
                conditions: { items: [{ type: 'InjectIps', serverConfigId: 'nested-server' }] },
            },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.jobs[0]?.serverId).toBe('nested-server');
    });

    it('maps open and recently taken jobs', () => {
        const result = mapMarketJobs([
            {
                id: 'j1', name: 'IP Injection', rewardCredits: 100, rewardReputation: 5, deposit: 10,
                relatedServers: [{ id: 's1', serverName: 'USOL 1' }],
                conditions: { items: [{ type: 'InjectIps', details: { ips: ['1.1.1.1'] } }] },
            },
            {
                id: 'j2', name: 'Log Download', rewardCredits: 50, status: 'TAKEN', canComplete: true,
                relatedServers: [{ serverName: 'SOYUZ 2' }],
            },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.skipped).toBe(0);
        expect(result.jobs.map((job) => job.id)).toEqual(['j1', 'j2']);
        expect(result.jobs[0]?.serverId).toBe('s1');
        expect(result.jobs[0]?.conditions?.[0]?.details?.ips).toEqual(['1.1.1.1']);
        expect(result.jobs[1]?.alreadyTaken).toBe(true);
        expect(result.jobs[1]?.canComplete).toBe(true);
    });

    it('skips unknown, completed, and malformed rows', () => {
        const result = mapMarketJobs([
            { id: 'x', name: 'Unknown Job' },
            { id: 'done', name: 'IP Injection', isCompleted: true },
            { id: '', name: 'IP Injection' },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.jobs).toHaveLength(0);
        expect(result.skipped).toBe(3);
    });

    it('labels non-taken recent FAILED jobs as expired', () => {
        const result = mapMarketJobs([
            { id: 'j', name: 'Data Upload', status: 'TAKEN', relatedServers: [{ id: 's', serverName: 'Server' }] },
            { id: 'failed', name: 'Data Upload', status: 'FAILED', relatedServers: [{ id: 's', serverName: 'Server' }] },
        ], { marketId: 'm', marketKey: 'dark', recent: true });
        expect(result.jobs.map((job) => job.id)).toEqual(['j']);
        expect(result.jobs[0]?.alreadyTaken).toBe(true);
        expect(result.skipped).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.expired).toBe(1);
        expect(result.skippedJobs).toEqual([{
            id: 'failed',
            name: 'Data Upload',
            serverName: 'Server',
            status: 'expired',
            reason: 'Job expired',
            expired: true,
        }]);
    });

    it('labels recent failed rows as expired even without a reason hint', () => {
        const result = mapMarketJobs([
            { id: 'expired', name: 'Data Upload', status: 'FAILED', error: 'job-expired', relatedServers: [{ id: 's', serverName: 'Server' }] },
        ], { marketId: 'm', marketKey: 'dark', recent: true });
        expect(result.failed).toBe(0);
        expect(result.expired).toBe(1);
        expect(result.skippedJobs[0]).toMatchObject({ status: 'expired', expired: true, reason: 'Job expired' });
    });

    it('reports unsupported and completed jobs as skipped', () => {
        const result = mapMarketJobs([
            { id: 'unknown', name: 'Unknown Job', relatedServers: [{ id: 's' }] },
            { id: 'done', name: 'IP Injection', isCompleted: true },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.jobs).toHaveLength(0);
        expect(result.skippedJobs).toMatchObject([
            { id: 'unknown', status: 'unsupported' },
            { id: 'done', status: 'completed' },
        ]);
    });

    it('maps serverless File Decryption jobs with null relatedServers', () => {
        const result = mapMarketJobs([
            {
                id: 'decrypt', name: 'File Decryption', relatedServers: null,
                rewardCredits: 838, rewardReputation: 151, deposit: 126, reputationPenalty: 0,
                conditions: { serverConfigId: null, items: [{ type: 'DecryptFile', details: null }] },
            },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.skipped).toBe(0);
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]?.serverId).toBeNull();
        expect(result.jobs[0]?.serverName).toBeNull();
    });

    it('tolerates null related-server fields and nullable condition details', () => {
        const result = mapMarketJobs([
            {
                id: 'j', name: 'IP Injection',
                relatedServers: [{ id: null, serverName: null }],
                conditions: { items: [{ type: 'InjectIps', details: null, ip: null }] },
            },
        ], { marketId: 'm', marketKey: 'home', recent: false });
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]?.serverId).toBeNull();
        expect(result.jobs[0]?.serverName).toBeNull();
        expect(result.jobs[0]?.conditions?.[0]?.details).toBeUndefined();
        expect(jobOfferSchema.safeParse(result.jobs[0]).success).toBe(true);
    });
});

describe('mapMarketSnapshotJobs', () => {
    it('combines open and recent jobs from a get.jobs payload', () => {
        const result = mapMarketSnapshotJobs({
            jobs: {
                jobs: [{ id: 'a', name: 'IP Injection', relatedServers: [{ id: 's' }] }],
                recentJobs: [{ id: 'b', name: 'Data Upload', status: 'TAKEN', relatedServers: [{ id: 's' }] }],
            },
        }, 'm', 'home');
        expect(result.jobs.map((job) => job.id)).toEqual(['a', 'b']);
        expect(result.jobs[1]?.alreadyTaken).toBe(true);
    });

    it('accepts a bare job array', () => {
        const result = mapMarketSnapshotJobs({ jobs: [{ id: 'a', name: 'IP Cleanup' }] }, 'm', 'home');
        expect(result.jobs).toHaveLength(1);
    });

    it('produces a bridge-valid Auto Jobs snapshot from a market payload', () => {
        const result = mapMarketSnapshotJobs({
            jobs: {
                jobs: [{
                    id: 'open', name: 'IP Injection', rewardCredits: 10, rewardReputation: 1,
                    relatedServers: [{ id: 's', serverName: 'Server' }],
                    conditions: { items: [{ type: 'InjectIps', details: { ips: ['1.1.1.1'] } }] },
                }],
                recentJobs: [{
                    id: 'taken', name: 'Log Download', status: 'TAKEN', canComplete: true,
                    relatedServers: [{ id: 's', serverName: 'Server' }],
                }],
                nextJobsResetAt: '2026-11-10T12:00:00.000Z',
            },
        }, 'market', 'home', 's');
        expect(result.jobs).toHaveLength(2);
        const parsed = autoJobsSnapshotSchema.safeParse({
            at: 1,
            jobs: result.jobs,
            markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: result.skipped, resetAt: result.resetAt }],
        });
        expect(parsed.success).toBe(true);
    });
});
