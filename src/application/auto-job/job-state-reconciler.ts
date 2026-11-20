import type { JobLifecycleStatus, JobStateKey, JobStateRecord } from '../../contracts/job-state.js';
import { normalizeJobStateResetAt } from '../../contracts/job-state.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { AutomationLogger } from '../automation/ports.js';
import type { SkippedJob } from './market-mapper.js';
import type { JobStateStorePort } from './job-state-port.js';
import type { JobStateWriterPort } from './job-state-recorder.js';
import { CompletionRecordWriter } from './completion-record.js';
import type { MarketCompletionStorePort } from './market-completion.js';

/** What the game-side market snapshot proves about one job. */
export type RemoteJobObservation =
    | 'taken-claimable'
    | 'taken'
    | 'available'
    | 'completed'
    | 'expired'
    | 'failed'
    | 'absent'
    | 'other';

export type JobReconciliationOutcome =
    | 'unchanged'
    | 'reconciled'
    | 'recoverable'
    | 'pending'
    | 'conflict'
    | 'skipped-active';

export interface ReconcileMarketInput {
    readonly marketKey: string;
    /** Current reset from a successful, non-stale market sync. */
    readonly resetAt: string | null;
    /** Time the market fact was observed (used to reject older snapshots). */
    readonly observedAt?: number;
    readonly jobs: readonly JobOffer[];
    readonly skippedJobs?: readonly SkippedJob[];
}

export type CompletionBridgeStatus =
    | 'written'
    | 'already-recorded'
    | 'reset-mismatch'
    | 'skipped-unknown-reset'
    | 'unavailable'
    | 'failed';

export interface JobReconciliationDecision {
    readonly marketKey: string;
    readonly jobId: string;
    readonly resetAt: string | null;
    readonly previousStatus: JobLifecycleStatus;
    readonly observation: RemoteJobObservation;
    readonly outcome: JobReconciliationOutcome;
    readonly nextStatus?: JobLifecycleStatus;
    readonly recoverable: boolean;
    readonly persisted: boolean;
    readonly reason: string;
    /** Only set when the remote observation is explicit completed. */
    readonly completionStatus?: CompletionBridgeStatus;
    readonly completionError?: string;
}

export interface JobReconciliationResult {
    readonly marketKey: string;
    readonly resetAt: string | null;
    readonly decisions: readonly JobReconciliationDecision[];
    readonly updated: number;
    /** Job ids with explicit game evidence that the existing claim-only path can recover. */
    readonly recoverable: readonly string[];
    readonly pending: number;
    readonly conflicts: number;
    readonly skippedActive: number;
    readonly failedWrites: number;
    readonly completionWrites: number;
    readonly completionFailures: number;
    readonly storeFailed: boolean;
}

export interface JobStateReconcilerPort {
    reconcile(input: ReconcileMarketInput): Promise<JobReconciliationResult>;
}

export interface JobStateReconcilerDeps {
    readonly store: JobStateStorePort;
    readonly writer: JobStateWriterPort;
    readonly logger: Pick<AutomationLogger, 'info' | 'warn'>;
    readonly now?: () => number;
    /** Avoid overwriting a record while that exact market/job is executing in this worker. */
    readonly isActive?: (key: JobStateKey) => boolean;
    /** Shared sidecar store; completed evidence is bridged here. */
    readonly completions?: MarketCompletionStorePort;
}

const PROTECTED_ABSENT_STATUSES: ReadonlySet<JobLifecycleStatus> = new Set([
    'taking',
    'taken',
    'executing',
    'waiting-minigame',
    'ready-to-claim',
    'claiming',
    'unknown',
]);

interface ReconciliationDecision {
    readonly outcome: JobReconciliationOutcome;
    readonly nextStatus?: JobLifecycleStatus;
    readonly recoverable: boolean;
    readonly reason: string;
}

