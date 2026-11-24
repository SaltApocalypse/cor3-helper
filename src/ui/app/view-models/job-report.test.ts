import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../../contracts/jobs.js';
import type { AutoFinishFailure, AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import {
    autoFinishMarketsToJobReport,
    autoJobsSnapshotToJobReport,
    buildJobMarketViews,
    buildJobStatusById,
    buildUnknownJobIds,
    buildUnknownJobIdsFromProjection,
    classifyJobQueueResult,
    countCompletionRecords,
    groupJobsByMarket,
    isJobSelected,
    jobStatusKey,
    jobStatusTone,
    resetAtByMarket,
    resolveUnknownJobs,
    selectShownJobReport,
    showClaimableBadge,
    jobTagView,
    normalizeJobStatus,
    sortUnknownJobs,
    toggleJobSelection,
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
        expect(jobStatusTone('unknown')).toBe('v2-text-warn');
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
            done: [jobStatusKey('home', 'done'), jobStatusKey('home', 'expired')],
            failed: [
                { jobId: 'expired', name: 'expired', serverName: null, marketKey: 'home', code: 'JOB_FAILED', message: 'job expired' },
                { jobId: 'failed', name: 'failed', serverName: null, marketKey: 'home', code: 'JOB_FAILED', message: 'boom' },
                { jobId: 'preflight', name: 'preflight', serverName: null, marketKey: 'dark', code: 'PREFLIGHT_FAILED', message: 'no software' },
                { jobId: 'cancelled', name: 'cancelled', serverName: null, marketKey: 'dark', code: 'JOB_CANCELLED', message: 'cancelled' },
            ],
        });
        expect(outcome.statuses).toEqual({
            [jobStatusKey('home', 'done')]: 'done',
            [jobStatusKey('home', 'expired')]: 'done',
            [jobStatusKey('home', 'failed')]: 'failed',
            [jobStatusKey('dark', 'preflight')]: 'skipped',
            [jobStatusKey('dark', 'cancelled')]: 'skipped',
            [jobStatusKey('dark', 'pending')]: 'pending',
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
        expect(outcome.statuses[jobStatusKey('home', 'pending')]).toBe('skipped');
    });

    it('associates queue failures with the correct market for a shared job id', () => {
        const outcome = classifyJobQueueResult(
            [offer({ id: 'shared', marketKey: 'home' }), offer({ id: 'shared', marketKey: 'dark' })],
            {
                stopped: false,
                done: [jobStatusKey('home', 'shared')],
                failed: [{
                    jobId: 'shared',
                    name: 'shared',
                    serverName: null,
                    marketKey: 'dark',
                    code: 'JOB_FAILED',
                    message: 'dark failure',
                }],
            },
        );
        expect(outcome.statuses[jobStatusKey('home', 'shared')]).toBe('done');
        expect(outcome.statuses[jobStatusKey('dark', 'shared')]).toBe('failed');
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
        }], { [jobStatusKey('home', 'a')]: 'done' });
        expect(result).toEqual({ [jobStatusKey('home', 'a')]: 'done', [jobStatusKey('home', 'b')]: 'expired' });
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
        expect(result[jobStatusKey('home', 'a')]).toBe('claimable');
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

    it('keeps the same job id as two independent UI records across markets', () => {
        const grouped = groupJobsByMarket([
            offer({ id: 'shared', marketKey: 'home' }),
            offer({ id: 'shared', marketKey: 'dark' }),
        ]);
        expect(grouped.home?.map((job) => job.id)).toEqual(['shared']);
        expect(grouped.dark?.map((job) => job.id)).toEqual(['shared']);
        expect(jobStatusKey('home', 'shared')).not.toBe(jobStatusKey('dark', 'shared'));
    });

    it('selects the same job id independently per market', () => {
        const selected = toggleJobSelection(new Set<string>(), 'home', 'shared');
        expect(isJobSelected(selected, 'home', 'shared')).toBe(true);
        expect(isJobSelected(selected, 'dark', 'shared')).toBe(false);
        const next = toggleJobSelection(selected, 'dark', 'shared');
        expect(isJobSelected(next, 'home', 'shared')).toBe(true);
        expect(isJobSelected(next, 'dark', 'shared')).toBe(true);
        const cleared = toggleJobSelection(next, 'home', 'shared');
        expect(isJobSelected(cleared, 'home', 'shared')).toBe(false);
        expect(isJobSelected(cleared, 'dark', 'shared')).toBe(true);
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


describe('D0-1B unknown and ready dimensions', () => {
    const reset = '2026-11-20T11:00:00.000Z';
    const nextReset = '2026-11-20T12:00:00.000Z';

    const failure = (marketKey: string | undefined, jobId = 'a', unconfirmed = true): AutoFinishFailure => ({
        jobId,
        name: jobId,
        serverName: null,
        ...(marketKey ? { marketKey } : {}),
        code: 'COMPLETE_FAILED',
        message: 'Completion result unconfirmed',
        ...(unconfirmed ? { unconfirmed: true } : {}),
    });

    const market = (marketKey: string, resetAt: string | null, jobs: AutoFinishMarketResult['jobs']): AutoFinishMarketResult => ({
        marketKey,
        label: marketKey.toUpperCase(),
        ok: true,
        skipped: 0,
        resetAt,
        jobs,
    });

    const failedJob = (marketKey: string, id = 'a'): NonNullable<AutoFinishMarketResult['jobs']>[number] => ({
        jobId: id,
        name: id,
        serverName: null,
        marketKey,
        status: 'failed',
        code: 'COMPLETE_FAILED',
        error: 'Completion result unconfirmed',
    });

    it('T01 keeps an ordinary failure as Failed', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {});
        expect(status[jobStatusKey('home', 'a')]).toBe('failed');
    });

    it('T02 maps an unconfirmed failure to Unknown', () => {
        const unknown = buildUnknownJobIds([market('home', reset, [failedJob('home')])], [failure('home')], { home: reset });
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            unknownByIdentity: unknown,
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('unknown');
    });

    it('T04 keeps Unknown and Ready as independent dimensions', () => {
        const claimable = offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: true });
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
            jobsByMarket: { home: [claimable] },
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('unknown');
        expect(showClaimableBadge(claimable, status[jobStatusKey('home', 'a')])).toBe(true);
    });

    it('T05 does not make Unknown Done without a sidecar', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            completedJobsByMarket: { byMarket: {} },
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('unknown');
        expect(status[jobStatusKey('home', 'a')]).not.toBe('done');
    });

    it('T06 keeps Done when the sidecar has the current reset', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            completedJobsByMarket: { byMarket: { home: { a: reset } } },
            resetByMarket: { home: reset },
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home' })] },
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('done');
    });

    it('T07 keeps same job id statuses independent across markets', () => {
        const home = market('home', reset, [failedJob('home', 'shared')]);
        const dark = market('dark', reset, [failedJob('dark', 'shared')]);
        const unknown = buildUnknownJobIds([home, dark], [failure('home', 'shared')], { home: reset, dark: reset });
        const status = buildJobStatusById(true, [home, dark], {}, {
            unknownByIdentity: unknown,
            jobsByMarket: {
                home: [offer({ id: 'shared', marketKey: 'home', alreadyTaken: true, canComplete: true })],
                dark: [offer({ id: 'shared', marketKey: 'dark', alreadyTaken: true, canComplete: true })],
            },
        });
        expect(status[jobStatusKey('home', 'shared')]).toBe('unknown');
        expect(status[jobStatusKey('dark', 'shared')]).toBe('failed');
        expect(showClaimableBadge(offer({ id: 'shared', marketKey: 'dark', alreadyTaken: true, canComplete: true }), 'failed')).toBe(true);
    });

    it('T08 keeps Market A Unknown and Market B Ready without crossing', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home', 'shared')])], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'shared')]),
            jobsByMarket: {
                home: [offer({ id: 'shared', marketKey: 'home', alreadyTaken: true, canComplete: true })],
                dark: [offer({ id: 'shared', marketKey: 'dark', alreadyTaken: true, canComplete: true })],
            },
        });
        expect(status[jobStatusKey('home', 'shared')]).toBe('unknown');
        expect(status[jobStatusKey('dark', 'shared')]).toBe('claimable');
    });

    it('T09 ignores a legacy failure without marketKey', () => {
        const unknown = buildUnknownJobIds([market('home', reset, [failedJob('home')])], [failure(undefined)], { home: reset });
        expect(unknown.size).toBe(0);
    });

    it('T10 ignores a failure from another reset', () => {
        const unknown = buildUnknownJobIds([market('home', reset, [failedJob('home')])], [failure('home')], { home: nextReset });
        expect(unknown.size).toBe(0);
    });

    it('T11 lets final Unknown win over live pending', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home' })] },
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('unknown');
    });

    it('T12 keeps a claimable badge for a cached claim-only row', () => {
        const claimable = offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: true });
        const status = buildJobStatusById(true, [market('home', reset, [{
            jobId: 'a', name: 'a', serverName: null, marketKey: 'home', status: 'pending',
        }])], {}, { jobsByMarket: { home: [claimable] } });
        expect(status[jobStatusKey('home', 'a')]).toBe('pending');
        expect(showClaimableBadge(claimable, status[jobStatusKey('home', 'a')])).toBe(true);
    });

    const unknownJob = (marketKey: string, jobId: string, resetAt: string | null) => ({ marketKey, jobId, resetAt });

    it('T01 loaded uses durable unknownJobs', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: reset },
        });
        expect(resolved.status).toBe('loaded');
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
    });

    it('T02 loaded empty ignores old last.failures', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [failure('home')],
            resetByMarket: { home: reset },
        });
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T03 partial uses durable unknownJobs', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'partial',
            autoRunMarkets: [],
            failures: [],
            resetByMarket: { home: reset },
        });
        expect(resolved.status).toBe('partial');
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
    });

    it('T04 partial fallback requires matching market and reset', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [],
            unknownStateStatus: 'partial',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [failure('home'), failure('dark')],
            resetByMarket: { home: reset, dark: nextReset },
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
        expect(resolved.unknownByIdentity.has(jobStatusKey('dark', 'a'))).toBe(false);
    });

    it('T05 unavailable uses strictly checked fallback', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'unavailable',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [failure('home')],
            resetByMarket: { home: reset },
        });
        expect(resolved.status).toBe('unavailable');
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
    });

    it('T06 unavailable without usable failure is not treated as confirmed empty', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [],
            unknownStateStatus: 'unavailable',
            autoRunMarkets: [],
            failures: [failure(undefined)],
            resetByMarket: {},
        });
        expect(resolved.status).toBe('unavailable');
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T07 ignores a failure without marketKey', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [],
            unknownStateStatus: 'partial',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [failure(undefined)],
            resetByMarket: { home: reset },
        });
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T08 does not associate Unknown Reset A with current Reset B', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', nextReset, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: nextReset },
        });
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T09 does not associate null Unknown with a known current Reset', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', null)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: reset },
        });
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T10 does not associate known Unknown with a null current Reset', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', null, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: null },
        });
        expect(resolved.unknownByIdentity.size).toBe(0);
    });

    it('T11 associates null Unknown with null current Reset but not Done', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', null)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', null, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: null },
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
    });

    it('T12 makes Sidecar Done override Unknown', () => {
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
            completedJobsByMarket: { byMarket: { home: { a: reset } } },
            resetByMarket: { home: reset },
            jobsByMarket: { home: [offer({ id: 'a', marketKey: 'home' })] },
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('done');
    });

    it('T13 shows Unknown and Ready together', () => {
        const claimable = offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: true });
        const status = buildJobStatusById(true, [market('home', reset, [failedJob('home')])], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'a')]),
            jobsByMarket: { home: [claimable] },
        });
        expect(status[jobStatusKey('home', 'a')]).toBe('unknown');
        expect(showClaimableBadge(claimable, 'unknown')).toBe(true);
    });

    it('T14 keeps same job id independent across markets', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'shared', reset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home', 'shared')])],
            failures: [],
            resetByMarket: { home: reset, dark: reset },
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'shared'))).toBe(true);
        expect(resolved.unknownByIdentity.has(jobStatusKey('dark', 'shared'))).toBe(false);
    });

    it('T15 keeps durable Unknown when old last.failures is overwritten/empty', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'a', reset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home')])],
            failures: [],
            resetByMarket: { home: reset },
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'a'))).toBe(true);
    });

    it('T16 sorts unknownJobs deterministically', () => {
        const first = unknownJob('home', 'b', reset);
        const second = unknownJob('home', 'a', nextReset);
        expect(sortUnknownJobs([first, second])).toEqual([second, first]);
        expect(sortUnknownJobs([second, first])).toEqual([second, first]);
    });

    it('T17 does not associate a different Reset identity', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [unknownJob('home', 'shared', reset), unknownJob('home', 'shared', nextReset)],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [market('home', reset, [failedJob('home', 'shared')])],
            failures: [],
            resetByMarket: { home: reset },
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'shared'))).toBe(true);
        expect(buildUnknownJobIdsFromProjection([unknownJob('home', 'shared', nextReset)], { home: reset }).size).toBe(0);
    });
});

