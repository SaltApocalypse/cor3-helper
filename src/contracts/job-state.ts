import { z } from 'zod';

/**
 * Local lifecycle of one job within one market reset. This is a record of what
 * the helper attempted; it is not the authoritative game state.
 */
export const JOB_LIFECYCLE_STATUSES = [
    'available',
    'taking',
    'taken',
    'executing',
    'waiting-minigame',
    'ready-to-claim',
    'claiming',
    'completed',
    'failed',
    'expired',
    'blocked',
    'unknown',
] as const;

export type JobLifecycleStatus = typeof JOB_LIFECYCLE_STATUSES[number];

/** Reset identity used by Phase 2A completion records for an unknown reset. */
export const JOB_STATE_UNKNOWN_RESET = 'unknown';

export interface JobStateKey {
    readonly marketKey: string;
    readonly jobId: string;
    readonly resetAt: string | null;
}

export const jobStateRecordSchema = z.object({
    marketKey: z.string().min(1),
    jobId: z.string().min(1),
    /** `null` means the reset was unknown; it never matches a known ISO reset. */
    resetAt: z.string().min(1).nullable(),
    status: z.enum(JOB_LIFECYCLE_STATUSES),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    lastTransitionAt: z.string().min(1),
    errorCode: z.string().optional(),
    lastError: z.string().optional(),
    stage: z.string().optional(),
    /** Complete result was unconfirmed; block automatic re-execution until remote completed. */
    unconfirmed: z.boolean().optional(),
}).strict();

export type JobStateRecord = z.infer<typeof jobStateRecordSchema>;

/**
 * Normalizes the two representations used for an unknown reset (`null` from
 * the network/market layer and `'unknown'` from Phase 2A completions). A known
 * ISO reset is preserved exactly.
 */
export function normalizeJobStateResetAt(resetAt: string | null | undefined): string | null {
    if (resetAt === null || resetAt === undefined) return null;
    if (resetAt === JOB_STATE_UNKNOWN_RESET) return null;
    return resetAt;
}

/** Stable identity string. `null` and `'unknown'` intentionally collapse. */
export function jobStateKeyId(key: JobStateKey): string {
    return JSON.stringify([
        key.marketKey,
        key.jobId,
        normalizeJobStateResetAt(key.resetAt),
    ]);
}

export function sameJobStateKey(a: JobStateKey, b: JobStateKey): boolean {
    return jobStateKeyId(a) === jobStateKeyId(b);
}

/**
 * Identity used for "this execution is active" checks. Reset is intentionally
 * omitted because the live runner/queue progress does not carry it; marketKey +
 * jobId still prevents cross-market collisions.
 */
export function jobActiveKey(marketKey: string, jobId: string): string {
    return JSON.stringify([marketKey, jobId]);
}

/**
 * Conservative classification for records that cannot be proven to be a
 * non-Complete unknown. New records carry `unconfirmed`; legacy records from
 * before B1.6 are inferred from status/errorCode without rewriting them.
 */
export function isCompletionUncertainRecord(record: Pick<JobStateRecord, 'status' | 'errorCode' | 'unconfirmed'>): boolean {
    if (record.unconfirmed === true) return true;
    return record.status === 'unknown'
        && (record.errorCode === 'COMPLETE_FAILED' || record.errorCode === undefined);
}

export function normalizeJobStateRecord(record: JobStateRecord): JobStateRecord {
    const resetAt = normalizeJobStateResetAt(record.resetAt);
    return resetAt === record.resetAt ? record : { ...record, resetAt };
}
