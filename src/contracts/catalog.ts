import { z } from 'zod';

export const hardwareSpecsSchema = z.object({
    cpuFrequency: z.number().nonnegative().optional(),
    cpuCores: z.number().nonnegative().optional(),
    cpuConsuming: z.number().nonnegative().optional(),
    gpuPower: z.number().nonnegative().optional(),
    gpuMemory: z.number().nonnegative().optional(),
    gpuConsuming: z.number().nonnegative().optional(),
    ramFrequency: z.number().nonnegative().optional(),
    ramMemory: z.number().nonnegative().optional(),
    psuPower: z.number().nonnegative().optional(),
    psuProtection: z.number().nonnegative().optional(),
}).strict();

const hardwareDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slot: z.enum(['cpu', 'gpu', 'ram', 'psu']),
    specs: hardwareSpecsSchema,
}).strict();

const softwareAbilitySchema = z.object({
    type: z.enum(['HACK', 'DECRYPT', 'SEARCH']),
    minPower: z.number().nonnegative(),
    maxPower: z.number().nonnegative(),
    serverTypes: z.array(z.string()).optional(),
    fileTypes: z.array(z.string()).optional(),
}).strict();

const softwareDefinitionSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    abilities: z.array(softwareAbilitySchema).min(1),
    consuming: z.record(z.string(), z.array(z.number().nonnegative())),
}).strict();

export const itemCatalogSchema = z.object({
    catalogVersion: z.string().min(1),
    gameVersion: z.string().min(1),
    hardware: z.array(hardwareDefinitionSchema),
    software: z.array(softwareDefinitionSchema),
}).strict();

export type CatalogDto = z.infer<typeof itemCatalogSchema>;

/**
 * Validates catalog shape and cross-record invariants without accepting player
 * ownership fields. The returned value is the domain catalog.
 */
export function parseItemCatalog(input: unknown): CatalogDto {
    const parsed = itemCatalogSchema.parse(input);
    const hardwareIds = new Set<string>();
    for (const item of parsed.hardware) {
        if (hardwareIds.has(item.id)) throw new Error(`Duplicate hardware id: ${item.id}`);
        hardwareIds.add(item.id);
    }
    const softwareIds = new Set<string>();
    for (const item of parsed.software) {
        if (softwareIds.has(item.id)) throw new Error(`Duplicate software id: ${item.id}`);
        softwareIds.add(item.id);
    }
    return parsed;
}