describe('Manual Queue Unknown integration', () => {
    const reset = '2026-11-20T11:00:00.000Z';
    const selected = [offer({ id: 'shared', marketKey: 'home', alreadyTaken: true, canComplete: true })];

    const failure = (unconfirmed: boolean, marketKey = 'home') => ({
        jobId: 'shared',
        name: 'shared',
        serverName: null,
        marketKey,
        code: 'COMPLETE_FAILED',
        message: unconfirmed ? 'Completion result unconfirmed' : 'explicit failure',
        unconfirmed,
    });

    it('T04 keeps an explicit manual queue failure as Failed', () => {
        const outcome = classifyJobQueueResult(selected, {
            stopped: false,
            done: [],
            failed: [failure(false)],
        });
        expect(outcome.statuses[jobStatusKey('home', 'shared')]).toBe('failed');
        expect(outcome.report[0]?.failed).toBe(1);
    });

    it('T05 maps an unconfirmed manual queue failure to Unknown', () => {
        const outcome = classifyJobQueueResult(selected, {
            stopped: false,
            done: [],
            failed: [failure(true)],
        });
        expect(outcome.statuses[jobStatusKey('home', 'shared')]).toBe('unknown');
        expect(outcome.report[0]?.unknown).toBe(1);
    });

    it('T06 does not associate a manual failure with an empty marketKey', () => {
        const outcome = classifyJobQueueResult(selected, {
            stopped: false,
            done: [],
            failed: [failure(true, '')],
        });
        expect(outcome.statuses[jobStatusKey('home', 'shared')]).toBe('pending');
    });

    it('T07 keeps manual queue failures independent across markets', () => {
        const jobs = [
            offer({ id: 'shared', marketKey: 'home' }),
            offer({ id: 'shared', marketKey: 'dark' }),
        ];
        const outcome = classifyJobQueueResult(jobs, {
            stopped: false,
            done: [],
            failed: [failure(true, 'home')],
        });
        expect(outcome.statuses[jobStatusKey('home', 'shared')]).toBe('unknown');
        expect(outcome.statuses[jobStatusKey('dark', 'shared')]).toBe('pending');
    });

    it('T14 keeps durable Unknown after manual in-memory status is cleared', () => {
        const status = buildJobStatusById(true, [], {}, {
            unknownByIdentity: new Set([jobStatusKey('home', 'shared')]),
            jobsByMarket: { home: selected },
        });
        expect(status[jobStatusKey('home', 'shared')]).toBe('unknown');
    });

    it('T15 does not let an ordinary manual failure overwrite durable Unknown', () => {
        const status = buildJobStatusById(true, [], { [jobStatusKey('home', 'shared')]: 'failed' }, {
            unknownByIdentity: new Set([jobStatusKey('home', 'shared')]),
            jobsByMarket: { home: selected },
        });
        expect(status[jobStatusKey('home', 'shared')]).toBe('unknown');
    });

    it('T17 keeps AutoFinish and Manual Queue Unknown judgment aligned', () => {
        const resolved = resolveUnknownJobs({
            unknownJobs: [{ marketKey: 'home', jobId: 'shared', resetAt: reset }],
            unknownStateStatus: 'loaded',
            autoRunMarkets: [{
                marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: reset,
                jobs: [{ jobId: 'shared', name: 'shared', serverName: null, marketKey: 'home', status: 'failed', code: 'COMPLETE_FAILED' }],
            }],
            failures: [],
            resetByMarket: { home: reset },
        });
        const manual = classifyJobQueueResult(selected, {
            stopped: false,
            done: [],
            failed: [failure(true)],
        });
        expect(resolved.unknownByIdentity.has(jobStatusKey('home', 'shared'))).toBe(true);
        expect(manual.statuses[jobStatusKey('home', 'shared')]).toBe('unknown');
    });
});

