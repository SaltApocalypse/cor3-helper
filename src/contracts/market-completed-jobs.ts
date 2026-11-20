import { z } from 'zod';
import { JOB_STATE_UNKNOWN_RESET } from './job-state.js';

/**
 * Market-scoped job completion records. This is deliberately separate from the
 * legacy `completedJobs` map, which has no market identity and must not be
 * migrated or used as evidence here.
 *
 * `byMarket[marketKey][jobId] = resetAt`
 */
export const marketCompletedJobsSchema = z.object({
    byMarket: z.record(
        z.string(),
        z.record(z.string(), z.string()),
    ).default({}),
    /**
     * Durable fallback barrier when the Job State write fails. Value is the
     * execution reset or 'unknown'. Optional so existing sidecars stay valid.
     */
    unconfirmedByMarket: z.record(
        z.string(),
        z.record(z.string(), z.string()),
    ).optional(),
}).strict();

export type MarketCompletedJobsState = z.infer<typeof marketCompletedJobsSchema>;

export const EMPTY_MARKET_COMPLETED_JOBS: MarketCompletedJobsState = { byMarket: {} };

/** `'unknown'` and `null` both mean the reset is not known. */
export function normalizeMarketCompletionResetAt(resetAt: string | null | undefined): string | null {
    if (resetAt === null || resetAt === undefined) return null;
    return resetAt === JOB_STATE_UNKNOWN_RESET ? null : resetAt;
}
