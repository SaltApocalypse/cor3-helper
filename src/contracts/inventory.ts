import { z } from 'zod';

export const rawInventoryItemSchema = z.object({
    id: z.string().min(1),
    width: z.number().optional(),
    height: z.number().optional(),
    rotated: z.boolean().optional(),
    canRotate: z.boolean().optional(),
    tier: z.string().optional(),
    name: z.string().optional(),
    shortName: z.string().optional(),
    itemConfigId: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    location: z.string().optional(),
    quantity: z.number().optional(),
    canSell: z.boolean().optional(),
    sellPrice: z.number().optional(),
    canCraft: z.boolean().optional(),
    canUse: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    imageUrl: z.string().optional(),
    description: z.string().optional(),
}).passthrough();

export const rawInventoryStashSchema = z.object({
    gridWidth: z.number().optional(),
    usableRows: z.number().optional(),
    maxCapacity: z.number().optional(),
    currentUsage: z.number().optional(),
    sortingTable: z.object({ width: z.number().optional(), items: z.array(rawInventoryItemSchema).optional() }).passthrough().optional(),
    rental: z.object({
        status: z.string().nullish(),
        expiresAt: z.string().nullish(),
        gracePeriodEndAt: z.string().nullish(),
    }).passthrough().optional(),
    items: z.array(rawInventoryItemSchema),
}).passthrough();

export type RawInventoryStash = z.infer<typeof rawInventoryStashSchema>;
