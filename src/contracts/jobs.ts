import { z } from 'zod';
import { JOB_TYPES, type JobType } from '../kernel/job-types.js';

const jobConditionDetailsSchema = z.object({
    ips: z.array(z.string()).optional(),
    files: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
}).passthrough();

export const jobConditionSchema = z.object({
    type: z.string().optional(),
    details: jobConditionDetailsSchema.optional(),
    ip: z.string().optional(),
    targetIp: z.string().optional(),
}).passthrough();

export const jobOfferSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(JOB_TYPES),
    marketId: z.string().min(1),
    marketKey: z.string().min(1),
    marketServerId: z.string().min(1).nullable().optional(),
    serverId: z.string().min(1).nullable(),
    serverName: z.string().nullable(),
    rewardCredits: z.number(),
    rewardReputation: z.number(),
    deposit: z.number(),
    reputationPenalty: z.number().nonnegative().optional(),
    alreadyTaken: z.boolean(),
    canComplete: z.boolean(),
    conditions: z.array(jobConditionSchema).optional(),
    fileInfo: z.object({ id: z.string().optional(), name: z.string().optional() }).nullable().optional(),
}).strict();

export const rawJobSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    rewardCredits: z.number().optional(),
    rewardReputation: z.number().optional(),
    deposit: z.number().optional(),
    reputationPenalty: z.number().nonnegative().optional(),
    jobType: z.string().optional(),
    canComplete: z.boolean().optional(),
    status: z.string().optional(),
    isCompleted: z.boolean().optional(),
    isExpired: z.boolean().optional(),
    relatedServers: z.array(z.object({
        id: z.string().nullable().optional(),
        serverName: z.string().nullable().optional(),
    }).passthrough()).nullable().optional(),
    conditions: z.unknown().optional(),
    fileInfo: z.unknown().optional(),
}).passthrough();

export type JobOfferDto = z.infer<typeof jobOfferSchema>;

export interface JobCondition {
    readonly type?: string | undefined;
    readonly details?: {
        readonly ips?: readonly string[] | undefined;
        readonly files?: readonly { readonly name?: string | undefined; readonly [key: string]: unknown }[] | undefined;
        readonly fileIds?: readonly string[] | undefined;
        readonly [key: string]: unknown;
    } | undefined;
    readonly ip?: string | undefined;
    readonly targetIp?: string | undefined;
    readonly [key: string]: unknown;
}

export interface JobOffer {
    readonly id: string;
    readonly name: string;
    readonly type: JobType;
    readonly marketId: string;
    readonly marketKey: string;
    readonly marketServerId?: string | null | undefined;
    readonly serverId: string | null;
    readonly serverName: string | null;
    readonly rewardCredits: number;
    readonly rewardReputation: number;
    readonly deposit: number;
    readonly reputationPenalty?: number | undefined;
    readonly alreadyTaken: boolean;
    readonly canComplete: boolean;
    readonly conditions?: readonly JobCondition[] | undefined;
    readonly fileInfo?: { readonly id?: string | undefined; readonly name?: string | undefined } | null | undefined;
}
export type RawJob = z.infer<typeof rawJobSchema>;

/** Cross-market job identity. Market is part of the identity; never infer it. */
export interface JobIdentity {
    readonly marketKey: string;
    readonly jobId: string;
}

/** Stable market-scoped job identity string. */
export function jobIdentityKey(marketKey: string, jobId: string): string {
    return JSON.stringify([marketKey, jobId]);
}

/**
 * Parses a key produced by {@link jobIdentityKey}. Returns null for legacy
 * jobId-only keys so callers never guess a market for old data.
 */
export function jobIdentityParts(key: string): JobIdentity | null {
    try {
        const parsed: unknown = JSON.parse(key);
        if (!Array.isArray(parsed) || parsed.length !== 2) return null;
        const [marketKey, jobId] = parsed;
        if (typeof marketKey !== 'string' || typeof jobId !== 'string') return null;
        if (marketKey.length === 0 || jobId.length === 0) return null;
        return { marketKey, jobId };
    } catch {
        return null;
    }
}
