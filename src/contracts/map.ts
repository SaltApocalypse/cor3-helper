import { z } from 'zod';

export const rawNetworkServerSchema = z.object({
    id: z.string().min(1),
    serverName: z.string().optional(),
    serverIp: z.string().nullable().optional(),
    serverTypeName: z.string().nullable().optional(),
    serverCluster: z.string().nullable().optional(),
    faction: z.unknown().optional(),
    serverOwner: z.unknown().optional(),
    isInMaintenance: z.boolean().optional(),
    maintenanceEndsAt: z.string().nullable().optional(),
    timeUntilMaintenance: z.string().nullable().optional(),
    isEndpoint: z.boolean().optional(),
    canSetEndpoint: z.boolean().optional(),
    isReachable: z.boolean().optional(),
    accessType: z.string().optional(),
    hasAdminAccess: z.boolean().optional(),
}).passthrough();

export const rawNetworkConnectionSchema = z.object({
    id: z.string().min(1),
    serverA: z.string().min(1),
    serverB: z.string().min(1),
    isHidden: z.boolean().optional(),
}).passthrough();

export const rawNetworkMapSchema = z.object({
    servers: z.array(rawNetworkServerSchema),
    connections: z.array(rawNetworkConnectionSchema),
}).passthrough();

export type RawNetworkServer = z.infer<typeof rawNetworkServerSchema>;
export type RawNetworkConnection = z.infer<typeof rawNetworkConnectionSchema>;
export type RawNetworkMap = z.infer<typeof rawNetworkMapSchema>;

export function parseRawNetworkMap(input: unknown): RawNetworkMap {
    return rawNetworkMapSchema.parse(input);
}
