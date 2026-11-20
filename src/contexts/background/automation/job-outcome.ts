import type { JobHistoryEntry, JobHistoryStore } from '../../../infrastructure/storage/job-history-store.js';
import { classifyJobFailure, type JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { AutoFinishFailure } from '../../../contracts/auto-finish.js';
import type { JobOffer } from '../../../domains/jobs/model.js';

export function jobLocation(name: string, serverName: string | null): string {
    return serverName ? `${name} @ ${serverName}` : name;
}

function errorOf(entry: AutoJobQueueFailure) {
    return entry.error ?? { code: 'JOB_FAILED', message: 'Job failed without error details' };
}

export function jobFailureView(entry: AutoJobQueueFailure) {
    const error = errorOf(entry);
    return {
        jobId: entry.job.id,
        name: entry.job.name,
        serverName: entry.job.serverName,
        code: error.detailCode ?? error.code,
        message: error.message,
        ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
        ...(error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
        ...(error.lockExpiresAt !== undefined ? { lockExpiresAt: error.lockExpiresAt } : {}),
        ...(error.stage !== undefined ? { stage: error.stage } : {}),
        ...(error.unconfirmed === true ? { unconfirmed: true } : {}),
    };
}

export function outcomeInputOf(entry: AutoJobQueueFailure) {
    const error = errorOf(entry);
    return {
        code: error.code,
        ...(error.detailCode !== undefined ? { detailCode: error.detailCode } : {}),
        message: error.message,
        ...(error.stage !== undefined ? { stage: error.stage } : {}),
        ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
        ...(error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
        ...(error.lockExpiresAt !== undefined ? { lockExpiresAt: error.lockExpiresAt } : {}),
        ...(error.unconfirmed === true ? { unconfirmed: true } : {}),
    };
}

export function failureOf(entry: AutoJobQueueFailure): AutoFinishFailure {
    const error = errorOf(entry);
    return {
        jobId: entry.job.id,
        name: entry.job.name,
        serverName: entry.job.serverName,
        code: error.detailCode ?? error.code,
        message: error.message,
        ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
        ...(error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
        ...(error.lockExpiresAt !== undefined ? { lockExpiresAt: error.lockExpiresAt } : {}),
        ...(error.stage !== undefined ? { stage: error.stage } : {}),
        ...(error.unconfirmed === true ? { unconfirmed: true } : {}),
    };
}

export function outcomeReasonText(outcome: JobOutcome): string {
    switch (outcome.reason) {
        case 'capability': return 'Missing capability for this job';
        case 'cancelled': return 'Job run cancelled';
        case 'no-server': return 'No target server for this job';
        case 'type-disabled': return 'Job type disabled for auto completion';
        case 'expired': return 'Job expired before completion';
        case 'unsupported': return 'Job type is not supported yet';
        case 'minigame-lock': return 'Minigame is locked';
        case 'minigame-disabled': return 'Minigame solver is disabled';
        case 'maintenance': return 'Target route is unavailable';
        default: return 'Job was not accepted';
    }
}

/** Infrastructure and game-lock failures retry on a timer, not a job budget. */
export function countsAgainstRetryBudget(outcome: JobOutcome): boolean {
    return outcome.reason !== 'network'
        && outcome.reason !== 'maintenance'
        && outcome.reason !== 'minigame-lock';
}

export function codeForOutcome(outcome: JobOutcome, fallback: string): string {
    switch (outcome.reason) {
        case 'capability': return 'PREFLIGHT_FAILED';
        case 'cancelled': return 'JOB_CANCELLED';
        case 'no-server': return 'NO_SERVER';
        case 'type-disabled': return 'TYPE_DISABLED';
        case 'expired': return 'EXPIRED';
        case 'unsupported': return 'UNSUPPORTED_JOB_TYPE';
        case 'minigame-disabled': return 'MINIGAME_DISABLED';
        default: return fallback;
    }
}

export class JobHistoryRecorder {
    constructor(private readonly store: JobHistoryStore) {}

    async record(done: readonly JobOffer[], failed: readonly AutoJobQueueFailure[], retry: readonly AutoJobQueueFailure[] = []): Promise<void> {
        const at = Date.now();
        const entries: JobHistoryEntry[] = [
            ...done.map((job) => ({
                jobId: job.id,
                name: job.name,
                type: job.type,
                serverName: job.serverName,
                status: 'done' as const,
                at,
            })),
            ...failed.map((entry) => ({
                jobId: entry.job.id,
                name: entry.job.name,
                type: entry.job.type,
                serverName: entry.job.serverName,
                status: 'failed' as const,
                at,
                error: entry.error.message,
            })),
            ...retry.map((entry) => ({
                jobId: entry.job.id,
                name: entry.job.name,
                type: entry.job.type,
                serverName: entry.job.serverName,
                status: 'retry' as const,
                at,
                error: entry.error.message,
            })),
        ];
        await this.store.append(entries);
    }
}

export { classifyJobFailure };
