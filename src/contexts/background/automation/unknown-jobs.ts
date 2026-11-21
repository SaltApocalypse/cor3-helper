import {
    isCompletionUncertainRecord,
    JOB_STATE_UNKNOWN_RESET,
    jobStateKeyId,
    normalizeJobStateResetAt,
} from '../../../contracts/job-state.js';
import type { AutoFinishUnknownJob } from '../../../contracts/auto-finish.js';
import type { JobStateListResult, JobStateStorePort } from '../../../application/auto-job/job-state-port.js';
import type { MarketCompletionStateReadResult, MarketCompletionStorePort } from '../../../application/auto-job/market-completion.js';

export type UnknownProjectionStatus = 'loaded' | 'partial' | 'unavailable';

export interface UnknownProjection {
    readonly jobs: readonly AutoFinishUnknownJob[];
    readonly status: UnknownProjectionStatus;
}

export interface UnknownProjectionDeps {
    readonly jobStates?: Pick<JobStateStorePort, 'listWithHealth'> | undefined;
    readonly completions?: Pick<MarketCompletionStorePort, 'getStateWithHealth'> | undefined;
    readonly logger?: {
        warn(scope: string, message: string, data?: unknown): void;
    } | undefined;
}

type JobStateSourceStatus = JobStateListResult['status'];
type CompletionSourceStatus = 'ok' | 'missing' | 'corrupt' | 'unavailable';

/**
 * Missing completion data is a trusted empty store, but it cannot by itself
 * compensate for an unreadable Job State source. Only actual completion data
 * (`ok`) can turn a Job State failure into `partial`.
 */
function overallStatus(jobState: JobStateSourceStatus, completion: CompletionSourceStatus): UnknownProjectionStatus {
    if (jobState === 'unavailable') return completion === 'ok' ? 'partial' : 'unavailable';
    if (jobState === 'partial') return 'partial';
    return completion === 'ok' || completion === 'missing' ? 'loaded' : 'partial';
}

/**
 * Projects durable Complete-Unknown evidence from Job State and the
 * Completion Store fallback. Each source is read with its health API; a
 * successful partial shard keeps its records, while corrupt/unavailable data is
 * never converted into an empty, healthy result.
 */
export async function projectUnknownJobs(deps: UnknownProjectionDeps): Promise<UnknownProjection> {
    let jobStateStatus: JobStateSourceStatus = 'unavailable';
    let completionStatus: CompletionSourceStatus = 'unavailable';
    const jobs = new Map<string, AutoFinishUnknownJob>();

    const add = (marketKey: string, jobId: string, resetAt: string | null): void => {
        const normalizedReset = normalizeJobStateResetAt(resetAt);
        const key = jobStateKeyId({ marketKey, jobId, resetAt: normalizedReset });
        if (jobs.has(key)) return;
        jobs.set(key, { marketKey, jobId, resetAt: normalizedReset });
    };

    const listWithHealth = deps.jobStates?.listWithHealth;
    if (listWithHealth) {
        try {
            const result = await listWithHealth.call(deps.jobStates);
            jobStateStatus = result.status;
            for (const record of result.records) {
                if (record.status === 'completed' || !isCompletionUncertainRecord(record)) continue;
                add(record.marketKey, record.jobId, record.resetAt);
            }
            if (result.status === 'partial' || result.status === 'unavailable') {
                deps.logger?.warn('auto-finish', 'Job State Unknown projection is incomplete', {
                    status: result.status,
                    readableShards: result.shardResults.filter((shard) => shard.status === 'ok' || shard.status === 'missing').length,
                    totalShards: result.shardResults.length,
                });
            }
        } catch (error) {
            jobStateStatus = 'unavailable';
            deps.logger?.warn('auto-finish', 'Unable to read Job State for Unknown projection', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const getStateWithHealth = deps.completions?.getStateWithHealth;
    if (getStateWithHealth) {
        try {
            const result: MarketCompletionStateReadResult = await getStateWithHealth.call(deps.completions);
            completionStatus = result.status;
            if (result.status === 'ok') {
                const barriers = result.value.unconfirmedByMarket ?? {};
                for (const [marketKey, jobsByJob] of Object.entries(barriers)) {
                    for (const [jobId, resetAt] of Object.entries(jobsByJob)) {
                        add(marketKey, jobId, resetAt === JOB_STATE_UNKNOWN_RESET ? null : resetAt);
                    }
                }
            } else if (result.status === 'corrupt' || result.status === 'unavailable') {
                deps.logger?.warn('auto-finish', 'Completion Store Unknown projection is unavailable', {
                    status: result.status,
                });
            }
        } catch (error) {
            completionStatus = 'unavailable';
            deps.logger?.warn('auto-finish', 'Unable to read completion fallback for Unknown projection', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return {
        jobs: [...jobs.values()],
        status: overallStatus(jobStateStatus, completionStatus),
    };
}
