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
    readonly unconfirmed?: boolean;
}

export interface JobStateSession {
    readonly key: JobStateKey;
    transition(status: JobLifecycleStatus, details?: JobStateTransitionDetails): Promise<void>;
}

export interface JobStateRecorderPort {
    /** Optional reset override captured once before execution starts. */
    start(job: JobOffer, resetAtOverride?: string | null): Promise<JobStateSession>;
}

/** Narrow write port used by reconciliation; not used by the execution path. */
export interface JobStateWriterPort {
    /**
     * Updates a record by exact identity. Returns false when persistence failed,
     * so a reconciler never reports a successful recovery after a failed write.
     */
    update(key: JobStateKey, status: JobLifecycleStatus, details?: JobStateTransitionDetails): Promise<boolean>;
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
                ...(details.unconfirmed === true ? { unconfirmed: true } : {}),
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
                // An unconfirmed completion must not silently lose its durable
                // barrier. The execution layer falls back to the completion
                // store and fails closed if both writes fail.
                if (details.unconfirmed === true) throw error;
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
export class JobStateRecorder implements JobStateRecorderPort, JobStateWriterPort {
    private readonly now: () => number;

    constructor(private readonly deps: JobStateRecorderDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    private async existingFor(key: JobStateKey): Promise<JobStateRecord | null> {
        try {
            return await this.deps.store.get(key);
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to read job lifecycle state', {
                jobId: key.jobId,
                marketKey: key.marketKey,
                resetAt: key.resetAt,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async start(job: JobOffer, resetAtOverride?: string | null): Promise<JobStateSession> {
        const resetAt = normalizeJobStateResetAt(
            resetAtOverride !== undefined
                ? resetAtOverride
                : this.deps.resetAtForMarket?.(job.marketKey) ?? null,
        );
        const key: JobStateKey = { marketKey: job.marketKey, jobId: job.id, resetAt };
        const existing = await this.existingFor(key);
        return new JobStateSessionImpl(this.deps, key, existing?.createdAt ?? iso(this.now()), this.now);
    }

    async update(key: JobStateKey, status: JobLifecycleStatus, details: JobStateTransitionDetails = {}): Promise<boolean> {
        const normalized: JobStateKey = { ...key, resetAt: normalizeJobStateResetAt(key.resetAt) };
        const existing = await this.existingFor(normalized);
        const at = iso(this.now());
        const record: JobStateRecord = {
            marketKey: normalized.marketKey,
            jobId: normalized.jobId,
            resetAt: normalized.resetAt,
            status,
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
            lastTransitionAt: at,
            ...(details.errorCode ? { errorCode: details.errorCode } : {}),
            ...(details.message ? { lastError: safeErrorText(details.message) } : {}),
            ...(details.stage ? { stage: details.stage } : {}),
            ...(details.unconfirmed === true ? { unconfirmed: true } : {}),
        };
        try {
            await this.deps.store.upsert(record);
            return true;
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to persist reconciled job lifecycle transition', {
                jobId: normalized.jobId,
                marketKey: normalized.marketKey,
                resetAt: normalized.resetAt,
                status,
                message: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
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
