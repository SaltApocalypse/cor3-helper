import type { AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import { JOB_MARKETS, jobMarketByKey, type JobOffer } from '../../../application/popup/catalog.js';
import type { JobQueueResult } from '../../../application/popup/portal.js';
import { isExpiredJobFailureText } from '../../../application/auto-job/expiry.js';
import type { JobMarketView } from '../../components/JobMarketList.js';

/**
 * Pure job report/status calculations for the side panel (H8 phase 7).
 *
 * These helpers used to live inside `SidePanelApp.tsx`; keeping them free of
 * Preact and `document` makes them unit-testable.
 */

export type JobRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface UiJobReport {
    readonly marketKey: string;
    readonly label: string;
    readonly ok: boolean;
    readonly total: number;
    readonly success: number;
    readonly retry: number;
    readonly failed: number;
    readonly expired: number;
    readonly pending: number;
    readonly skipped?: number;
    readonly error?: string;
}

export function jobStatusTone(status: string): string {
    if (/fail|error|invalid/i.test(status)) return 'v2-text-error';
    if (/complete|done|success/i.test(status)) return 'v2-text-ok';
    if (/stop|cancel|select|running|wait|busy/i.test(status)) return 'v2-text-warn';
    return '';
}

export function autoFinishMarketsToJobReport(markets: readonly AutoFinishMarketResult[]): UiJobReport[] {
    return markets.map((market) => {
        const jobs = market.jobs ?? [];
        return {
            marketKey: market.marketKey,
            label: market.label,
            ok: market.ok,
            total: market.jobTotal ?? 0,
            success: market.success ?? 0,
            retry: market.retry ?? jobs.filter((job) => job.status === 'retry').length,
            failed: market.failed ?? 0,
            expired: market.expired ?? jobs.filter((job) => job.code === 'EXPIRED' || job.status === 'expired').length,
            pending: market.pending ?? 0,
            skipped: market.skipped ?? 0,
            ...(market.error ? { error: market.error } : {}),
        };
    });
}

/**
 * Snapshot-only fallback while Auto complete has not produced a run report
 * yet. It reports sync health, not per-job completion counts.
 */
export function autoJobsSnapshotToJobReport(markets: readonly AutoJobsMarket[]): UiJobReport[] {
    return markets.map((market) => ({
        marketKey: market.marketKey,
        label: market.label,
        ok: market.ok,
        total: 0,
        success: 0,
        retry: 0,
        failed: market.failed ?? 0,
        expired: market.expired ?? 0,
        pending: 0,
        skipped: market.skipped,
        ...(market.error ? { error: market.error } : {}),
    }));
}

/**
 * Picks the report the Auto Jobs card shows: the live Auto Finish run first,
 * then the last manual queue run, then the snapshot fallback.
 */
export function selectShownJobReport(input: {
    readonly autoFinishEnabled: boolean;
    readonly autoRunMarkets: readonly AutoFinishMarketResult[];
    readonly jobReport: readonly UiJobReport[];
    readonly autoJobsMarkets: readonly AutoJobsMarket[];
}): readonly UiJobReport[] {
    const autoFinishReport = input.autoFinishEnabled
        ? autoFinishMarketsToJobReport(input.autoRunMarkets)
        : [];
    if (autoFinishReport.length > 0) return autoFinishReport;
    if (input.jobReport.length > 0) return input.jobReport;
    return autoJobsSnapshotToJobReport(input.autoJobsMarkets);
}

export interface JobQueueOutcome {
    readonly report: readonly UiJobReport[];
    readonly statuses: Readonly<Record<string, JobRunStatus>>;
}

/** Maps a finished `runJobQueue` result onto per-market reports and per-job statuses. */
export function classifyJobQueueResult(
    selected: readonly JobOffer[],
    result: JobQueueResult,
): JobQueueOutcome {
    const done = new Set(result.done);
    const failedIds = new Set(result.failed.map((entry) => entry.jobId));
    const preflightIds = new Set(result.failed
        .filter((entry) => entry.code === 'PREFLIGHT_FAILED')
        .map((entry) => entry.jobId));
    const cancelledIds = new Set(result.failed
        .filter((entry) => entry.code === 'JOB_CANCELLED')
        .map((entry) => entry.jobId));
    const expiredIds = new Set(result.failed
        .filter((entry) => isExpiredJobFailureText(entry.code, entry.message))
        .map((entry) => entry.jobId));
    const reports = new Map<string, { label: string; ok: boolean; total: number; success: number; retry: number; failed: number; expired: number; pending: number }>();
    const statuses: Record<string, JobRunStatus> = {};
    for (const job of selected) {
        const entry = reports.get(job.marketKey) ?? {
            label: jobMarketByKey(job.marketKey)?.label ?? job.marketKey,
            ok: true,
            total: 0,
            success: 0,
            retry: 0,
            failed: 0,
            expired: 0,
            pending: 0,
        };
        entry.total++;
        if (done.has(job.id)) entry.success++;
        else if (expiredIds.has(job.id)) entry.expired++;
        else if (failedIds.has(job.id) && !preflightIds.has(job.id) && !cancelledIds.has(job.id)) entry.failed++;
        else entry.pending++;
        reports.set(job.marketKey, entry);
        statuses[job.id] = done.has(job.id)
            ? 'done'
            : preflightIds.has(job.id) || cancelledIds.has(job.id) || expiredIds.has(job.id)
                ? 'skipped'
                : failedIds.has(job.id)
                    ? 'failed'
                    : result.stopped ? 'skipped' : 'pending';
    }
    return {
        report: [...reports.entries()].map(([marketKey, entry]) => ({ marketKey, ...entry })),
        statuses,
    };
}

/** Merges Auto Finish per-job statuses with the manual queue statuses. */
export function buildJobStatusById(
    autoFinishEnabled: boolean,
    autoRunMarkets: readonly AutoFinishMarketResult[],
    jobRunStatusById: Readonly<Record<string, JobRunStatus | undefined>>,
): Record<string, string> {
    const result: Record<string, string> = {};
    if (autoFinishEnabled) {
        for (const market of autoRunMarkets) {
            for (const job of market.jobs ?? []) {
                result[job.jobId] = job.code === 'EXPIRED' || job.status === 'expired' ? 'expired' : job.status;
            }
        }
    }
    for (const [jobId, status] of Object.entries(jobRunStatusById)) {
        if (status !== undefined) result[jobId] = status;
    }
    return result;
}

export function buildJobMarketViews(input: {
    readonly autoJobsMarkets: readonly AutoJobsMarket[];
    readonly autoRunMarkets: readonly AutoFinishMarketResult[];
    readonly jobResetByMarket: Readonly<Record<string, string | null>>;
    readonly jobsByMarket: Readonly<Record<string, readonly JobOffer[]>>;
}): readonly JobMarketView[] {
    return JOB_MARKETS.map((market) => {
        const snapshotMarket = input.autoJobsMarkets.find((entry) => entry.marketKey === market.key);
        const resetAt = input.jobResetByMarket[market.key]
            ?? input.autoRunMarkets.find((entry) => entry.marketKey === market.key)?.resetAt
            ?? null;
        return {
            market,
            jobs: input.jobsByMarket[market.key] ?? [],
            skipped: snapshotMarket?.skipped ?? 0,
            failed: snapshotMarket?.failed ?? 0,
            expired: snapshotMarket?.expired ?? 0,
            skippedJobs: snapshotMarket?.skippedJobs ?? [],
            resetAt,
            ok: snapshotMarket?.ok ?? true,
            ...(snapshotMarket?.error ? { error: snapshotMarket.error } : {}),
        };
    });
}

/** Groups a flat job list by market key, preserving order. */
export function groupJobsByMarket(jobs: readonly JobOffer[]): Record<string, JobOffer[]> {
    const grouped: Record<string, JobOffer[]> = {};
    for (const job of jobs) (grouped[job.marketKey] ??= []).push(job);
    return grouped;
}

/** Reset countdown per healthy market. */
export function resetAtByMarket(
    markets: readonly {
        readonly marketKey: string;
        readonly ok: boolean;
        readonly resetAt?: string | null;
        readonly error?: string;
        readonly skipped?: number;
    }[],
): Record<string, string | null> {
    const resets: Record<string, string | null> = {};
    for (const market of markets) {
        if (market.ok) resets[market.marketKey] = market.resetAt ?? null;
    }
    return resets;
}
