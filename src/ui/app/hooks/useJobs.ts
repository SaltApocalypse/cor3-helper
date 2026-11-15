import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { jobMarketByKey, type JobOffer } from '../../../application/popup/catalog.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import type { JobHistoryEntry, JobQueueProgress, PopupPortal } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { groupJobsByMarket, resetAtByMarket, type JobRunStatus, type UiJobReport } from '../view-models/job-report.js';
import { usePolling } from './usePolling.js';

/**
 * Job market list, snapshot, selection, history and run state (H8 phase 7).
 *
 * The queue actions live in `useJobQueue`; this hook owns the state both hooks
 * and the Auto Finish hook share.
 */

export interface JobsDeps {
    readonly tt: TranslateSource;
    readonly activePage: PopupPage;
}

export interface JobsState {
    readonly marketKey: string;
    readonly setMarketKey: (key: string) => void;
    readonly jobs: readonly JobOffer[];
    readonly jobsByMarket: Readonly<Record<string, readonly JobOffer[]>>;
    readonly autoJobsMarkets: readonly AutoJobsMarket[];
    readonly jobResetByMarket: Readonly<Record<string, string | null>>;
    readonly marketReport: readonly AutoJobsMarket[] | null;
    readonly selectedJobs: ReadonlySet<string>;
    readonly setSelectedJobs: (update: ReadonlySet<string> | ((current: ReadonlySet<string>) => ReadonlySet<string>)) => void;
    readonly jobStatus: string;
    readonly setJobStatus: (update: string | ((current: string) => string)) => void;
    readonly jobBusy: boolean;
    readonly setJobBusy: (busy: boolean) => void;
    readonly jobRunId: string | null;
    readonly setJobRunId: (runId: string | null) => void;
    readonly jobReport: readonly UiJobReport[];
    readonly setJobReport: (report: readonly UiJobReport[]) => void;
    readonly jobRunStatusById: Readonly<Record<string, JobRunStatus>>;
    readonly setJobRunStatusById: (update: Readonly<Record<string, JobRunStatus>> | ((current: Readonly<Record<string, JobRunStatus>>) => Readonly<Record<string, JobRunStatus>>)) => void;
    readonly jobProgress: JobQueueProgress | null;
    readonly setJobProgress: (progress: JobQueueProgress | null) => void;
    readonly jobHistory: readonly JobHistoryEntry[];
    readonly currentMarketSelectedCount: number;
    readonly syncJobs: (allMarkets: boolean) => Promise<void>;
    readonly loadJobHistory: () => Promise<void>;
    readonly loadAutoJobsSnapshot: () => Promise<void>;
    readonly toggleJob: (jobId: string) => void;
    readonly toggleSelectMarket: (marketJobs: readonly JobOffer[]) => void;
}

