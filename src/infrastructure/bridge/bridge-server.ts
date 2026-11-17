import type { z } from 'zod';
import {
    bridgeEnvelopeSchema,
    makeBridgeResponse,
    type BridgeEnvelope,
    type BridgeRequest,
    type BridgeResult,
} from '../../contracts/bridge.js';
import type { ContextName } from '../../contracts/bridge.js';
import { err } from '../../kernel/result.js';
import type { Logger } from '../logging/logger.js';

export type BridgeHandler = (payload: unknown, request: BridgeRequest) => Promise<BridgeResult<unknown>>;

export interface BridgeAuditEvent {
    readonly at: number;
    readonly id: string;
    readonly source: ContextName;
    readonly target: ContextName;
    readonly type: string;
    readonly ok: boolean;
    readonly code: string | null;
    readonly durationMs: number;
    readonly payload: unknown;
}

interface RegisteredHandler {
    readonly schema: z.ZodTypeAny;
    readonly handler: BridgeHandler;
}

export class BridgeServer {
    private readonly handlers = new Map<string, RegisteredHandler>();

    constructor(
        private readonly target: ContextName,
        private readonly logger: Logger,
        private readonly audit?: (event: BridgeAuditEvent) => void,
    ) {}

    register<T>(type: string, schema: z.ZodType<T>, handler: (payload: T, request: BridgeRequest) => Promise<BridgeResult<unknown>>): void {
        this.handlers.set(type, {
            schema,
            handler: async (payload, request) => handler(payload as T, request),
        });
    }

    /** Registered bridge type names, sorted. Used by contract tests. */
    listTypes(): readonly string[] {
        return [...this.handlers.keys()].sort();
    }

    async handle(input: unknown): Promise<BridgeEnvelope | null> {
        const started = Date.now();
        const parsedRequest = bridgeEnvelopeSchema.safeParse(input);
        if (!parsedRequest.success) {
            this.logger.warn('bridge', 'Ignored malformed bridge request');
            return null;
        }
        const request = parsedRequest.data as BridgeRequest;
        if (request.target !== this.target) return null;

        const respond = (result: BridgeResult<unknown>): BridgeEnvelope => {
            this.audit?.({
                at: Date.now(),
                id: request.id,
                source: request.source,
                target: request.target,
                type: request.type,
                ok: result.ok,
                code: result.ok ? null : result.error?.code ?? 'BRIDGE_HANDLER_ERROR',
                durationMs: Date.now() - started,
                payload: request.payload,
            });
            return makeBridgeResponse({ request, id: request.id, result });
        };

        const registered = this.handlers.get(request.type);
        if (!registered) {
            return respond(err({ code: 'BRIDGE_UNKNOWN_TYPE', message: `Unknown bridge type: ${request.type}` }));
        }

        const parsedPayload = registered.schema.safeParse(request.payload);
        if (!parsedPayload.success) {
            return respond(err({ code: 'BRIDGE_INVALID_PAYLOAD', message: `Invalid payload for: ${request.type}` }));
        }

        try {
            const result = await registered.handler(parsedPayload.data, request);
            return respond(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('bridge', 'Bridge handler failed', { type: request.type, message });
            return respond(err({ code: 'BRIDGE_HANDLER_ERROR', message }));
        }
    }
}

export interface BridgeServerTransport {
    start(handler: (request: unknown) => Promise<BridgeEnvelope | null>): () => void;
}
