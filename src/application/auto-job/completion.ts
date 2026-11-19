/**
 * Marker for a completion recorded while the game had not published a reset
 * identity. It is deliberately not an ISO timestamp: a later known reset must
 * not treat it as the same reset.
 */
export const UNKNOWN_RESET = 'unknown';

/**
 * Completion is scoped to a market reset. When the current reset is unknown
 * (`null`), a persisted completion must not be treated as "not completed":
 * re-running an already completed job is worse than waiting for a reset refresh.
 */
export function isCompletedForReset(
    jobId: string,
    completedJobs: Readonly<Record<string, string>>,
    resetAt: string | null,
): boolean {
    const completedReset = completedJobs[jobId];
    if (completedReset === undefined) return false;
    if (resetAt === null) return true;
    return completedReset === resetAt;
}
