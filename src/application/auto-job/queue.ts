import type { JobOffer } from '../../domains/jobs/model.js';
import { selectJobs } from '../../domains/jobs/model.js';
import type { JobRunPort } from './ports.js';
import type { AutoJobRunError, AutoJobRunResult } from './runner.js';
import type { Result } from '../../kernel/result.js';

export interface AutoJobProgress {
    readonly index: number;
    readonly total: number;
    readonly jobId: string;
    readonly jobName: string;
    /** Market identity is required to distinguish identical job ids across markets. */
    readonly marketKey: string;
    readonly serverName: string | null;
    readonly doneCount: number;
    readonly failedCount: number;
}

export interface AutoJobQueueOptions {
    readonly owner: string;
    readonly completedIds?: ReadonlySet<string>;
    readonly supportedTypes?: ReadonlySet<string>;
    readonly serverPriority: (serverName: string | null, job: JobOffer) => number;
    readonly shouldStop?: () => boolean;
    readonly onProgress?: (progress: AutoJobProgress) => void;
    readonly onJobResult?: (job: JobOffer, result: Result<AutoJobRunResult, AutoJobRunError>) => void;
    /**
     * Small human-like pause between jobs. v1 used 2-3.5 s here; without it the
     * market refreshes and route changes of consecutive jobs arrive back-to-back
     * and can hit the game's action rate limit.
     */
    readonly betweenJobs?: () => Promise<void>;
}

export interface AutoJobQueueFailure {
    readonly job: JobOffer;
    readonly error: AutoJobRunError;
}

export interface AutoJobQueueResult {
    readonly stopped: boolean;
    readonly done: readonly JobOffer[];
    readonly failed: readonly AutoJobQueueFailure[];
}

export class AutoJobQueueService {
    constructor(private readonly runner: JobRunPort) {}

    async run(jobs: readonly JobOffer[], options: AutoJobQueueOptions): Promise<AutoJobQueueResult> {
        const selected = selectJobs(jobs, {
            ...(options.completedIds ? { completedIds: options.completedIds } : {}),
            ...(options.supportedTypes ? { supportedTypes: options.supportedTypes } : {}),
            serverPriority: options.serverPriority,
        });
        const done: JobOffer[] = [];
        const failed: AutoJobQueueFailure[] = [];
        let stopped = false;
        for (let index = 0; index < selected.length; index++) {
            if (options.shouldStop?.()) { stopped = true; break; }
            const job = selected[index]!;
            options.onProgress?.({
                index: index + 1,
                total: selected.length,
                jobId: job.id,
                jobName: job.name,
                marketKey: job.marketKey,
                serverName: job.serverName,
                doneCount: done.length,
                failedCount: failed.length,
            });
            const result = await this.runner.run(job);
            options.onJobResult?.(job, result);
            if (result.ok) done.push(job);
            else failed.push({ job, error: result.error });
            if (options.shouldStop?.()) {
                stopped = true;
                break;
            }
            if (index < selected.length - 1) await options.betweenJobs?.();
        }
        return { stopped, done, failed };
    }
}
