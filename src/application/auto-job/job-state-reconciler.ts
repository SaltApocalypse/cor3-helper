import type { JobLifecycleStatus, JobStateKey, JobStateRecord } from '../../contracts/job-state.js';
import { isCompletionUncertainRecord, JOB_STATE_UNKNOWN_RESET, normalizeJobStateResetAt } from '../../contracts/job-state.js';
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
    /** True whenever any required source was not fully trustworthy. */
    readonly storeFailed: boolean;
    /**
     * `loaded` means every required source was read completely and the
     * reconciliation may be treated as a complete success. `partial` keeps
     * successful diagnostic data but must not authorize completion/cleanup.
     */
    readonly storeStatus: 'loaded' | 'partial' | 'unavailable';
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

/**
 * How long an unconfirmed Complete must remain unresolved before a remote
 * claimable row may release it for one more claim-only attempt. This keeps the
 * safety barrier for genuinely ambiguous results without stranding a job until
 * the market reset.
 */
const CLAIMABLE_RECOVERY_COOLDOWN_MS = 15 * 60_000;

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
    completionUnconfirmed = false,
    allowClaimableRecovery = false,
): ReconciliationDecision {
    // A Complete whose result was never confirmed cannot be cleared by the job
    // merely still existing (taken/claimable/available/absent). Only explicit
    // completed evidence may release the barrier; expired/failed remain terminal.
    if (completionUnconfirmed && observation !== 'completed' && observation !== 'expired' && observation !== 'failed') {
        // A claimable row proves the reward is still unclaimed. After a cooling
        // period, allow the existing claim-only path one more attempt instead of
        // stranding the job until the market reset.
        if (observation === 'taken-claimable' && allowClaimableRecovery) {
            return { outcome: 'recoverable', nextStatus: 'ready-to-claim', recoverable: true, reason: 'remote-claimable-recovery' };
        }
        return { outcome: 'pending', recoverable: false, reason: 'complete-result-unknown' };
    }
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

function emptyResult(
    marketKey: string,
    resetAt: string | null,
    storeStatus: JobReconciliationResult['storeStatus'],
): JobReconciliationResult {
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
        storeFailed: storeStatus !== 'loaded',
        storeStatus,
    };
}

