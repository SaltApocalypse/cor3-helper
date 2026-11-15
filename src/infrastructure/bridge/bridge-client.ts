import type { z } from 'zod';
import { isBridgeEnvelope, makeBridgeRequest, type BridgeEnvelope, type BridgeResult } from '../../contracts/bridge.js';
import type { ContextName } from '../../contracts/bridge.js';
import type { Clock } from '../../kernel/clock.js';
import { SystemClock } from '../../kernel/clock.js';

export interface BridgeClientTransport {
    send(request: BridgeEnvelope): Promise<unknown>;
}

export class BridgeClient {
    constructor(
        private readonly transport: BridgeClientTransport,
        private readonly source: ContextName,
        private readonly target: ContextName,
        private readonly clock: Clock = new SystemClock(),
    ) {}

    async request<T>(
        type: string,
        payload: unknown,
        responseSchema: z.ZodType<T>,
        timeoutMs = 5000,
    ): Promise<BridgeResult<T>> {
        const id = globalThis.crypto?.randomUUID?.() ?? `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const request = makeBridgeRequest({
            id,
            source: this.source,
            target: this.target,
            type,
            payload,
            timeoutMs,
        });

        let timeoutHandle: ReturnType<Clock['setTimeout']> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timeoutHandle = this.clock.setTimeout(() => {
                reject(new Error(`Bridge request timed out: ${type}`));
            }, timeoutMs);
        });

        try {
            const raw = await Promise.race([this.transport.send(request), timeout]);
            if (!isBridgeEnvelope(raw)) {
                return { ok: false, error: { code: 'BRIDGE_INVALID_RESPONSE', message: 'Response was not a bridge envelope' } };
            }
            if (raw.replyTo !== request.id) {
                return { ok: false, error: { code: 'BRIDGE_BAD_REPLY', message: 'Response did not match request id' } };
            }
            const result = raw.payload;
            if (!result || typeof result !== 'object' || !('ok' in result)) {
                return { ok: false, error: { code: 'BRIDGE_INVALID_RESULT', message: 'Response payload was not a BridgeResult' } };
            }
            const typed = result as BridgeResult<unknown>;
            if (!typed.ok) return typed as BridgeResult<T>;
            const parsed = responseSchema.safeParse(typed.value);
            if (!parsed.success) {
                return { ok: false, error: { code: 'BRIDGE_INVALID_VALUE', message: 'Response value failed schema validation' } };
            }
            return { ok: true, value: parsed.data };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                ok: false,
                error: {
                    code: message.includes('timed out') ? 'BRIDGE_TIMEOUT' : 'BRIDGE_TRANSPORT_ERROR',
                    message,
                },
            };
        } finally {
            if (timeoutHandle !== undefined) this.clock.clearTimeout(timeoutHandle);
        }
    }
}
