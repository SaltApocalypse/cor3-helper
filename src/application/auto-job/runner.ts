import { isServerlessJob, type JobOffer } from '../../domains/jobs/model.js';
import type { GameError } from '../game/ports.js';
import type { Result } from '../../kernel/result.js';

export interface JobReward {
    readonly credits: number;
    readonly reputation: number;
    readonly renown: number;
}

export interface JobExecutionPort {
    execute(job: JobOffer): Promise<Result<JobReward, GameError>>;
}

export interface AutoJobRunResult {
    readonly route: readonly { readonly id: string; readonly name: string }[];
    readonly reward: JobReward;
}

export interface AutoJobRunError {
    readonly code: 'NO_SERVER' | 'SNAPSHOT_FAILED' | 'ROUTE_FAILED' | 'PREFLIGHT_FAILED' | 'JOB_CANCELLED' | 'JOB_FAILED';
    /** The underlying JobExecutionError code before runner-level mapping. */
    readonly detailCode?: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly retryAt?: number;
    readonly lockExpiresAt?: number;
    readonly stage?: string;
}

/**
 * Orchestrates a single job. Network sequencing lives in JobExecutionService:
 * market route -> take -> target route/access -> job actions -> market route -> complete.
 */
export class AutoJobRunner {
    constructor(
        private readonly jobs: JobExecutionPort,
    ) {}

    async run(job: JobOffer): Promise<Result<AutoJobRunResult, AutoJobRunError>> {
        if (!(job.alreadyTaken && job.canComplete) && !job.serverId && !isServerlessJob(job.type)) {
            return { ok: false, error: { code: 'NO_SERVER', message: 'Job has no target server' } };
        }
        const result = await this.jobs.execute(job);
        if (!result.ok) {
            return {
                ok: false,
                error: {
                    code: result.error.code === 'PREFLIGHT_FAILED'
                        ? 'PREFLIGHT_FAILED'
                        : result.error.code === 'JOB_CANCELLED' ? 'JOB_CANCELLED' : 'JOB_FAILED',
                    detailCode: result.error.code,
                    message: result.error.message,
                    ...(result.error.retryable !== undefined ? { retryable: result.error.retryable } : {}),
                    ...(result.error.retryAt !== undefined ? { retryAt: result.error.retryAt } : {}),
                    ...(result.error.lockExpiresAt !== undefined ? { lockExpiresAt: result.error.lockExpiresAt } : {}),
                    ...(result.error.stage !== undefined ? { stage: result.error.stage } : {}),
                },
            };
        }
        return {
            ok: true,
            value: {
                route: [],
                reward: result.value,
            },
        };
    }
}
