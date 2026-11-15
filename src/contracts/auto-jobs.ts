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
    error: z.string().optional(),
}).strict();

export const autoJobsSnapshotSchema = z.object({
    at: z.number().int().nonnegative(),
    jobs: z.array(jobOfferSchema),
    markets: z.array(autoJobsMarketSchema),
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
    readonly error?: string;
}

export interface AutoJobsSnapshot {
    readonly at: number;
    readonly jobs: readonly JobOffer[];
    readonly markets: readonly AutoJobsMarket[];
}
