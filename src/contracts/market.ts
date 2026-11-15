import { z } from 'zod';

export const rawMarketSnapshotSchema = z.object({
    options: z.record(z.string(), z.unknown()),
    lots: z.union([
        z.array(z.unknown()),
        z.object({ lots: z.array(z.unknown()).optional() }).passthrough(),
        z.record(z.string(), z.unknown()),
    ]),
    jobs: z.union([
        z.array(z.unknown()),
        z.object({ jobs: z.array(z.unknown()).optional() }).passthrough(),
        z.record(z.string(), z.unknown()),
    ]),
}).strict();

export type RawMarketSnapshot = z.infer<typeof rawMarketSnapshotSchema>;
