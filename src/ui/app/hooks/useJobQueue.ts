import { useCallback, useRef, useState } from 'preact/hooks';
import type { JobQueueProgress, PopupPortal } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import { classifyJobQueueResult } from '../view-models/job-report.js';
import type { JobsState } from './useJobs.js';
import { usePolling } from './usePolling.js';

/**
 * Manual job queue run (H8 phase 7).
 *
 * All queue state lives in {@link JobsState}; this hook only drives the run and
 * the 1 s progress poll.
 */

export interface JobQueueDeps {
    readonly tt: TranslateSource;
    readonly jobs: JobsState;
}

export interface JobQueueState {
    readonly runSelectedJobs: () => Promise<void>;
    readonly cancelJobQueue: () => Promise<void>;
    readonly applyQueueProgress: (progress: JobQueueProgress) => void;
}

export function useJobQueue(portal: PopupPortal, deps: JobQueueDeps): JobQueueState {
    const { tt, jobs } = deps;
    const [queuePolling, setQueuePolling] = useState(false);
    const queuePollingRef = useRef(false);
    const setQueuePollingActive = useCallback((active: boolean) => {
        queuePollingRef.current = active;
        setQueuePolling(active);
    }, []);

    const applyQueueProgress = useCallback((progress: JobQueueProgress) => {
        jobs.setJobProgress(progress);
        jobs.setJobRunStatusById((current) => ({ ...current, [progress.jobId]: 'running' }));
    }, [jobs.setJobProgress, jobs.setJobRunStatusById]);

    const pollQueueProgress = useCallback(async () => {
        const runId = jobs.jobRunId;
        if (!queuePollingRef.current || runId === null) return;
        const progress = await portal.jobQueueProgress(runId);
        if (!queuePollingRef.current) return;
        if (progress.ok && progress.value) {
            const runningProgress = progress.value.progress;
            jobs.setJobProgress(runningProgress);
            if (runningProgress) {
                jobs.setJobRunStatusById((current) => ({ ...current, [runningProgress.jobId]: 'running' }));
            }
            if (progress.value.status !== 'running') setQueuePollingActive(false);
        }
    }, [portal, jobs.jobRunId, jobs.setJobProgress, jobs.setJobRunStatusById, setQueuePollingActive]);

    // The progress poll has no visibility gate: a run started from the panel
    // keeps reporting while the panel is hidden, as before.
    usePolling(pollQueueProgress, 1000, { enabled: queuePolling, pauseWhenHidden: false });

    const runSelectedJobs = useCallback(async () => {
        const selected = jobs.jobs.filter((job) => job.marketKey === jobs.marketKey && jobs.selectedJobs.has(job.id));
        if (selected.length === 0) {
            jobs.setJobStatus(tt('Select at least one job in the current market'));
            return;
        }
        const runId = crypto.randomUUID();
        jobs.setJobRunId(runId);
        jobs.setJobBusy(true);
        jobs.setJobProgress(null);
        jobs.setJobRunStatusById(Object.fromEntries(selected.map((job) => [job.id, 'pending' as const])));
        jobs.setJobStatus(tt('Running {count} job(s)...', { count: selected.length }));
        setQueuePollingActive(true);
        const response = await portal.runJobQueue(selected, runId);
        setQueuePollingActive(false);
        if (response.ok) {
            const outcome = classifyJobQueueResult(selected, response.value);
            jobs.setJobStatus(response.value.stopped ? tt('Job run stopped.') : tt('Job run complete.'));
            jobs.setJobReport(outcome.report);
            jobs.setJobRunStatusById((current) => ({ ...current, ...outcome.statuses }));
            jobs.setSelectedJobs((current) => {
                const next = new Set(current);
                for (const id of response.value.done) next.delete(id);
                return next;
            });
        } else {
            jobs.setJobRunStatusById((current) => {
                const next = { ...current };
                for (const job of selected) next[job.id] = 'failed';
                return next;
            });
            jobs.setJobStatus(response.error.message);
        }
        jobs.setJobRunId(null);
        jobs.setJobBusy(false);
        void jobs.loadJobHistory();
    }, [portal, jobs, tt, setQueuePollingActive]);

    const cancelJobQueue = useCallback(async () => {
        const runId = jobs.jobRunId;
        if (!runId) return;
        const response = await portal.cancelJobQueue(runId);
        jobs.setJobStatus(response.ok ? tt('Cancellation requested') : response.error.message);
    }, [portal, jobs.jobRunId, jobs.setJobStatus, tt]);

    return { runSelectedJobs, cancelJobQueue, applyQueueProgress };
}
