import type { AutoFinishFailure, AutoFinishMarketResult, AutoFinishUnknownJob } from '../../../contracts/auto-finish.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import { JOB_MARKETS, jobMarketByKey, type JobOffer } from '../../../application/popup/catalog.js';
import type { JobQueueResult } from '../../../application/popup/portal.js';
import { jobIdentityKey, jobIdentityParts } from '../../../contracts/jobs.js';
import { isExpiredJobFailureText } from '../../../application/auto-job/expiry.js';
import { isCompletedForMarketReset } from '../../../application/auto-job/market-completion.js';
import { EMPTY_MARKET_COMPLETED_JOBS, type MarketCompletedJobsState } from '../../../contracts/market-completed-jobs.js';
import type { JobMarketView } from '../../components/JobMarketList.js';

/**
 * Pure job report/status calculations for the side panel (H8 phase 7).
 *
 * These helpers used to live inside `SidePanelApp.tsx`; keeping them free of
 * Preact and `document` makes them unit-testable.
 */

export type JobRunStatus = 'pending' | 'running' | 'done' | 'failed' | 'unknown' | 'skipped';

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
    readonly unknown?: number;
    readonly skipped?: number;
    readonly error?: string;
    readonly errorCode?: string;
}

export function jobStatusTone(status: string): string {
    const text = status.trim();
    if (/^(idle|空闲)$/i.test(text)) return '';
    if (/no market synced|尚未同步/i.test(text)) return '';
    if (/fail|error|invalid|unknown market|no game websocket|unavailable|timeout|timed out|失败|错误|无效|未知市场|不可用|超时/i.test(text)) return 'v2-text-error';
    if (/complete|done|success|synced|ready|已同步|已完成|成功|就绪/i.test(text)) return 'v2-text-ok';
    if (/unknown|stop|cancel|select|running|wait|busy|syncing|未知|停止|取消|选择|运行|等待|同步中|正在同步/i.test(text)) return 'v2-text-warn';
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
        ...(market.errorCode ? { errorCode: market.errorCode } : {}),
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
    const failureKey = (entry: JobQueueResult['failed'][number]): string | null =>
        entry.marketKey ? jobIdentityKey(entry.marketKey, entry.jobId) : null;
    const failureKeys = (entries: readonly JobQueueResult['failed'][number][]): Set<string> =>
        new Set(entries.map(failureKey).filter((key): key is string => key !== null));
    const failedIds = failureKeys(result.failed);
    const preflightIds = failureKeys(result.failed.filter((entry) => entry.code === 'PREFLIGHT_FAILED'));
    const cancelledIds = failureKeys(result.failed.filter((entry) => entry.code === 'JOB_CANCELLED'));
    const expiredIds = failureKeys(result.failed.filter((entry) => isExpiredJobFailureText(entry.code, entry.message)));
    const unknownIds = failureKeys(result.failed.filter((entry) => entry.unconfirmed === true));
    const reports = new Map<string, { label: string; ok: boolean; total: number; success: number; retry: number; failed: number; expired: number; pending: number; unknown?: number }>();
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
        const key = jobIdentityKey(job.marketKey, job.id);
        entry.total++;
        if (done.has(key)) entry.success++;
        else if (unknownIds.has(key)) entry.unknown = (entry.unknown ?? 0) + 1;
        else if (expiredIds.has(key)) entry.expired++;
        else if (failedIds.has(key) && !preflightIds.has(key) && !cancelledIds.has(key)) entry.failed++;
        else entry.pending++;
        reports.set(job.marketKey, entry);
        statuses[key] = done.has(key)
            ? 'done'
            : unknownIds.has(key)
                ? 'unknown'
                : preflightIds.has(key) || cancelledIds.has(key) || expiredIds.has(key)
                    ? 'skipped'
                    : failedIds.has(key)
                        ? 'failed'
                        : result.stopped ? 'skipped' : 'pending';
    }
    return {
        report: [...reports.entries()].map(([marketKey, entry]) => ({ marketKey, ...entry })),
        statuses,
    };
}

/** Composite key so the same job id in different markets cannot share a UI tag. */
export function jobStatusKey(marketKey: string, jobId: string): string {
    return jobIdentityKey(marketKey, jobId);
}

/** Selection is market-scoped; a shared jobId in another market is not selected. */
export function isJobSelected(selected: ReadonlySet<string>, marketKey: string, jobId: string): boolean {
    return selected.has(jobIdentityKey(marketKey, jobId));
}

/**
 * Complete-unknown failures exposed by AutoFinish. A failure is only accepted
 * when it has a market and its report market reset matches the current reset.
 * Legacy failures without a marketKey are ignored rather than guessed.
 */
