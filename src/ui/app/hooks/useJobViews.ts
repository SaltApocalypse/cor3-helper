import { useMemo } from 'preact/hooks';
import type { AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import type { JobOffer } from '../../../application/popup/catalog.js';
import type { JobMarketView } from '../../components/JobMarketList.js';
import {
    buildJobMarketViews,
    buildJobReasonById,
    buildJobStatusById,
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
    readonly completedJobs: Readonly<Record<string, string>>;
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
}

export function useJobViews(input: JobViewsInput): JobViews {
    const {
        autoFinishEnabled,
        autoRunMarkets,
        completedJobs,
        jobReport,
        autoJobsMarkets,
        jobRunStatusById,
        jobResetByMarket,
        jobsByMarket,
    } = input;

    const jobStatusById = useMemo(
        () => buildJobStatusById(autoFinishEnabled, autoRunMarkets, jobRunStatusById, {
            completedJobs,
            resetByMarket: jobResetByMarket,
            jobsByMarket,
        }),
        [autoFinishEnabled, autoRunMarkets, completedJobs, jobRunStatusById, jobResetByMarket, jobsByMarket],
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

    return { jobStatusById, jobReasonById, jobMarketViews, shownJobReport };
}