export function useJobs(portal: PopupPortal, deps: JobsDeps): JobsState {
    const { tt, activePage } = deps;
    const [marketKey, setMarketKey] = useState('home');
    const [jobs, setJobs] = useState<readonly JobOffer[]>([]);
    const [jobsByMarket, setJobsByMarket] = useState<Readonly<Record<string, readonly JobOffer[]>>>({});
    const [autoJobsMarkets, setAutoJobsMarkets] = useState<readonly AutoJobsMarket[]>([]);
    const [jobResetByMarket, setJobResetByMarket] = useState<Readonly<Record<string, string | null>>>({});
    const [jobHistory, setJobHistory] = useState<readonly JobHistoryEntry[]>([]);
    const [selectedJobs, setSelectedJobs] = useState<ReadonlySet<string>>(new Set());
    const jobsSelectionInitialized = useRef(false);
    const [marketReport, setMarketReport] = useState<readonly AutoJobsMarket[] | null>(null);
    const [jobStatus, setJobStatus] = useState('No market synced yet');
    const [jobBusy, setJobBusy] = useState(false);
    const [jobRunId, setJobRunId] = useState<string | null>(null);
    const [jobReport, setJobReport] = useState<readonly UiJobReport[]>([]);
    const [jobRunStatusById, setJobRunStatusById] = useState<Readonly<Record<string, JobRunStatus>>>({});
    const [jobProgress, setJobProgress] = useState<JobQueueProgress | null>(null);

    const currentMarketSelectedCount = (jobsByMarket[marketKey] ?? []).filter((job) => selectedJobs.has(job.id)).length;

    const syncJobs = useCallback(async (allMarkets: boolean) => {
        setJobBusy(true);
        setJobStatus(allMarkets ? tt('Syncing all markets...') : tt('Syncing selected market...'));
        if (allMarkets) {
            const response = await portal.syncAllJobs();
            if (response.ok) {
                setJobs(response.value.jobs);
                setJobsByMarket(groupJobsByMarket(response.value.jobs));
                setJobResetByMarket(resetAtByMarket(response.value.markets));
                setJobRunStatusById({});
                setSelectedJobs(new Set(response.value.jobs.map((job) => job.id)));
                setMarketReport(response.value.markets);
                setJobStatus(tt('Synced {jobs} job(s) across {markets} market(s)', { jobs: response.value.jobs.length, markets: response.value.markets.length }));
            } else {
                setJobStatus(tt('Market refresh failed'));
            }
        } else {
            const market = jobMarketByKey(marketKey);
            if (!market) {
                setJobStatus(tt('Unknown market: {market}', { market: marketKey }));
                setJobBusy(false);
                return;
            }
            const response = await portal.syncJobs(market);
            if (response.ok) {
                setJobs(response.value.jobs);
                setJobsByMarket((current) => ({ ...current, [marketKey]: response.value.jobs }));
                setJobResetByMarket((current) => ({ ...current, [marketKey]: response.value.resetAt }));
                setJobRunStatusById({});
                setSelectedJobs(new Set(response.value.jobs.map((job) => job.id)));
                setMarketReport(null);
                setJobStatus(tt('Synced {jobs} job(s) from {market}; skipped {skipped}', { jobs: response.value.jobs.length, market: market.label, skipped: response.value.skipped }));
            } else {
                setJobStatus(tt('Market refresh failed'));
            }
        }
        setJobBusy(false);
    }, [portal, marketKey, tt]);

    const loadJobHistory = useCallback(async () => {
        const response = await portal.jobHistory();
        if (response.ok) setJobHistory(response.value);
    }, [portal]);

    const loadAutoJobsSnapshot = useCallback(async () => {
        if (jobRunId !== null) return;
        const response = await portal.autoJobsSnapshot();
        if (!response.ok) {
            setJobStatus(tt('Auto Jobs snapshot failed'));
            return;
        }
        if (!response.value) return;
        const snapshot = response.value;
        setJobs(snapshot.jobs);
        setJobsByMarket(groupJobsByMarket(snapshot.jobs));
        setAutoJobsMarkets(snapshot.markets);
        setJobResetByMarket(resetAtByMarket(snapshot.markets));
        setMarketReport(snapshot.markets);
        setSelectedJobs((current) => {
            if (!jobsSelectionInitialized.current) {
                jobsSelectionInitialized.current = true;
                return new Set(snapshot.jobs.map((job) => job.id));
            }
            const available = new Set(snapshot.jobs.map((job) => job.id));
            return new Set([...current].filter((id) => available.has(id)));
        });
        setJobStatus((current) => current === tt('No market synced yet')
            ? tt('Ready sync: {jobs} job(s) across {markets} market(s)', { jobs: snapshot.jobs.length, markets: snapshot.markets.filter((market) => market.ok).length })
            : current);
    }, [portal, jobRunId, tt]);

    const toggleJob = useCallback((jobId: string) => {
        setSelectedJobs((current) => {
            const next = new Set(current);
            if (next.has(jobId)) next.delete(jobId);
            else next.add(jobId);
            return next;
        });
    }, []);

    const toggleSelectMarket = useCallback((marketJobs: readonly JobOffer[]) => {
        setSelectedJobs((current) => {
            const next = new Set(current);
            const allSelected = marketJobs.length > 0 && marketJobs.every((job) => next.has(job.id));
            for (const job of marketJobs) {
                if (allSelected) next.delete(job.id);
                else next.add(job.id);
            }
            return next;
        });
    }, []);

    useEffect(() => {
        void loadAutoJobsSnapshot();
    }, [loadAutoJobsSnapshot]);

    useEffect(() => {
        if (activePage !== 'overview' && activePage !== 'progress') return;
        void loadJobHistory();
    }, [activePage, loadJobHistory]);

    // The overview tracks live job status; the automation page shows the
    // editable market list. Other pages do not need a 5 s snapshot poll.
    usePolling(loadAutoJobsSnapshot, 5000, {
        enabled: jobRunId === null && (activePage === 'overview' || activePage === 'automation'),
    });

    return {
        marketKey,
        setMarketKey,
        jobs,
        jobsByMarket,
        autoJobsMarkets,
        jobResetByMarket,
        marketReport,
        selectedJobs,
        setSelectedJobs,
        jobStatus,
        setJobStatus,
        jobBusy,
        setJobBusy,
        jobRunId,
        setJobRunId,
        jobReport,
        setJobReport,
        jobRunStatusById,
        setJobRunStatusById,
        jobProgress,
        setJobProgress,
        jobHistory,
        currentMarketSelectedCount,
        syncJobs,
        loadJobHistory,
        loadAutoJobsSnapshot,
        toggleJob,
        toggleSelectMarket,
    };
}
