import type { JobHistoryEntry, JobHistoryStore } from '../../../infrastructure/storage/job-history-store.js';
import { classifyJobFailure, type JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { AutoFinishFailure } from '../../../contracts/auto-finish.js';
import type { JobOffer } from '../../../domains/jobs/model.js';

export function jobLocation(name: string, serverName: string | null): string {
    return serverName ? `${name} @ ${serverName}` : name;
}

export function jobFailureView(entry: AutoJobQueueFailure) {
    return {
        jobId: entry.job.id,
        name: entry.job.name,
        serverName: entry.job.serverName,
        code: entry.error.detailCode ?? entry.error.code,
        message: entry.error.message,
        ...(entry.error.retryable !== undefined ? { retryable: entry.error.retryable } : {}),
        ...(entry.error.retryAt !== undefined ? { retryAt: entry.error.retryAt } : {}),
        ...(entry.error.lockExpiresAt !== undefined ? { lockExpiresAt: entry.error.lockExpiresAt } : {}),
        ...(entry.error.stage !== undefined ? { stage: entry.error.stage } : {}),
    };
}

export function outcomeInputOf(entry: AutoJobQueueFailure) {
    return {
        code: entry.error.code,
        ...(entry.error.detailCode !== undefined ? { detailCode: entry.error.detailCode } : {}),
        message: entry.error.message,
        ...(entry.error.stage !== undefined ? { stage: entry.error.stage } : {}),
        ...(entry.error.retryable !== undefined ? { retryable: entry.error.retryable } : {}),
        ...(entry.error.retryAt !== undefined ? { retryAt: entry.error.retryAt } : {}),
        ...(entry.error.lockExpiresAt !== undefined ? { lockExpiresAt: entry.error.lockExpiresAt } : {}),
    };
}

export function failureOf(entry: AutoJobQueueFailure): AutoFinishFailure {
    return {
        jobId: entry.job.id,
        name: entry.job.name,
        serverName: entry.job.serverName,
        code: entry.error.detailCode ?? entry.error.code,
        message: entry.error.message,
        ...(entry.error.retryable !== undefined ? { retryable: entry.error.retryable } : {}),
        ...(entry.error.retryAt !== undefined ? { retryAt: entry.error.retryAt } : {}),
        ...(entry.error.lockExpiresAt !== undefined ? { lockExpiresAt: entry.error.lockExpiresAt } : {}),
        ...(entry.error.stage !== undefined ? { stage: entry.error.stage } : {}),
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
        case 'maintenance': return 'Target route is unavailable';
        default: return 'Job was not accepted';
    }
}

export function codeForOutcome(outcome: JobOutcome, fallback: string): string {
    switch (outcome.reason) {
        case 'capability': return 'PREFLIGHT_FAILED';
        case 'cancelled': return 'JOB_CANCELLED';
        case 'no-server': return 'NO_SERVER';
        case 'type-disabled': return 'TYPE_DISABLED';
        case 'expired': return 'EXPIRED';
        case 'unsupported': return 'UNSUPPORTED_JOB_TYPE';
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
