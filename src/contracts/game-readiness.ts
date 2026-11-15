import { z } from 'zod';

export const gameReadinessSchema = z.object({
    socketOpen: z.boolean(),
    authenticated: z.boolean(),
    mapLoaded: z.boolean(),
    marketLoaded: z.boolean(),
    loadoutLoaded: z.boolean(),
    ready: z.boolean(),
    readyAt: z.number().nullable(),
    checkedAt: z.number(),
}).strict();

export type GameReadiness = z.infer<typeof gameReadinessSchema>;

export function isGameReady(readiness: GameReadiness): boolean {
    return readiness.socketOpen && readiness.authenticated && readiness.mapLoaded;
}
