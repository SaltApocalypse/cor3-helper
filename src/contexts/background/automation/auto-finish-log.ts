import type { AutoFinishFailure } from '../../../contracts/auto-finish.js';
import type { JobOutcome } from '../../../application/auto-job/outcome.js';
import type { AutoJobQueueFailure } from '../../../application/auto-job/queue.js';
import type { AutomationLogger, RunLogSink } from '../../../application/automation/ports.js';
import type { JobLockRegistry } from './job-locks.js';
import { failureOf, jobLocation, outcomeReasonText } from './job-outcome.js';

export interface FinishLogDeps {
    readonly runId: string;
    readonly failures: readonly AutoFinishFailure[];
    readonly retryEntries: readonly AutoJobQueueFailure[];
    readonly effectiveFailed: readonly AutoJobQueueFailure[];
    readonly outcomes: ReadonlyMap<string, JobOutcome>;
    readonly locks: JobLockRegistry;
    readonly runLogs: RunLogSink;
    readonly logger: AutomationLogger;
}

/** Emits the per-job failure/retry/skip/expiry lines for one Auto Finish run. */
export function logAutoFinishJobs(deps: FinishLogDeps): void {
    for (const failure of deps.failures) {
        deps.runLogs.add(deps.runId, 'warn', 'auto-jobs', `${jobLocation(failure.name, failure.serverName)}: ${failure.code} — ${failure.message}${failure.stage ? ` (${failure.stage})` : ''}`, failure);
        deps.logger.warn('auto-jobs', `Job failed: ${jobLocation(failure.name, failure.serverName)} — ${failure.code}: ${failure.message}${failure.stage ? ` (${failure.stage})` : ''}`, {
            jobId: failure.jobId,
            code: failure.code,
            message: failure.message,
            ...(failure.stage ? { stage: failure.stage } : {}),
        });
    }
    for (const entry of deps.retryEntries) {
        const failure = failureOf(entry);
        const exhausted = deps.locks.isRetryExhausted(entry.job.id);
        deps.runLogs.add(deps.runId, exhausted ? 'warn' : 'info', 'auto-jobs', `${jobLocation(failure.name, failure.serverName)}: ${exhausted ? 'retry paused (budget exhausted)' : 'retrying'} — ${failure.code}: ${failure.message}${failure.stage ? ` (${failure.stage})` : ''}`, {
            ...failure,
            attempt: deps.locks.retryAttempt(entry.job.id)?.count ?? null,
            exhausted,
        });
    }
    for (const entry of deps.effectiveFailed) {
        const outcome = deps.outcomes.get(entry.job.id);
        if (outcome?.status === 'skipped') {
            deps.runLogs.add(deps.runId, 'info', 'auto-jobs', `Skipped ${jobLocation(entry.job.name, entry.job.serverName)}: ${outcomeReasonText(outcome)} (${outcome.reason})`, {
                jobId: entry.job.id,
                reason: outcome.reason,
                message: entry.error.message,
            });
        }
    }
    for (const entry of deps.effectiveFailed) {
        const outcome = deps.outcomes.get(entry.job.id);
        if (outcome?.status === 'expired') {
            deps.runLogs.add(deps.runId, 'info', 'auto-jobs', `Expired ${jobLocation(entry.job.name, entry.job.serverName)}: ${entry.error.message}`, {
                jobId: entry.job.id,
                reason: outcome.reason,
            });
        }
    }
}