export function buildUnknownJobIds(
    autoRunMarkets: readonly AutoFinishMarketResult[],
    failures: readonly AutoFinishFailure[],
    resetByMarket: Readonly<Record<string, string | null>>,
): Set<string> {
    const reportResetByMarket = new Map(
        autoRunMarkets.map((market) => [market.marketKey, market.resetAt ?? null] as const),
    );
    const unknown = new Set<string>();
    for (const failure of failures) {
        if (failure.unconfirmed !== true || !failure.marketKey) continue;
        const reportReset = reportResetByMarket.get(failure.marketKey) ?? null;
        const currentReset = resetByMarket[failure.marketKey] ?? null;
        if (reportReset !== currentReset) continue;
        unknown.add(jobIdentityKey(failure.marketKey, failure.jobId));
    }
    return unknown;
}

/** Claimable is a second dimension and must not replace Unknown/Failed/Done. */
export function showClaimableBadge(
    job: Pick<JobOffer, 'alreadyTaken' | 'canComplete'>,
    status: string | undefined,
): boolean {
    return job.alreadyTaken && job.canComplete && status !== 'ready' && status !== 'done';
}

/** Stable order for the Unknown projection; never affects the underlying records. */
export function sortUnknownJobs(
    jobs: readonly AutoFinishUnknownJob[],
): readonly AutoFinishUnknownJob[] {
    return [...jobs].sort((left, right) =>
        left.marketKey.localeCompare(right.marketKey)
        || left.jobId.localeCompare(right.jobId)
        || (left.resetAt ?? '').localeCompare(right.resetAt ?? ''),
    );
}

/**
 * Current-reset association for the durable projection. A null reset is only
 * accepted when the current reset is also null; it is never replaced by the
 * current market reset.
 */
export function buildUnknownJobIdsFromProjection(
    jobs: readonly AutoFinishUnknownJob[],
    resetByMarket: Readonly<Record<string, string | null>>,
): Set<string> {
    const unknown = new Set<string>();
    for (const job of jobs) {
        if (!job.marketKey || !job.jobId) continue;
        const currentReset = resetByMarket[job.marketKey] ?? null;
        const matches = job.resetAt === null
            ? currentReset === null
            : currentReset !== null && job.resetAt === currentReset;
        if (!matches) continue;
        unknown.add(jobIdentityKey(job.marketKey, job.jobId));
    }
    return unknown;
}

export type UnknownStateStatus = 'loaded' | 'partial' | 'unavailable';

export interface ResolvedUnknownJobs {
    readonly unknownByIdentity: ReadonlySet<string>;
    readonly status: UnknownStateStatus;
    /** Stable, sorted projection hint for callers that expose it. */
    readonly jobs: readonly AutoFinishUnknownJob[];
}

/**
 * Data-source priority:
 * - loaded: durable unknownJobs only; last.failures is ignored.
 * - partial: durable unknownJobs + strictly reset-checked last.failures.
 * - unavailable: strictly reset-checked last.failures only.
 */
export function resolveUnknownJobs(input: {
    readonly unknownJobs: readonly AutoFinishUnknownJob[];
    readonly unknownStateStatus: UnknownStateStatus;
    readonly autoRunMarkets: readonly AutoFinishMarketResult[];
    readonly failures: readonly AutoFinishFailure[];
    readonly resetByMarket: Readonly<Record<string, string | null>>;
}): ResolvedUnknownJobs {
    const jobs = sortUnknownJobs(input.unknownJobs);
    const durable = input.unknownStateStatus === 'unavailable'
        ? new Set<string>()
        : buildUnknownJobIdsFromProjection(jobs, input.resetByMarket);
    const fallback = input.unknownStateStatus === 'loaded'
        ? new Set<string>()
        : buildUnknownJobIds(input.autoRunMarkets, input.failures, input.resetByMarket);
    return {
        unknownByIdentity: new Set([...durable, ...fallback]),
        status: input.unknownStateStatus,
        jobs,
    };
}

/** Toggle only the requested market/job identity, leaving same-id jobs elsewhere alone. */
export function toggleJobSelection(
    selected: ReadonlySet<string>,
    marketKey: string,
    jobId: string,
): ReadonlySet<string> {
    const key = jobIdentityKey(marketKey, jobId);
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
}

