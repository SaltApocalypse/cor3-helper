import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../../contracts/jobs.js';
import type { AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import {
    autoFinishMarketsToJobReport,
    autoJobsSnapshotToJobReport,
    buildJobMarketViews,
    buildJobStatusById,
    classifyJobQueueResult,
    countCompletionRecords,
    groupJobsByMarket,
    jobStatusKey,
    jobStatusTone,
    resetAtByMarket,
    selectShownJobReport,
} from './job-report.js';

function offer(overrides: Partial<JobOffer> & Pick<JobOffer, 'id' | 'marketKey'>): JobOffer {
    return {
        name: `job-${overrides.id}`,
        type: 'Data Download',
        marketId: overrides.marketKey,
        serverId: null,
        serverName: null,
        rewardCredits: 10,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: true,
        ...overrides,
    };
}

describe('jobStatusTone', () => {
    it('maps failures, completions and in-flight states to tone classes', () => {
        expect(jobStatusTone('failed')).toBe('v2-text-error');
        expect(jobStatusTone('complete')).toBe('v2-text-ok');
        expect(jobStatusTone('running')).toBe('v2-text-warn');
        expect(jobStatusTone('synced')).toBe('v2-text-ok');
    });

    it('maps translated status text to the same tones', () => {
        expect(jobStatusTone('同步中...')).toBe('v2-text-warn');
        expect(jobStatusTone('就绪同步：2 个市场中共 4 个任务')).toBe('v2-text-ok');
        expect(jobStatusTone('已同步 4 个市场中的 12 个任务')).toBe('v2-text-ok');
        expect(jobStatusTone('市场刷新失败')).toBe('v2-text-error');
        expect(jobStatusTone('尚未同步市场')).toBe('');
    });
});

describe('autoFinishMarketsToJobReport', () => {
    it('uses explicit counters and falls back to per-job status counts', () => {
        const markets: readonly AutoFinishMarketResult[] = [{
            marketKey: 'home',
            label: 'Home',
            ok: true,
            skipped: 1,
            jobs: [
                { jobId: 'a', name: 'A', serverName: null, marketKey: 'home', status: 'retry' },
                { jobId: 'b', name: 'B', serverName: null, marketKey: 'home', status: 'expired' },
                { jobId: 'c', name: 'C', serverName: null, marketKey: 'home', status: 'done', code: 'EXPIRED' },
            ],
        }];
        const [report] = autoFinishMarketsToJobReport(markets);
        expect(report).toMatchObject({
            marketKey: 'home',
            label: 'Home',
            ok: true,
            skipped: 1,
            retry: 1,
            expired: 2,
            total: 0,
        });
        expect(report?.error).toBeUndefined();
    });

    it('keeps the market error text', () => {
        const [report] = autoFinishMarketsToJobReport([{
            marketKey: 'dark',
            label: 'Dark',
            ok: false,
            skipped: 0,
            error: 'timeout',
        }]);
        expect(report?.error).toBe('timeout');
    });
});

describe('autoJobsSnapshotToJobReport', () => {
    it('reports sync health without per-job counters', () => {
        expect(autoJobsSnapshotToJobReport([
            { marketKey: 'home', label: 'Home', ok: true, skipped: 2, failed: 1, expired: 3 },
        ])).toEqual([{
            marketKey: 'home',
            label: 'Home',
            ok: true,
            total: 0,
            success: 0,
            retry: 0,
            failed: 1,
            expired: 3,
            pending: 0,
            skipped: 2,
        }]);
    });
});

describe('selectShownJobReport', () => {
    const snapshot = [{ marketKey: 'home', label: 'Home', ok: true, skipped: 0 }];
    const runReport = [{ marketKey: 'queue', label: 'Queue', ok: true, total: 1, success: 1, retry: 0, failed: 0, expired: 0, pending: 0 }];

    it('prefers the live Auto Finish run', () => {
        const report = selectShownJobReport({
            autoFinishEnabled: true,
            autoRunMarkets: [{ marketKey: 'auto', label: 'Auto', ok: true, skipped: 0 }],
            jobReport: runReport,
            autoJobsMarkets: snapshot,
        });
        expect(report[0]?.marketKey).toBe('auto');
    });

    it('falls back to the queue report and then the snapshot', () => {
        expect(selectShownJobReport({
            autoFinishEnabled: false,
            autoRunMarkets: [],
            jobReport: runReport,
            autoJobsMarkets: snapshot,
        })[0]?.marketKey).toBe('queue');
        expect(selectShownJobReport({
            autoFinishEnabled: false,
            autoRunMarkets: [],
            jobReport: [],
            autoJobsMarkets: snapshot,
        })[0]?.marketKey).toBe('home');
    });
});

describe('classifyJobQueueResult', () => {
    const selected = [
        offer({ id: 'done', marketKey: 'home' }),
        offer({ id: 'expired', marketKey: 'home' }),
        offer({ id: 'failed', marketKey: 'home' }),
        offer({ id: 'preflight', marketKey: 'dark' }),
        offer({ id: 'cancelled', marketKey: 'dark' }),
        offer({ id: 'pending', marketKey: 'dark' }),
    ];

    it('classifies every job and aggregates per market', () => {
        const outcome = classifyJobQueueResult(selected, {
            stopped: false,
            done: ['done', 'expired'],
            failed: [
                { jobId: 'expired', name: 'expired', serverName: null, code: 'JOB_FAILED', message: 'job expired' },
                { jobId: 'failed', name: 'failed', serverName: null, code: 'JOB_FAILED', message: 'boom' },
                { jobId: 'preflight', name: 'preflight', serverName: null, code: 'PREFLIGHT_FAILED', message: 'no software' },
                { jobId: 'cancelled', name: 'cancelled', serverName: null, code: 'JOB_CANCELLED', message: 'cancelled' },
            ],
        });
        expect(outcome.statuses).toEqual({
            done: 'done',
            expired: 'done',
            failed: 'failed',
            preflight: 'skipped',
            cancelled: 'skipped',
            pending: 'pending',
        });
        expect(outcome.report).toEqual([
            { marketKey: 'home', label: 'CORE', ok: true, total: 3, success: 2, retry: 0, failed: 1, expired: 0, pending: 0 },
            { marketKey: 'dark', label: 'D4RK', ok: true, total: 3, success: 0, retry: 0, failed: 0, expired: 0, pending: 3 },
        ]);
    });

    it('marks unfinished jobs as skipped when the run stopped', () => {
        const outcome = classifyJobQueueResult([offer({ id: 'pending', marketKey: 'home' })], {
            stopped: true,
            done: [],
            failed: [],
        });
        expect(outcome.statuses.pending).toBe('skipped');
    });
});

describe('buildJobStatusById', () => {
    it('lets the manual queue status override the Auto Finish status', () => {
        const result = buildJobStatusById(true, [{
            marketKey: 'home',
            label: 'Home',
            ok: true,
            skipped: 0,
            jobs: [
                { jobId: 'a', name: 'A', serverName: null, marketKey: 'home', status: 'failed' },
                { jobId: 'b', name: 'B', serverName: null, marketKey: 'home', status: 'failed', code: 'EXPIRED' },
            ],
        }], { a: 'done' });
        expect(result).toEqual({ a: 'done', [jobStatusKey('home', 'a')]: 'done', [jobStatusKey('home', 'b')]: 'expired' });
    });

    it('keeps a persisted Done status when a later report says skipped', () => {
        const result = buildJobStatusById(true, [{
            marketKey: 'home',
            label: 'Home',
            ok: true,
            skipped: 0,
            jobs: [{ jobId: 'a', name: 'A', serverName: null, marketKey: 'home', status: 'skipped' }],
        }], {}, {
            completedJobsByMarket: { byMarket: { home: { a: '2026-11-18T04:00:00.000Z' } } },
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home' })] },
        });
        expect(result[jobStatusKey('home', 'a')]).toBe('done');
    });

    it('tags a claimable job that has no run report entry', () => {
        const result = buildJobStatusById(false, [], {}, {
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: true })] },
        });
        expect(result[jobStatusKey('home', 'a')]).toBe('ready');
    });

    it('does not let a completed home job tag the same id in another market', () => {
        const result = buildJobStatusById(false, [], {}, {
            completedJobsByMarket: { byMarket: { home: { shared: '2026-11-18T04:00:00.000Z' } } },
            jobsByMarket: {
                home: [offer({ id: 'shared', marketKey: 'home' })],
                dark: [offer({ id: 'shared', marketKey: 'dark' })],
            },
            resetByMarket: { home: '2026-11-18T04:00:00.000Z', dark: '2026-11-18T04:00:00.000Z' },
        });
        expect(result).toEqual({ [jobStatusKey('home', 'shared')]: 'done' });
    });

    it('keeps legacy completion counts separate from market-scoped counts', () => {
        expect(countCompletionRecords(
            { byMarket: { home: { a: 'reset-a', b: 'reset-a' }, dark: { c: 'reset-b' } } },
            { legacy1: 'reset-a', legacy2: 'reset-b' },
        )).toEqual({ marketScoped: 3, legacyUnknown: 2 });
    });

    it('ignores Auto Finish data while it is disabled', () => {
        expect(buildJobStatusById(false, [{
            marketKey: 'home',
            label: 'Home',
            ok: true,
            skipped: 0,
            jobs: [{ jobId: 'a', name: 'A', serverName: null, marketKey: 'home', status: 'failed' }],
        }], {})).toEqual({});
    });
});

