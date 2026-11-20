import type { Result } from '../../kernel/result.js';
import { err, ok } from '../../kernel/result.js';
import { UNKNOWN_RESET } from './completion.js';
import type { MarketCompletionStorePort } from './market-completion.js';

export interface CompletionRecordIdentity {
    readonly marketKey: string;
    readonly jobId: string;
    /** Known reset only; null/unknown is rejected rather than guessed. */
    readonly resetAt: string | null;
    /**
     * Optional compare-and-set guard for reset advancement.
     * undefined: only write when absent.
     * null: explicitly expect no existing record.
     * string: replace only when the same reset is currently stored.
     */
    readonly expectedExistingResetAt?: string | null;
}

export interface CompletionWriteResult {
    readonly status: 'written' | 'already-recorded';
    readonly marketKey: string;
    readonly jobId: string;
    readonly resetAt: string;
    readonly previousResetAt?: string;
    /** This store is market-scoped, unlike the legacy completedJobs map. */
    readonly identityScope: 'market-key';
}

export type CompletionWriteErrorCode =
    | 'COMPLETION_IDENTITY_INCOMPLETE'
    | 'COMPLETION_RESET_MISMATCH'
    | 'COMPLETION_STORE_FAILED';

export interface CompletionWriteError {
    readonly code: CompletionWriteErrorCode;
    readonly message: string;
    /** Present for a reset mismatch; never used to overwrite the old record. */
    readonly existingResetAt?: string;
}

function nonEmpty(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function expectedResetAt(value: string | null | undefined): { readonly ok: true; readonly value: string | null | undefined } | { readonly ok: false } {
    if (value === undefined) return { ok: true, value: undefined };
    if (value === null) return { ok: true, value: null };
    const normalized = nonEmpty(value);
    if (!normalized || normalized === UNKNOWN_RESET) return { ok: false };
    return { ok: true, value: normalized };
}

/**
 * Writes one market-scoped completion without clearing other markets/jobs.
 * Reset advancement is only possible with an explicit compare-and-set guard.
 */
export class CompletionRecordWriter {
    constructor(private readonly store: MarketCompletionStorePort) {}

    async record(identity: CompletionRecordIdentity): Promise<Result<CompletionWriteResult, CompletionWriteError>> {
        const marketKey = nonEmpty(identity.marketKey);
        const jobId = nonEmpty(identity.jobId);
        const resetAt = nonEmpty(identity.resetAt);
        const expected = expectedResetAt(identity.expectedExistingResetAt);
        if (!marketKey || !jobId || !resetAt || resetAt === UNKNOWN_RESET || !expected.ok) {
            return err({
                code: 'COMPLETION_IDENTITY_INCOMPLETE',
                message: 'A known market, job id and reset are required to record a completion',
            });
        }

        try {
            const outcome = await this.store.recordCompletion({
                marketKey,
                jobId,
                resetAt,
                ...(expected.value !== undefined ? { expectedExistingResetAt: expected.value } : {}),
            });
            if (outcome.status === 'reset-mismatch') {
                return err({
                    code: 'COMPLETION_RESET_MISMATCH',
                    message: `Job ${jobId} already has a completion for a different reset`,
                    ...(outcome.existingResetAt !== undefined ? { existingResetAt: outcome.existingResetAt } : {}),
                });
            }
            return ok({
                status: outcome.status,
                marketKey,
                jobId,
                resetAt,
                ...(outcome.status === 'written' && outcome.previousResetAt !== undefined
                    ? { previousResetAt: outcome.previousResetAt }
                    : {}),
                identityScope: 'market-key',
            });
        } catch (error) {
            return err({
                code: 'COMPLETION_STORE_FAILED',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
