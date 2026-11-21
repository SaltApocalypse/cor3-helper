import { useMemo } from 'preact/hooks';
import type { AutoFinishFailure, AutoFinishMarketResult, AutoFinishUnknownJob } from '../../../contracts/auto-finish.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import type { MarketCompletedJobsState } from '../../../contracts/market-completed-jobs.js';
import type { JobOffer } from '../../../application/popup/catalog.js';
import type { JobMarketView } from '../../components/JobMarketList.js';
import {
    buildJobMarketViews,
    buildJobReasonById,
    buildJobStatusById,
    resolveUnknownJobs,
    selectShownJobReport,
    type JobRunStatus,
    type UiJobReport,
} from '../view-models/job-report.js';

/**
 * Derived job view data shared by the overview and automation pages.
 * The calculations themselves live in `view-models/job-report.ts`.
 */

export interface JobViewsInput {
    readonly autoFinishEnabled: boolean;
    readonly autoRunMarkets: readonly AutoFinishMarketResult[];
    readonly unconfirmedFailures?: readonly AutoFinishFailure[];
    readonly unknownJobs?: readonly AutoFinishUnknownJob[];
    readonly unknownStateStatus?: 'loaded' | 'partial' | 'unavailable';
    readonly completedJobsByMarket: MarketCompletedJobsState;
    readonly jobReport: readonly UiJobReport[];
    readonly autoJobsMarkets: readonly AutoJobsMarket[];
    readonly jobRunStatusById: Readonly<Record<string, JobRunStatus>>;
    readonly jobResetByMarket: Readonly<Record<string, string | null>>;
    readonly jobsByMarket: Readonly<Record<string, readonly JobOffer[]>>;
}

export interface JobViews {
    readonly jobStatusById: Readonly<Record<string, string>>;
    readonly jobReasonById: Readonly<Record<string, string>>;
    readonly jobMarketViews: readonly JobMarketView[];
    readonly shownJobReport: readonly UiJobReport[];
    /** Preserve the source availability internally; no new visual state. */
    readonly unknownStateStatus: 'loaded' | 'partial' | 'unavailable';
}

export function useJobViews(input: JobViewsInput): JobViews {
    const {
        autoFinishEnabled,
        autoRunMarkets,
        unconfirmedFailures = [],
        unknownJobs = [],
        unknownStateStatus = 'unavailable',
        completedJobsByMarket,
        jobReport,
        autoJobsMarkets,
        jobRunStatusById,
        jobResetByMarket,
        jobsByMarket,
    } = input;

    const resolvedUnknown = useMemo(
        () => resolveUnknownJobs({
            unknownJobs,
            unknownStateStatus,
            autoRunMarkets,
            failures: unconfirmedFailures,
            resetByMarket: jobResetByMarket,
        }),
        [unknownJobs, unknownStateStatus, autoRunMarkets, unconfirmedFailures, jobResetByMarket],
    );
    const unknownByIdentity = resolvedUnknown.unknownByIdentity;

    const jobStatusById = useMemo(
        () => buildJobStatusById(autoFinishEnabled, autoRunMarkets, jobRunStatusById, {
            completedJobsByMarket,
            resetByMarket: jobResetByMarket,
            jobsByMarket,
            unknownByIdentity,
        }),
        [autoFinishEnabled, autoRunMarkets, completedJobsByMarket, jobRunStatusById, jobResetByMarket, jobsByMarket, unknownByIdentity],
    );

    const jobReasonById = useMemo(
        () => buildJobReasonById(autoFinishEnabled, autoRunMarkets),
        [autoFinishEnabled, autoRunMarkets],
    );

    const jobMarketViews = useMemo(
        () => buildJobMarketViews({ autoJobsMarkets, autoRunMarkets, jobResetByMarket, jobsByMarket }),
        [autoJobsMarkets, autoRunMarkets, jobResetByMarket, jobsByMarket],
    );

    const shownJobReport = useMemo(
        () => selectShownJobReport({ autoFinishEnabled, autoRunMarkets, jobReport, autoJobsMarkets }),
        [autoFinishEnabled, autoRunMarkets, jobReport, autoJobsMarkets],
    );

    return {
        jobStatusById,
        jobReasonById,
        jobMarketViews,
        shownJobReport,
        unknownStateStatus: resolvedUnknown.status,
    };
}