describe('groupJobsByMarket', () => {
    it('groups offers by market key', () => {
        const grouped = groupJobsByMarket([
            offer({ id: 'a', marketKey: 'home' }),
            offer({ id: 'b', marketKey: 'dark' }),
            offer({ id: 'c', marketKey: 'home' }),
        ]);
        expect(grouped.home?.map((job) => job.id)).toEqual(['a', 'c']);
        expect(grouped.dark?.map((job) => job.id)).toEqual(['b']);
    });
});

describe('resetAtByMarket', () => {
    it('keeps resets for healthy markets only', () => {
        expect(resetAtByMarket([
            { marketKey: 'home', ok: true, resetAt: '2026-01-01T00:00:00.000Z' },
            { marketKey: 'dark', ok: false, error: 'timeout', skipped: 0 },
        ])).toEqual({ home: '2026-01-01T00:00:00.000Z' });
    });
});

describe('buildJobMarketViews', () => {
    it('merges snapshot, reset and selection data per catalog market', () => {
        const views = buildJobMarketViews({
            autoJobsMarkets: [{ marketKey: 'home', label: 'Home', ok: true, skipped: 1, failed: 2, expired: 3 }],
            autoRunMarkets: [{ marketKey: 'dark', label: 'Dark', ok: true, skipped: 0, resetAt: '2026-02-02T00:00:00.000Z' }],
            jobResetByMarket: {},
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home' })] },
        });
        const home = views.find((view) => view.market.key === 'home');
        const dark = views.find((view) => view.market.key === 'dark');
        expect(home).toMatchObject({ skipped: 1, failed: 2, expired: 3, resetAt: null, ok: true });
        expect(home?.jobs.map((job) => job.id)).toEqual(['a']);
        expect(dark?.resetAt).toBe('2026-02-02T00:00:00.000Z');
    });
});
