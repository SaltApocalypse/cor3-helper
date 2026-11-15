import { z } from 'zod';

/**
 * SAI (Server Administration Interface) file list payloads.
 *
 * The game sends `sai:get.files` with entries that already carry the fields
 * needed for the value overlay. The raw schema stays permissive because the
 * game adds fields between builds; the normalized schema is the stable shape
 * used by the main-world cache and the content-script highlighter.
 */
const rawSaiFileSchema = z.object({
    fileId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    isValuableMarked: z.boolean().optional(),
    basePrice: z.union([z.number(), z.string()]).nullable().optional(),
    detectRate: z.union([z.number(), z.string()]).nullable().optional(),
    tags: z.array(z.unknown()).nullable().optional(),
}).passthrough();

const rawSaiFilesPayloadSchema = z.object({
    files: z.array(z.unknown()),
}).passthrough();

export const saiFileEntrySchema = z.object({
    fileId: z.string().min(1),
    name: z.string(),
    source: z.string(),
    isValuableMarked: z.boolean(),
    basePrice: z.number(),
    detectRate: z.number(),
    tags: z.array(z.string()),
}).strict();

export type SaiFileEntry = z.infer<typeof saiFileEntrySchema>;

export const saiFileSnapshotSchema = z.object({
    files: z.array(saiFileEntrySchema),
}).strict();

export const saiFilesMessageSchema = z.object({
    version: z.literal(2),
    type: z.literal('V2_SAI_FILES'),
    files: z.array(saiFileEntrySchema),
}).strict();

function numberOr(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function tagLabel(tag: unknown): string {
    if (typeof tag === 'string') return tag;
    if (tag && typeof tag === 'object') {
        const entry = tag as { key?: unknown; label?: unknown };
        return typeof entry.label === 'string' ? entry.label : typeof entry.key === 'string' ? entry.key : '';
    }
    return '';
}

export function normalizeSaiFile(raw: unknown): SaiFileEntry | null {
    const parsed = rawSaiFileSchema.safeParse(raw);
    if (!parsed.success) return null;
    const entry = parsed.data;
    const fileId = entry.fileId ?? entry.id ?? '';
    if (fileId.length === 0) return null;
    return {
        fileId,
        name: entry.name ?? fileId,
        source: (entry.source ?? 'generated').toLowerCase(),
        isValuableMarked: entry.isValuableMarked === true,
        basePrice: numberOr(entry.basePrice),
        detectRate: numberOr(entry.detectRate),
        tags: (entry.tags ?? []).map(tagLabel).filter((tag) => tag.length > 0),
    };
}

export function normalizeSaiFiles(value: unknown): SaiFileEntry[] {
    const parsed = rawSaiFilesPayloadSchema.safeParse(value);
    if (!parsed.success) return [];
    return parsed.data.files
        .map(normalizeSaiFile)
        .filter((entry): entry is SaiFileEntry => entry !== null);
}
