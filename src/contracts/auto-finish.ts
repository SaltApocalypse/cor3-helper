import { z } from 'zod';

export const autoFinishJobSchema = z.object({
    jobId: z.string(),
    name: z.string(),
    serverName: z.string().nullable(),
    marketKey: z.string(),
    status: z.enum(['done', 'failed', 'pending', 'running', 'skipped', 'retry', 'expired']),
    rewardCredits: z.number().optional(),
    rewardReputation: z.number().optional(),
    error: z.string().optional(),
    code: z.string().optional(),
    retryable: z.boolean().optional(),
    retryAt: z.number().optional(),
    lockExpiresAt: z.number().optional(),
    retryExhausted: z.boolean().optional(),
    stage: z.string().optional(),
}).strict();

export const autoFinishFailureSchema = z.object({
    jobId: z.string(),
    name: z.string(),
    serverName: z.string().nullable(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    retryAt: z.number().optional(),
    lockExpiresAt: z.number().optional(),
    stage: z.string().optional(),
    unconfirmed: z.boolean().optional(),
}).strict();

export const autoFinishMarketSchema = z.object({
    marketKey: z.string(),
    label: z.string(),
    ok: z.boolean(),
    skipped: z.number().int().nonnegative(),
    retry: z.number().int().nonnegative().optional(),
    expired: z.number().int().nonnegative().optional(),
    resetAt: z.string().nullable().optional(),
    jobTotal: z.number().int().nonnegative().optional(),
    success: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    pending: z.number().int().nonnegative().optional(),
    jobs: z.array(autoFinishJobSchema).optional(),
    /** Last successful refresh for this market (ms). */
    updatedAt: z.number().int().nonnegative().optional(),
    /** True when the market could not be refreshed and the row is carried over. */
    stale: z.boolean().optional(),
    error: z.string().optional(),
}).strict();

export const autoFinishLastRunSchema = z.object({
    runId: z.string(),
    finishedAt: z.number(),
    jobs: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    retry: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
    expired: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative(),
    stopped: z.boolean(),
    markets: z.array(autoFinishMarketSchema),
    failures: z.array(autoFinishFailureSchema).default([]),
}).strict();

export const autoFinishStateSchema = z.object({
    last: autoFinishLastRunSchema.nullable(),
    completedResets: z.record(z.string(), z.string()).default({}),
    /**
     * Job id -> the market reset it was completed for. This is deliberately
     * job-level: a market can gain new jobs inside the same reset, and those
     * must not be skipped as "already completed".
     */
    completedJobs: z.record(z.string(), z.string()).default({}),
}).strict();

export const autoFinishRunResultSchema = z.object({
    jobs: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    retry: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
    expired: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative(),
    stopped: z.boolean(),
    markets: z.array(autoFinishMarketSchema),
    failures: z.array(autoFinishFailureSchema).default([]),
}).strict();

export type AutoFinishJobResult = z.infer<typeof autoFinishJobSchema>;
export type AutoFinishFailure = z.infer<typeof autoFinishFailureSchema>;
export type AutoFinishMarketResult = z.infer<typeof autoFinishMarketSchema>;
export type AutoFinishLastRun = z.infer<typeof autoFinishLastRunSchema>;
export type AutoFinishState = z.infer<typeof autoFinishStateSchema>;
export type AutoFinishRunResult = z.infer<typeof autoFinishRunResultSchema>;
