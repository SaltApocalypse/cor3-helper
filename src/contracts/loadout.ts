import { z } from 'zod';

export const rawHardwareSchema = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    category: z.string().min(1),
    specs: z.record(z.string(), z.unknown()).optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    itemVulnerability: z.number().optional(),
}).passthrough();

export const rawSoftwareSchema = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    consuming: z.record(z.string(), z.array(z.number())).optional(),
    specs: z.unknown().optional(),
    tier: z.number().optional(),
    manufacturer: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
}).passthrough();

export const rawLoadoutSchema = z.object({    ownedHardware: z.array(rawHardwareSchema).optional(),
    ownedSoftware: z.array(rawSoftwareSchema).optional(),
    equippedHardware: z.record(z.string(), z.unknown()).optional(),
    equippedSoftware: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional(),
}).passthrough();

export type RawLoadout = z.infer<typeof rawLoadoutSchema>;
export type RawHardware = z.infer<typeof rawHardwareSchema>;
export type RawSoftware = z.infer<typeof rawSoftwareSchema>;
