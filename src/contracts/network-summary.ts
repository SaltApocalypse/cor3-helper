import { z } from 'zod';

export const networkMapSummarySchema = z.object({
    serverCount: z.number().int().nonnegative(),
    connectionCount: z.number().int().nonnegative(),
    hiddenConnectionCount: z.number().int().nonnegative(),
    home: z.string().nullable(),
    endpoint: z.string().nullable(),
}).strict();

export type NetworkMapSummary = z.infer<typeof networkMapSummarySchema>;
