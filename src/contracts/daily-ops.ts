import { z } from 'zod';

export const rawDailyOpsSchema = z.object({
    hasClaimedToday: z.boolean().optional(),
    currentStreak: z.number().optional(),
    difficulty: z.string().optional(),
    nextTaskTime: z.string().optional(),
}).passthrough();

export const rawDailyRewardSchema = z.object({
    day: z.number().optional(),
    amount: z.number().optional(),
}).passthrough();

export const rawDailyRewardsSchema = z.union([
    z.array(rawDailyRewardSchema),
    z.object({ rewards: z.array(rawDailyRewardSchema) }).passthrough(),
]);