/** Result used when the reconciler itself could not run safely. */
export function unavailableReconciliationResult(marketKey: string, resetAt: string | null): JobReconciliationResult {
    return emptyResult(marketKey, resetAt, 'unavailable');
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
        const jobState = await this.readJobStateHealth();
        if (jobState.status !== 'loaded') {
            this.deps.logger.warn('job-state', 'Job state is incomplete for reconciliation; keeping local state', {
                marketKey: input.marketKey,
                resetAt,
                status: jobState.status,
            });
            return emptyResult(input.marketKey, resetAt, jobState.status);
        }
        const records = jobState.records;

        const local = records.filter((record) =>
            record.marketKey === input.marketKey
            && normalizeJobStateResetAt(record.resetAt) === resetAt,
        );
        const nullUncertain = resetAt === null
            ? []
            : records.filter((record) =>
                record.marketKey === input.marketKey
                && normalizeJobStateResetAt(record.resetAt) === null
                && isCompletionUncertainRecord(record),
            );
        const completion = await this.readCompletionBarriers(resetAt);
        if (completion.status === 'corrupt' || completion.status === 'unavailable') {
            this.deps.logger.warn('job-state', 'Completion Store is incomplete for reconciliation; keeping local state', {
                marketKey: input.marketKey,
                resetAt,
                status: completion.status,
            });
            return emptyResult(input.marketKey, resetAt, 'partial');
        }
        const completionBarriers = completion.barriers;
        const marketBarriers = completionBarriers[input.marketKey] ?? {};
        if (local.length === 0 && nullUncertain.length === 0 && Object.keys(marketBarriers).length === 0) {
            return emptyResult(input.marketKey, resetAt, 'loaded');
        }

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

            const recordUpdatedAt = Date.parse(record.updatedAt);
            const recoveryCooledDown = Number.isFinite(recordUpdatedAt)
                && this.now() - recordUpdatedAt >= CLAIMABLE_RECOVERY_COOLDOWN_MS;
            let decision = decideJobStateReconciliation(
                record.status,
                observation,
                isCompletionUncertainRecord(record),
                recoveryCooledDown,
            );
            let completionStatus: CompletionBridgeStatus | undefined;
            let completionError: string | undefined;
            if (decision.reason === 'remote-claimable-recovery') {
                const cleared = await this.clearFallbackBarrier(record.marketKey, record.jobId, resetAt);
                if (!cleared) {
                    decision = { outcome: 'pending', recoverable: false, reason: 'completion-barrier-clear-failed' };
                }
            }
            if (observation === 'completed') {
                const bridged = await this.bridgeCompletion(record.marketKey, record.jobId, resetAt);
                completionStatus = bridged.status;
                completionError = bridged.error;
                if (bridged.blocksJobState
                    || (bridged.status !== 'written' && bridged.status !== 'already-recorded')) {
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

        if (resetAt !== null) {
            const currentJobIds = new Set(local.map((record) => record.jobId));
            for (const record of nullUncertain) {
                if (currentJobIds.has(record.jobId)) continue;
                const observation = remote.get(record.jobId) ?? 'absent';
                // A null-reset record is never migrated because the job merely
                // still exists. Only explicit completed evidence for the
                // current, validated market/reset can establish a sidecar.
                if (observation !== 'completed') continue;

                const bridged = await this.bridgeCompletion(record.marketKey, record.jobId, resetAt);
                const completionStatus = bridged.status;
                const completionError = bridged.error;
                if (bridged.blocksJobState
                    || (bridged.status !== 'written' && bridged.status !== 'already-recorded')) {
                    pending += 1;
                    completionFailures += 1;
                    decisions.push({
                        marketKey: record.marketKey,
                        jobId: record.jobId,
                        resetAt: null,
                        previousStatus: record.status,
                        observation,
                        outcome: 'pending',
                        recoverable: false,
                        persisted: false,
                        reason: 'null-reset-completion-write-failed',
                        completionStatus,
                        ...(completionError !== undefined ? { completionError } : {}),
                    });
                    continue;
                }

                if (bridged.status === 'written') completionWrites += 1;
                const persisted = await this.deps.writer.update({
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    resetAt: null,
                }, 'completed');
                if (persisted) updated += 1;
                else failedWrites += 1;
                decisions.push({
                    marketKey: record.marketKey,
                    jobId: record.jobId,
                    resetAt: null,
                    previousStatus: record.status,
                    observation,
                    outcome: persisted ? 'reconciled' : 'pending',
                    ...(persisted ? { nextStatus: 'completed' as const } : {}),
                    recoverable: false,
                    persisted,
                    reason: 'null-reset-remote-completed',
                    completionStatus,
                    ...(completionError !== undefined ? { completionError } : {}),
                });
            }
        }

        if (resetAt !== null) {
            const handledJobIds = new Set([...local, ...nullUncertain].map((record) => record.jobId));
            for (const [jobId, barrierReset] of Object.entries(marketBarriers)) {
                    // Known-reset fallbacks are released only for that exact
                    // reset. Identity-less legacy fallbacks can be released by
                    // explicit completed evidence for the current, validated
                    // reset; merely seeing a different reset never releases it.
                    const matchesReset = barrierReset === resetAt || barrierReset === JOB_STATE_UNKNOWN_RESET;
                    if (!matchesReset || handledJobIds.has(jobId)) continue;
                    const observation = remote.get(jobId) ?? 'absent';
                    if (observation !== 'completed') continue;
                    const bridged = await this.bridgeCompletion(input.marketKey, jobId, resetAt);
                    const completionStatus = bridged.status;
                    const completionError = bridged.error;
                    if (bridged.blocksJobState
                        || (bridged.status !== 'written' && bridged.status !== 'already-recorded')) {
                        pending += 1;
                        completionFailures += 1;
                        decisions.push({
                            marketKey: input.marketKey,
                            jobId,
                            resetAt,
                            previousStatus: 'unknown',
                            observation,
                            outcome: 'pending',
                            recoverable: false,
                            persisted: false,
                            reason: 'barrier-completion-write-failed',
                            completionStatus,
                            ...(completionError !== undefined ? { completionError } : {}),
                        });
                        continue;
                    }
                    if (bridged.status === 'written') completionWrites += 1;
                    const persisted = await this.deps.writer.update({
                        marketKey: input.marketKey,
                        jobId,
                        resetAt,
                    }, 'completed');
                    if (persisted) updated += 1;
                    else failedWrites += 1;
                    decisions.push({
                        marketKey: input.marketKey,
                        jobId,
                        resetAt,
                        previousStatus: 'unknown',
                        observation,
                        outcome: persisted ? 'reconciled' : 'pending',
                        ...(persisted ? { nextStatus: 'completed' as const } : {}),
                        recoverable: false,
                        persisted,
                        reason: 'barrier-remote-completed',
                        completionStatus,
                        ...(completionError !== undefined ? { completionError } : {}),
                    });
                }
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
            storeStatus: 'loaded',
        };
        this.log(input, result);
        return result;
    }

    private async readJobStateHealth(): Promise<{
        readonly records: readonly JobStateRecord[];
        readonly status: JobReconciliationResult['storeStatus'];
    }> {
        const listWithHealth = this.deps.store.listWithHealth;
        if (!listWithHealth) return { records: [], status: 'unavailable' };
        try {
            const result = await listWithHealth.call(this.deps.store);
            return { records: result.records, status: result.status };
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to read job state health for reconciliation', {
                message: error instanceof Error ? error.message : String(error),
            });
            return { records: [], status: 'unavailable' };
        }
    }

    private async readCompletionBarriers(resetAt: string | null): Promise<{
        readonly status: 'ok' | 'missing' | 'corrupt' | 'unavailable';
        readonly barriers: Readonly<Record<string, Readonly<Record<string, string>>>>;
    }> {
        // A null/unknown reset cannot bridge or clear completion evidence, so
        // the sidecar is not a required source for that reconciliation.
        if (resetAt === null || !this.deps.completions) return { status: 'missing', barriers: {} };
        const getStateWithHealth = this.deps.completions.getStateWithHealth;
        if (!getStateWithHealth) return { status: 'unavailable', barriers: {} };
        try {
            const result = await getStateWithHealth.call(this.deps.completions);
            if (result.status === 'ok') {
                return { status: 'ok', barriers: result.value.unconfirmedByMarket ?? {} };
            }
            if (result.status === 'missing') return { status: 'missing', barriers: {} };
            return { status: result.status, barriers: {} };
        } catch (error) {
            this.deps.logger.warn('job-state', 'Unable to read completion barriers for reconciliation', {
                message: error instanceof Error ? error.message : String(error),
            });
            return { status: 'unavailable', barriers: {} };
        }
    }

    /**
     * Removes a completion-store fallback barrier before releasing a claimable
     * recovery. Test doubles without the optional port are treated as clear.
     */
    private async clearFallbackBarrier(
        marketKey: string,
        jobId: string,
        resetAt: string | null,
    ): Promise<boolean> {
        const clear = this.deps.completions?.clearUnconfirmed;
        if (!clear) return true;
        try {
            await clear.call(this.deps.completions, { marketKey, jobId, resetAt });
            return true;
        } catch (error) {
            this.deps.logger.warn('job-state', 'Failed to clear completion fallback barrier', {
                marketKey,
                jobId,
                message: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
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
        if (resetAt === null || !Number.isFinite(Date.parse(resetAt))) {
            return { status: 'skipped-unknown-reset', blocksJobState: false };
        }

        const writer = new CompletionRecordWriter(this.deps.completions);
        for (let attempt = 0; attempt < 3; attempt++) {
            let state;
            if (this.deps.completions.getStateWithHealth) {
                let read;
                try {
                    read = await this.deps.completions.getStateWithHealth.call(this.deps.completions);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.deps.logger.warn('job-state', 'Unable to read completion sidecar health for reconciliation', {
                        marketKey,
                        jobId,
                        message,
                    });
                    return { status: 'unavailable', blocksJobState: true, error: message };
                }
                if (read.status === 'corrupt' || read.status === 'unavailable') {
                    this.deps.logger.warn('job-state', 'Completion sidecar is not trustworthy for reconciliation', {
                        marketKey,
                        jobId,
                        status: read.status,
                    });
                    return { status: 'unavailable', blocksJobState: true, error: `completion store is ${read.status}` };
                }
                state = read.status === 'ok' ? read.value : { byMarket: {} };
            } else {
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
            }
            const current = state.byMarket[marketKey]?.[jobId];
            let expected: string | null;
            if (current !== undefined) {
                if (current !== resetAt) {
                    const currentTime = Date.parse(current);
                    const nextTime = Date.parse(resetAt);
                    if (!Number.isFinite(currentTime) || !Number.isFinite(nextTime) || nextTime < currentTime) {
                        return { status: 'reset-mismatch', blocksJobState: false };
                    }
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
            storeStatus: result.storeStatus,
        };
        if (result.conflicts > 0 || result.failedWrites > 0 || result.completionFailures > 0) {
            this.deps.logger.warn('job-state', 'Job state reconciliation needs attention', data);
        } else {
            this.deps.logger.info('job-state', 'Job state reconciliation applied', data);
        }
    }
}
