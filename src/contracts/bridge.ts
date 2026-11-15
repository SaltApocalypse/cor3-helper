import { z } from 'zod';

export const CONTEXT_NAMES = [
    'main-world',
    'content',
    'background',
    'popup',
    'devtools',
] as const;

export type ContextName = typeof CONTEXT_NAMES[number];

export const bridgeEnvelopeSchema = z.object({
    version: z.literal(1),
    id: z.string().min(1),
    source: z.enum(CONTEXT_NAMES),
    target: z.enum(CONTEXT_NAMES),
    type: z.string().min(1),
    payload: z.unknown(),
    replyTo: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    bridgeToken: z.string().min(1).optional(),
}).strict();

export type BridgeEnvelope<T = unknown> = Omit<z.infer<typeof bridgeEnvelopeSchema>, 'payload'> & {
    payload: T;
};

export interface BridgeError {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
}

export type BridgeResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: BridgeError };

export type BridgeRequest<T = unknown> = BridgeEnvelope<T>;
export type BridgeResponse<T = unknown> = BridgeEnvelope<BridgeResult<T>> & {
    readonly replyTo: string;
};

export function parseBridgeEnvelope(input: unknown): BridgeEnvelope {
    return bridgeEnvelopeSchema.parse(input) as BridgeEnvelope;
}

export function isBridgeEnvelope(input: unknown): input is BridgeEnvelope {
    return bridgeEnvelopeSchema.safeParse(input).success;
}

export function makeBridgeRequest<T>(args: {
    id: string;
    source: ContextName;
    target: ContextName;
    type: string;
    payload: T;
    timeoutMs?: number;
}): BridgeRequest<T> {
    const request: BridgeRequest<T> = {
        version: 1,
        id: args.id,
        source: args.source,
        target: args.target,
        type: args.type,
        payload: args.payload,
    };
    if (args.timeoutMs !== undefined) request.timeoutMs = args.timeoutMs;
    return request;
}

export function makeBridgeResponse<T>(args: {
    request: BridgeRequest;
    id: string;
    result: BridgeResult<T>;
}): BridgeResponse<T> {
    return {
        version: 1,
        id: args.id,
        replyTo: args.request.id,
        source: args.request.target,
        target: args.request.source,
        type: args.request.type,
        payload: args.result,
    };
}
