export interface AutoFinishRunOptions {
    /** Reload every market regardless of the local freshness TTL. */
    readonly forceRefresh?: boolean;
    /** Allow retrying failed/locked jobs by clearing their retry state. */
    readonly retryFailed?: boolean;
    /** Reset retry counts and cooldowns without touching completed records. */
    readonly resetRetryBudget?: boolean;
    /**
     * Explicit destructive operation: clear completedResets/completedJobs as
     * well as retry state. Never implied by forceRefresh.
     */
    readonly clearLocalState?: boolean;
}

export interface AutoFinishRunState {
    readonly completedResets: Readonly<Record<string, string>>;
    readonly completedJobs: Readonly<Record<string, string>>;
    readonly clearAttempts: boolean;
    readonly clearLocks: boolean;
}

/** A force refresh ignores a prefetched snapshot and reloads market data. */
export function shouldUsePrefetched(
    options: AutoFinishRunOptions,
    prefetched: unknown,
): boolean {
    return prefetched !== undefined && options.forceRefresh !== true;
}

/**
 * Resolves the durable state a run starts from.
 *
 * A force refresh only reloads market data. It must never erase completion
 * records: doing so made Force Run re-execute jobs that were already completed
 * in the current market reset.
 */
export function resolveAutoFinishRunState(
    options: AutoFinishRunOptions,
    stored: {
        readonly completedResets: Readonly<Record<string, string>>;
        readonly completedJobs: Readonly<Record<string, string>>;
    },
): AutoFinishRunState {
    const destructive = options.clearLocalState === true;
    const resetRetry = options.retryFailed === true
        || options.resetRetryBudget === true
        || destructive;
    return {
        completedResets: destructive ? {} : stored.completedResets,
        completedJobs: destructive ? {} : stored.completedJobs,
        clearAttempts: resetRetry,
        clearLocks: resetRetry,
    };
}