function observationOfSkipped(job: SkippedJob): RemoteJobObservation {
    const status = job.status.toLowerCase();
    if (job.expired === true || status === 'expired' || status.includes('expire')) return 'expired';
    if (status.startsWith('complete') || status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    return 'other';
}

function buildRemoteObservations(input: ReconcileMarketInput): ReadonlyMap<string, RemoteJobObservation> {
    const remote = new Map<string, RemoteJobObservation>();
    for (const job of input.jobs) {
        if (job.marketKey !== input.marketKey) continue;
        remote.set(job.id, job.alreadyTaken
            ? (job.canComplete ? 'taken-claimable' : 'taken')
            : 'available');
    }
    // The active row is more specific than a historical/skipped row.
    for (const job of input.skippedJobs ?? []) {
        if (remote.has(job.id)) continue;
        remote.set(job.id, observationOfSkipped(job));
    }
    return remote;
}

/**
 * Pure decision table. A local status is never used as proof of a remote fact;
 * only the observation chooses the next status. Ambiguous disappearances stay
 * pending instead of becoming failed/expired/completed.
 */
export function decideJobStateReconciliation(
    previousStatus: JobLifecycleStatus,
    observation: RemoteJobObservation,
): ReconciliationDecision {
    if (observation === 'completed') {
        if (previousStatus === 'completed') return { outcome: 'unchanged', recoverable: false, reason: 'already-completed' };
        return { outcome: 'reconciled', nextStatus: 'completed', recoverable: false, reason: 'remote-completed' };
    }
    if (observation === 'expired') {
        if (previousStatus === 'completed') return { outcome: 'conflict', recoverable: false, reason: 'remote-expired-but-locally-completed' };
        if (previousStatus === 'expired') return { outcome: 'unchanged', recoverable: false, reason: 'already-expired' };
        return { outcome: 'reconciled', nextStatus: 'expired', recoverable: false, reason: 'remote-expired' };
    }
    if (observation === 'failed') {
        if (previousStatus === 'completed') return { outcome: 'conflict', recoverable: false, reason: 'remote-failed-but-locally-completed' };
        if (previousStatus === 'failed') return { outcome: 'unchanged', recoverable: false, reason: 'already-failed' };
        return { outcome: 'reconciled', nextStatus: 'failed', recoverable: false, reason: 'remote-failed' };
    }
    if (observation === 'taken-claimable') {
        if (previousStatus === 'completed') return { outcome: 'conflict', recoverable: false, reason: 'remote-claimable-but-locally-completed' };
        if (previousStatus === 'ready-to-claim') return { outcome: 'recoverable', recoverable: true, reason: 'remote-taken-claimable' };
        return { outcome: 'reconciled', nextStatus: 'ready-to-claim', recoverable: true, reason: 'remote-taken-claimable' };
    }
    if (observation === 'taken') {
        if (previousStatus === 'completed') return { outcome: 'conflict', recoverable: false, reason: 'remote-taken-but-locally-completed' };
        if (previousStatus === 'taken' || previousStatus === 'executing') {
            return { outcome: 'unchanged', recoverable: false, reason: 'already-taken' };
        }
        // claiming/unknown are complete-uncertain. A non-claimable taken row is
        // not evidence that the complete request failed, so wait for a later sync.
        if (previousStatus === 'claiming' || previousStatus === 'unknown') {
            return { outcome: 'pending', recoverable: false, reason: 'complete-result-unknown' };
        }
        return { outcome: 'reconciled', nextStatus: 'taken', recoverable: false, reason: 'remote-taken' };
    }
    if (observation === 'available') {
        if (previousStatus === 'completed') return { outcome: 'conflict', recoverable: false, reason: 'remote-open-but-locally-completed' };
        if (previousStatus === 'available') return { outcome: 'unchanged', recoverable: false, reason: 'already-available' };
        // An open row is not proof that an earlier take/complete request never
        // reached the game. Keep protected in-flight states pending rather than
        // asserting `available` and inviting a duplicate request.
        if (PROTECTED_ABSENT_STATUSES.has(previousStatus)) {
            return { outcome: 'pending', recoverable: false, reason: 'remote-open-after-request-uncertain' };
        }
        return { outcome: 'reconciled', nextStatus: 'available', recoverable: false, reason: 'remote-open-not-taken' };
    }
    if (observation === 'absent') {
        if (PROTECTED_ABSENT_STATUSES.has(previousStatus)) {
            return { outcome: 'pending', recoverable: false, reason: 'remote-absent-insufficient-evidence' };
        }
        return { outcome: 'unchanged', recoverable: false, reason: 'remote-absent-terminal-locally' };
    }
    if (PROTECTED_ABSENT_STATUSES.has(previousStatus)) {
        return { outcome: 'pending', recoverable: false, reason: 'remote-status-ambiguous' };
    }
    return { outcome: 'unchanged', recoverable: false, reason: 'remote-status-ambiguous' };
}

function emptyResult(marketKey: string, resetAt: string | null, storeFailed: boolean): JobReconciliationResult {
    return {
        marketKey,
        resetAt,
        decisions: [],
        updated: 0,
        recoverable: [],
        pending: 0,
        conflicts: 0,
        skippedActive: 0,
        failedWrites: 0,
        completionWrites: 0,
        completionFailures: 0,
        storeFailed,
    };
}

/**
 * Read-only with respect to game state: it never sends a command. It only
 * aligns local lifecycle records with explicit facts from one successful
 * market snapshot. Recovery itself remains the existing claim-only path.
 */
export class JobStateReconciler implements JobStateReconcilerPort {
    private readonly now: () => number;

    constructor(private readonly deps: JobStateReconcilerDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    async reconcile(input: ReconcileMarketInput): Promise<JobReconciliationResult> {
        const resetAt = normalizeJobStateResetAt(input.resetAt);
        const observedAt = input.observedAt ?? this.now();
        let records: readonly JobStateRecord[];
        try {
            records = await this.deps.store.list();
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to read job state for reconciliation', {
                marketKey: input.marketKey,
                resetAt,
                message: error instanceof Error ? error.message : String(error),
            });
            return emptyResult(input.marketKey, resetAt, true);
        }

        const local = records.filter((record) =>
            record.marketKey === input.marketKey
            && normalizeJobStateResetAt(record.resetAt) === resetAt,
        );
        if (local.length === 0) return emptyResult(input.marketKey, resetAt, false);

        const remote = buildRemoteObservations(input);
        const decisions: JobReconciliationDecision[] = [];
        let updated = 0;
        let pending = 0;
        let conflicts = 0;
        let skippedActive = 0;
        let failedWrites = 0;
        let completionWrites = 0;
        let completionFailures = 0;
        const recoverable: string[] = [];

        for (const record of local) {
            const observation = remote.get(record.jobId) ?? 'absent';
            const key: JobStateKey = {
                marketKey: record.marketKey,
                jobId: record.jobId,
                resetAt: record.resetAt,
            };
            let active = false;
            try {
                active = this.deps.isActive?.(key) === true;
            } catch (error) {
                // If active detection itself fails, assume active and preserve
                // the local record rather than risking a live execution overwrite.
                this.deps.logger.warn('job-state', 'Active job check failed; keeping lifecycle state', {
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    message: error instanceof Error ? error.message : String(error),
                });
                active = true;
            }
            if (active) {
                skippedActive += 1;
                decisions.push({
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    resetAt: record.resetAt,
                    previousStatus: record.status,
                    observation,
                    outcome: 'skipped-active',
                    recoverable: false,
                    persisted: false,
                    reason: 'job-active',
                });
                continue;
            }
            const localUpdatedAt = Date.parse(record.updatedAt);
            if (Number.isFinite(localUpdatedAt) && localUpdatedAt > observedAt) {
                skippedActive += 1;
                decisions.push({
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    resetAt: record.resetAt,
                    previousStatus: record.status,
                    observation,
                    outcome: 'skipped-active',
                    recoverable: false,
                    persisted: false,
                    reason: 'newer-local-state',
                });
                continue;
            }

            let decision = decideJobStateReconciliation(record.status, observation);
            let completionStatus: CompletionBridgeStatus | undefined;
            let completionError: string | undefined;
            if (observation === 'completed') {
                const bridged = await this.bridgeCompletion(record.marketKey, record.jobId, resetAt);
                completionStatus = bridged.status;
                completionError = bridged.error;
                if (bridged.blocksJobState) {
                    // Never claim Job State completed when the authoritative
                    // completion sidecar could not be updated. A later sync
                    // re-observes the same completed row and retries.
                    decision = {
                        outcome: 'pending',
                        recoverable: false,
                        reason: 'completion-write-failed',
                    };
                    completionFailures += 1;
                } else if (bridged.status === 'written') {
                    completionWrites += 1;
                }
            }
            let persisted = true;
            if (decision.nextStatus !== undefined && decision.nextStatus !== record.status) {
                persisted = await this.deps.writer.update({
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    resetAt: record.resetAt,
                }, decision.nextStatus);
                if (persisted) updated += 1;
                else failedWrites += 1;
            }
            if (decision.outcome === 'pending') pending += 1;
            if (decision.outcome === 'conflict') conflicts += 1;
            const isRecoverable = decision.recoverable && persisted;
            if (isRecoverable) recoverable.push(record.jobId);
            decisions.push({
                marketKey: record.marketKey,
                jobId: record.jobId,
                resetAt: record.resetAt,
                previousStatus: record.status,
                observation,
                ...(decision.nextStatus !== undefined ? { nextStatus: decision.nextStatus } : {}),
                outcome: decision.outcome,
                recoverable: isRecoverable,
                persisted,
                reason: decision.reason,
                ...(completionStatus !== undefined ? { completionStatus } : {}),
                ...(completionError !== undefined ? { completionError } : {}),
            });
        }

        const result: JobReconciliationResult = {
            marketKey: input.marketKey,
            resetAt,
            decisions,
            updated,
            recoverable,
            pending,
            conflicts,
            skippedActive,
            failedWrites,
            completionWrites,
            completionFailures,
            storeFailed: false,
        };
        this.log(input, result);
        return result;
    }

    private async bridgeCompletion(
        marketKey: string,
        jobId: string,
        resetAt: string | null,
    ): Promise<{ readonly status: CompletionBridgeStatus; readonly blocksJobState: boolean; readonly error?: string }> {
        if (!this.deps.completions) {
            // Reconciler tests may omit the sidecar; in production it is wired
            // to the same singleton instance used by Auto Finish.
            return { status: 'unavailable', blocksJobState: false, error: 'completion store not configured' };
        }
        if (resetAt === null) return { status: 'skipped-unknown-reset', blocksJobState: false };

        const writer = new CompletionRecordWriter(this.deps.completions);
        for (let attempt = 0; attempt < 3; attempt++) {
            let state;
            try {
                state = await this.deps.completions.getState();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.deps.logger.warn('job-state', 'Unable to read completion sidecar for reconciliation', {
                    marketKey,
                    jobId,
                    message,
                });
                return { status: 'unavailable', blocksJobState: true, error: message };
            }
            const current = state.byMarket[marketKey]?.[jobId];
            if (current === resetAt) return { status: 'already-recorded', blocksJobState: false };
            let expected: string | null;
            if (current !== undefined) {
                const currentTime = Date.parse(current);
                const nextTime = Date.parse(resetAt);
                if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime) || nextTime < currentTime) {
                    return { status: 'reset-mismatch', blocksJobState: false };
                }
                expected = current;
            } else {
                expected = null;
            }
            const result = await writer.record({
                marketKey,
                jobId,
                resetAt,
                expectedExistingResetAt: expected,
            });
            if (result.ok) return { status: result.value.status, blocksJobState: false };
            if (result.error.code === 'COMPLETION_RESET_MISMATCH' && attempt < 2) {
                // Another writer advanced the record; re-read and judge again.
                continue;
            }
            const blocksJobState = result.error.code === 'COMPLETION_STORE_FAILED';
            this.deps.logger.warn('job-state', 'Completion sidecar bridge failed', {
                marketKey,
                jobId,
                code: result.error.code,
                message: result.error.message,
            });
            return {
                status: blocksJobState ? 'failed' : 'reset-mismatch',
                blocksJobState,
                error: `${result.error.code}: ${result.error.message}`,
            };
        }
        return { status: 'reset-mismatch', blocksJobState: false };
    }

    private log(input: ReconcileMarketInput, result: JobReconciliationResult): void {
        const changed = result.updated + result.pending + result.conflicts + result.skippedActive + result.failedWrites;
        if (changed === 0 && result.recoverable.length === 0) return;
        const data = {
            marketKey: input.marketKey,
            resetKnown: result.resetAt !== null,
            updated: result.updated,
            recoverable: result.recoverable.slice(0, 10),
            pending: result.pending,
            conflicts: result.conflicts,
            skippedActive: result.skippedActive,
            failedWrites: result.failedWrites,
            completionWrites: result.completionWrites,
            completionFailures: result.completionFailures,
        };
        if (result.conflicts > 0 || result.failedWrites > 0 || result.completionFailures > 0) {
            this.deps.logger.warn('job-state', 'Job state reconciliation needs attention', data);
        } else {
            this.deps.logger.info('job-state', 'Job state reconciliation applied', data);
        }
    }
}
