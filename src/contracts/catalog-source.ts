import { z } from 'zod';
import { rawHardwareSchema, rawSoftwareSchema } from './loadout.js';

/**
 * Raw module dump accepted by the static catalog builder. This is intentionally
 * separate from player inventory: owned/equipped fields are rejected by the
 * catalog validator after mapping.
 */
export const catalogSourceSchema = z.object({
    catalogVersion: z.string().min(1),
    gameVersion: z.string().min(1),
    source: z.string().min(1),
    capturedAt: z.string().optional(),
    hardware: z.array(rawHardwareSchema),
    software: z.array(rawSoftwareSchema),
}).strict();

export type CatalogSource = z.infer<typeof catalogSourceSchema>;