describe('jobTagView', () => {
    const claimable = offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: true });
    const blocked = offer({ id: 'a', marketKey: 'home', alreadyTaken: true, canComplete: false });

    it('shows one green claimable tag for an unconfirmed claimable job', () => {
        expect(jobTagView(claimable, 'unknown')).toEqual({
            primary: 'claimable',
            tone: 'ok',
            title: 'The previous completion result was unconfirmed. The next Auto Finish run will claim it.',
        });
    });

    it('collapses ready / ready-to-claim / retry into claimable', () => {
        expect(jobTagView(claimable, undefined)).toEqual({ primary: 'claimable', tone: 'ok' });
        expect(jobTagView(claimable, 'ready')).toEqual({ primary: 'claimable', tone: 'ok' });
        expect(jobTagView(claimable, 'retry')).toEqual({ primary: 'claimable', tone: 'ok' });
    });

    it('keeps a real failure primary and claimability secondary', () => {
        expect(jobTagView(claimable, 'failed')).toEqual({
            primary: 'failed',
            tone: 'error',
            secondary: 'claimable',
        });
    });

    it('never shows claimability on Done and never shows a tag without status', () => {
        expect(jobTagView(claimable, 'done')).toEqual({ primary: 'done', tone: 'ok' });
        expect(jobTagView(blocked, undefined)).toBeNull();
    });

    it('keeps Unknown when the row is not claimable', () => {
        expect(jobTagView(blocked, 'unknown')).toEqual({ primary: 'unknown', tone: 'warn' });
    });
});

describe('normalizeJobStatus', () => {
    it('merges duplicate market-mapper labels into the canonical set', () => {
        expect(normalizeJobStatus('ready')).toBe('claimable');
        expect(normalizeJobStatus('ready to claim')).toBe('claimable');
        expect(normalizeJobStatus('completed')).toBe('done');
        expect(normalizeJobStatus('invalid')).toBe('skipped');
        expect(normalizeJobStatus('unsupported')).toBe('skipped');
        expect(normalizeJobStatus('not-a-status')).toBeUndefined();
    });
});
