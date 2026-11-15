import { z } from 'zod';

export const gameEventEnvelopeSchema = z.object({
    event: z.string().min(1),
    action: z.string().min(1),
    data: z.unknown(),
    error: z.unknown().optional(),
}).strict();

export type GameEventEnvelope = z.infer<typeof gameEventEnvelopeSchema>;

export const gameCommandSchema = z.object({
    event: z.string().min(1),
    action: z.string().min(1),
    data: z.unknown(),
}).strict();

export type GameCommand = z.infer<typeof gameCommandSchema>;

export function parseGameEventEnvelope(input: unknown): GameEventEnvelope {
    return gameEventEnvelopeSchema.parse(input);
}
