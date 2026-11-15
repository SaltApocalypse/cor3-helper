import { z } from 'zod';

export const rawMarketLotSchema = z.object({
    id: z.string().optional(),
    category: z.string().optional(),
    price: z.number().optional(),
    priceModifier: z.number().optional(),
    accessLevel: z.number().optional(),
    availableCount: z.number().optional(),
    lockedByQuest: z.string().optional(),
    unavailableReason: z.string().optional(),
    details: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        manufacturer: z.string().optional(),
        tier: z.string().optional(),
        image: z.string().optional(),
        specs: z.unknown().optional(),
    }).passthrough().optional(),
}).passthrough();

export const rawMarketOptionsSchema = z.object({
    market: z.object({
        id: z.string().optional(),
        marketName: z.string().optional(),
    }).passthrough().optional(),
    reputation: z.object({
        level: z.number().optional(),
        progress: z.number().optional(),
        requiredReputation: z.number().optional(),
        isLevelLocked: z.boolean().optional(),
        isMaxLevel: z.boolean().optional(),
    }).passthrough().optional(),
    userCredits: z.number().optional(),
}).passthrough();

export const rawMarketJobsSchema = z.object({
    jobs: z.array(z.unknown()).optional(),
    recentJobs: z.array(z.unknown()).optional(),
    nextJobsResetAt: z.string().optional(),
}).passthrough();

export const rawMarketViewSchema = z.object({
    options: rawMarketOptionsSchema,
    lots: z.union([z.array(rawMarketLotSchema), z.object({ lots: z.array(rawMarketLotSchema) }).passthrough()]),
    jobs: z.union([rawMarketJobsSchema, z.array(z.unknown())]),
}).strict();

export type RawMarketLot = z.infer<typeof rawMarketLotSchema>;
