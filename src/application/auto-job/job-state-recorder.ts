import type { JobOffer } from '../../domains/jobs/model.js';
import {
    JOB_STATE_UNKNOWN_RESET,
    jobStateKeyId,
    normalizeJobStateResetAt,
    type JobLifecycleStatus,
    type JobStateKey,
    type JobStateRecord,
} from '../../contracts/job-state.js';
import type { JobStateStorePort } from './job-state-port.js';
import type { AutomationLogger } from '../automation/ports.js';

export interface JobStateTransitionDetails {
    readonly errorCode?: string;
    readonly message?: string;
    readonly stage?: string;
}

export interface JobStateSession {
    readonly key: JobStateKey;
    transition(status: JobLifecycleStatus, details?: JobStateTransitionDetails): Promise<void>;
}

export interface JobStateRecorderPort {
    start(job: JobOffer): Promise<JobStateSession>;
}

export interface JobStateRecorderDeps {
    readonly store: JobStateStorePort;
    readonly logger: Pick<AutomationLogger, 'warn'>;
    readonly now?: () => number;
    /** Resolves the currently known market reset without making it authoritative. */
    readonly resetAtForMarket?: (marketKey: string) => string | null;
}

const MAX_ERROR_TEXT = 300;

function iso(now: number): string {
    return new Date(now).toISOString();
}

/** Avoid persisting bearer tokens/JWTs in a lifecycle record. */
function safeErrorText(input: string): string {
    return input
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
        .slice(0, MAX_ERROR_TEXT);
}

class JobStateSessionImpl implements JobStateSession {
    private createdAt: string;
    private chain: Promise<void> = Promise.resolve();

    constructor(
        private readonly deps: JobStateRecorderDeps,
        readonly key: JobStateKey,
        createdAt: string,
        private readonly now: () => number,
    ) {
        this.createdAt = createdAt;
    }

    transition(status: JobLifecycleStatus, details: JobStateTransitionDetails = {}): Promise<void> {
        const run = async (): Promise<void> => {
            const at = iso(this.now());
            const record: JobStateRecord = {
                marketKey: this.key.marketKey,
                jobId: this.key.jobId,
                resetAt: this.key.resetAt,
                status,
                createdAt: this.createdAt,
                updatedAt: at,
                lastTransitionAt: at,
                ...(details.errorCode ? { errorCode: details.errorCode } : {}),
                ...(details.message ? { lastError: safeErrorText(details.message) } : {}),
                ...(details.stage ? { stage: details.stage } : {}),
            };
            try {
                await this.deps.store.upsert(record);
                this.createdAt = record.createdAt;
            } catch (error) {
                this.deps.logger.warn('job-state', 'Failed to persist job lifecycle transition', {
                    jobId: this.key.jobId,
                    marketKey: this.key.marketKey,
                    resetAt: this.key.resetAt,
                    status,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
        this.chain = this.chain.then(run, run);
        return this.chain;
    }
}

/**
 * Records local job lifecycle transitions for later reconciliation. Recording
 * is observational: a storage failure is logged and never blocks the job.
 */
export class JobStateRecorder implements JobStateRecorderPort {
    private readonly now: () => number;

    constructor(private readonly deps: JobStateRecorderDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    async start(job: JobOffer): Promise<JobStateSession> {
        const resetAt = normalizeJobStateResetAt(this.deps.resetAtForMarket?.(job.marketKey) ?? null);
        const key: JobStateKey = { marketKey: job.marketKey, jobId: job.id, resetAt };
        let existing: JobStateRecord | null = null;
        try {
            existing = await this.deps.store.get(key);
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to read job lifecycle state', {
                jobId: job.id,
                marketKey: job.marketKey,
                resetAt,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        return new JobStateSessionImpl(this.deps, key, existing?.createdAt ?? iso(this.now()), this.now);
    }

    async prune(maxAgeMs?: number): Promise<number> {
        try {
            return await this.deps.store.prune({
                now: this.now(),
                ...(maxAgeMs !== undefined ? { maxAgeMs } : {}),
            });
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to prune job lifecycle state', {
                message: error instanceof Error ? error.message : String(error),
            });
            return 0;
        }
    }

    /** Exposed for diagnostics/reconciliation without exposing the store itself. */
    keyId(key: JobStateKey): string {
        return jobStateKeyId(key);
    }
}

export { JOB_STATE_UNKNOWN_RESET };