/** Merges Auto Finish per-job statuses with the manual queue statuses. */
export function buildJobStatusById(
    autoFinishEnabled: boolean,
    autoRunMarkets: readonly AutoFinishMarketResult[],
    jobRunStatusById: Readonly<Record<string, JobRunStatus | undefined>>,
    extras: {
        readonly completedJobsByMarket?: MarketCompletedJobsState;
        readonly resetByMarket?: Readonly<Record<string, string | null>>;
        readonly jobsByMarket?: Readonly<Record<string, readonly JobOffer[]>>;
        readonly unknownByIdentity?: ReadonlySet<string>;
    } = {},
): Record<string, string> {
    const result: Record<string, string> = {};
    const completedJobsByMarket = extras.completedJobsByMarket ?? EMPTY_MARKET_COMPLETED_JOBS;
    const jobsByMarket = extras.jobsByMarket ?? {};
    const setStatusKey = (marketKey: string, jobId: string, status: string): string => {
        const key = jobStatusKey(marketKey, jobId);
        result[key] = status;
        return key;
    };
    // A completed job keeps its Done tag even when a later market refresh
    // failed or the run was skipped. This is the persisted truth, not a report.
    const completedIds = new Set<string>();
    for (const [marketKey, jobs] of Object.entries(jobsByMarket)) {
        const currentReset = extras.resetByMarket?.[marketKey] ?? null;
        for (const job of jobs) {
            if (!isCompletedForMarketReset(completedJobsByMarket, marketKey, job.id, currentReset)) continue;
            const key = setStatusKey(marketKey, job.id, 'done');
            completedIds.add(key);
        }
    }
    if (autoFinishEnabled) {
        for (const market of autoRunMarkets) {
            // Failed markets keep the previous report rows; do not let their
            // stale `skipped`/`pending` entries overwrite a persisted Done.
            const staleMarket = market.stale === true || market.ok === false;
            for (const job of market.jobs ?? []) {
                const key = jobStatusKey(market.marketKey, job.jobId);
                if (completedIds.has(key)) continue;
                if (staleMarket && result[key] === 'done') continue;
                const status = job.code === 'EXPIRED' || job.status === 'expired'
                    ? 'expired'
                    : job.status === 'failed' && extras.unknownByIdentity?.has(key) === true
                        ? 'unknown'
                        : job.status;
                setStatusKey(market.marketKey, job.jobId, status);
            }
        }
    }
    for (const [key, status] of Object.entries(jobRunStatusById)) {
        if (status === undefined) continue;
        // Manual queue status is market-scoped. Legacy jobId-only keys are
        // ignored rather than guessed into a market.
        if (!jobIdentityParts(key)) continue;
        result[key] = status;
    }
    // The Completion Sidecar is authoritative over every in-memory status.
    for (const key of completedIds) result[key] = 'done';
    // Durable Unknown is an independent state and must not be overwritten by
    // an ordinary manual-queue failure. Done remains authoritative.
    for (const key of extras.unknownByIdentity ?? []) {
        if (result[key] === 'done') continue;
        result[key] = 'unknown';
    }
    // Last resort: a claimable row with no report entry still needs a tag.
    for (const [marketKey, jobs] of Object.entries(jobsByMarket)) {
        for (const job of jobs) {
            const key = jobStatusKey(marketKey, job.id);
            if (result[key] !== undefined) continue;
            if (job.alreadyTaken && job.canComplete) setStatusKey(marketKey, job.id, 'ready');
        }
    }
    return result;
}

/** Per-job skip/retry reason used as a tag tooltip. */
export function buildJobReasonById(
    autoFinishEnabled: boolean,
    autoRunMarkets: readonly AutoFinishMarketResult[],
): Record<string, string> {
    const result: Record<string, string> = {};
    if (!autoFinishEnabled) return result;
    for (const market of autoRunMarkets) {
        for (const job of market.jobs ?? []) {
            if (job.error) result[jobStatusKey(market.marketKey, job.jobId)] = job.error;
        }
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
            ...(snapshotMarket?.updatedAt !== undefined ? { updatedAt: snapshotMarket.updatedAt } : {}),
            stale: snapshotMarket?.stale === true,
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

/** Reset countdown per healthy market (or a failed market with a cached reset). */
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
        if (market.ok || market.resetAt) resets[market.marketKey] = market.resetAt ?? null;
    }
    return resets;
}

export interface CompletionCounts {
    readonly marketScoped: number;
    readonly legacyUnknown: number;
}

/** Completion counts keep legacy jobId-only records separate from market data. */
export function countCompletionRecords(
    completedByMarket: MarketCompletedJobsState,
    legacyCompletedJobs: Readonly<Record<string, string>>,
): CompletionCounts {
    const marketScoped = Object.values(completedByMarket.byMarket)
        .reduce((sum, jobs) => sum + Object.keys(jobs).length, 0);
    return { marketScoped, legacyUnknown: Object.keys(legacyCompletedJobs).length };
}
