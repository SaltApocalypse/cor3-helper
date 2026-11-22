import type { MarketCompletedJobsState } from '../../contracts/market-completed-jobs.js';
import { normalizeMarketCompletionResetAt } from '../../contracts/market-completed-jobs.js';
import type { StorageReadResult } from '../../contracts/storage-health.js';

export type MarketCompletionStateReadResult = StorageReadResult<MarketCompletedJobsState>;

export interface MarketCompletionWriteInput {
    readonly marketKey: string;
    readonly jobId: string;
    readonly resetAt: string;
    /**
     * undefined: only write when absent; existing different reset is a mismatch.
     * null: explicitly expect no existing record.
     * string: replace only when this exact reset is currently stored.
     */
    readonly expectedExistingResetAt?: string | null;
}

export type MarketCompletionStoreOutcome =
    | { readonly status: 'written'; readonly previousResetAt?: string }
    | { readonly status: 'already-recorded' }
    | { readonly status: 'reset-mismatch'; readonly existingResetAt?: string };

export type MarketCompletionPruneOutcome =
    | { readonly status: 'pruned'; readonly removed: number; readonly state: MarketCompletedJobsState }
    | { readonly status: 'skipped'; readonly reason: 'unknown-reset' | 'invalid-reset'; readonly state: MarketCompletedJobsState };

/** Atomic write/query port for the sidecar market-scoped completion store. */
export interface MarketCompletionStorePort {
    recordCompletion(input: MarketCompletionWriteInput): Promise<MarketCompletionStoreOutcome>;
    getCompletion(marketKey: string, jobId: string): Promise<string | null>;
    getState(): Promise<MarketCompletedJobsState>;
    /**
     * One complete read for both `byMarket` and `unconfirmedByMarket`, so their
     * health can never disagree. `missing` is a normal empty store.
     */
    getStateWithHealth?(): Promise<MarketCompletionStateReadResult>;
    clear(): Promise<void>;
    /** Remove only records in this market whose stored reset is older than currentResetAt. */
    pruneMarketBeforeReset(marketKey: string, currentResetAt: string): Promise<MarketCompletionPruneOutcome>;
    /** Optional durable fallback barrier used when Job State cannot persist. */
    getUnconfirmedState?(): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>>;
    /**
     * Removes one durable fallback barrier without recording a completion.
     * Used only after a remote row proves the reward is still claimable.
     */
    clearUnconfirmed?(input: {
        readonly marketKey: string;
        readonly jobId: string;
        readonly resetAt: string | null;
    }): Promise<void>;
    markUnconfirmed?(input: {
        readonly marketKey: string;
        readonly jobId: string;
        readonly resetAt: string | null;
    }): Promise<void>;
}

function nonEmpty(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pure market-scoped query. Legacy jobId-only records are intentionally not
 * accepted here: they cannot be attributed to a market.
 */
export function isCompletedForMarketReset(
    completed: MarketCompletedJobsState,
    marketKey: string,
    jobId: string,
    resetAt: string | null,
): boolean {
    const market = nonEmpty(marketKey);
    const job = nonEmpty(jobId);
    if (!market || !job) return false;
    const stored = completed.byMarket[market]?.[job];
    if (stored === undefined) return false;
    const normalized = normalizeMarketCompletionResetAt(resetAt);
    // Unknown current reset: keep suppressing an already recorded job rather
    // than risking a duplicate completion. A known reset must match exactly.
    if (normalized === null) return true;
    return stored === normalized;
}

/** Async query facade over the sidecar store. */
export class MarketCompletionReader {
    constructor(private readonly store: Pick<MarketCompletionStorePort, 'getCompletion'>) {}

    async isCompletedForMarketReset(
        marketKey: string,
        jobId: string,
        resetAt: string | null,
    ): Promise<boolean> {
        const market = nonEmpty(marketKey);
        const job = nonEmpty(jobId);
        if (!market || !job) return false;
        const stored = await this.store.getCompletion(market, job);
        if (stored === null) return false;
        const normalized = normalizeMarketCompletionResetAt(resetAt);
        if (normalized === null) return true;
        return stored === normalized;
    }
}
