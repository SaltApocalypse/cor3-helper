import { z } from 'zod';
import type { JobOffer } from './jobs.js';
import { jobOfferSchema } from './jobs.js';

export const autoJobsSkippedJobSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    serverName: z.string().nullable(),
    status: z.string(),
    reason: z.string(),
    expired: z.boolean().optional(),
    reputationPenalty: z.number().nonnegative().default(0),
    deposit: z.number().nonnegative().default(0),
    jobType: z.string().optional(),
}).strict();

export const autoJobsMarketSchema = z.object({
    marketKey: z.string().min(1),
    label: z.string().min(1),
    ok: z.boolean(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative().default(0),
    expired: z.number().int().nonnegative().default(0),
    skippedJobs: z.array(autoJobsSkippedJobSchema).default([]),
    resetAt: z.string().nullable().optional(),
    /** Last successful refresh for this market (ms). Preserved while offline. */
    updatedAt: z.number().int().nonnegative().optional(),
    /** True when the market could not be refreshed and the row is carried over. */
    stale: z.boolean().optional(),
    /** Health of the optional lifecycle reconciliation for this market. */
    reconciliationStatus: z.enum(['loaded', 'partial', 'unavailable']).optional(),
    error: z.string().optional(),
    errorCode: z.string().optional(),
}).strict();

export const autoJobsSnapshotSchema = z.object({
    at: z.number().int().nonnegative(),
    jobs: z.array(jobOfferSchema),
    markets: z.array(autoJobsMarketSchema),
}).strict();

export const autoJobsScheduleStateSchema = z.enum([
    'scheduled',
    'repair-pending',
    'repairing',
    'schedule-unavailable',
    'disabled',
]);

/** Background Auto Jobs status returned by `auto-jobs.status`. */
export const autoJobsStatusSchema = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    running: z.boolean(),
    stage: z.string().default('idle'),
    nextRefreshAt: z.number().nullable(),
    refreshReason: z.enum(['interval', 'reset', 'fallback']),
    scheduleState: autoJobsScheduleStateSchema,
    repairAt: z.number().nullable(),
    lastRefreshAt: z.number().nullable(),
    snapshotAt: z.number().nullable().default(null),
    locks: z.record(z.string(), z.number()).default({}),
    retryAttempts: z.record(z.string(), z.object({
        count: z.number().int().nonnegative(),
        lastAttemptAt: z.number(),
    }).strict()).default({}),
}).strict();

export interface AutoJobsSkippedJob {
    readonly id: string;
    readonly name: string;
    readonly serverName: string | null;
    readonly status: string;
    readonly reason: string;
    readonly expired?: boolean | undefined;
    readonly reputationPenalty?: number;
    readonly deposit?: number;
    readonly jobType?: string | undefined;
}

export interface AutoJobsMarket {
    readonly marketKey: string;
    readonly label: string;
    readonly ok: boolean;
    readonly skipped: number;
    readonly failed?: number;
    readonly expired?: number;
    readonly skippedJobs?: readonly AutoJobsSkippedJob[];
    readonly resetAt?: string | null;
    readonly updatedAt?: number;
    readonly stale?: boolean;
    readonly reconciliationStatus?: 'loaded' | 'partial' | 'unavailable';
    readonly error?: string;
    readonly errorCode?: string;
}

export interface AutoJobsSnapshot {
    readonly at: number;
    readonly jobs: readonly JobOffer[];
    readonly markets: readonly AutoJobsMarket[];
}
