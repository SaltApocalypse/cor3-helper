import { z } from 'zod';

/**
 * Versioned envelope for background ↔ content tab commands. Content and
 * background reject raw `{ type, ... }` messages; every command and notice is
 * stamped with this protocol version and request id.
 */
export const TAB_PROTOCOL_VERSION = 2;

export const tabRequestSchema = z.object({
    protocol: z.literal('v2-tab'),
    version: z.literal(TAB_PROTOCOL_VERSION),
    requestId: z.string().min(1),
    type: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
}).strict();

export type TabRequestEnvelope = z.infer<typeof tabRequestSchema>;

export const tabResponseSchema = z.object({
    protocol: z.literal('v2-tab'),
    version: z.literal(TAB_PROTOCOL_VERSION),
    requestId: z.string().min(1),
    response: z.unknown(),
}).strict();

export function encodeTabRequest(message: unknown): TabRequestEnvelope | null {
    if (!message || typeof message !== 'object') return null;
    const record = message as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== 'string' || type.length === 0) return null;
    const { type: _type, ...payload } = record;
    return {
        protocol: 'v2-tab',
        version: TAB_PROTOCOL_VERSION,
        requestId: crypto.randomUUID(),
        type,
        payload,
    };
}

export function decodeTabRequest(message: unknown): Record<string, unknown> | null {
    const parsed = tabRequestSchema.safeParse(message);
    if (!parsed.success) return null;
    return { type: parsed.data.type, ...parsed.data.payload };
}

export function encodeTabResponse(requestId: string, response: unknown) {
    return {
        protocol: 'v2-tab' as const,
        version: TAB_PROTOCOL_VERSION,
        requestId,
        response,
    };
}

export function decodeTabResponse(message: unknown): unknown {
    const parsed = tabResponseSchema.safeParse(message);
    return parsed.success ? parsed.data.response : message;
}
