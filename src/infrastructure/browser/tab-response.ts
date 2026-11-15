import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';

/** Shared unwrap for `{ ok, value, error }` tab-command responses. */
export function unwrapTabResult(
    response: unknown,
    fallback: { readonly code: string; readonly message: string },
): Result<unknown, GameError> {
    if (!response || typeof response !== 'object') {
        return err({ code: fallback.code, message: fallback.message });
    }
    const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown; retryAt?: unknown; lockExpiresAt?: unknown } };
    if (candidate.ok === true) return ok(candidate.value);
    const error = candidate.error;
    return err({
        code: typeof error?.code === 'string' ? error.code : fallback.code,
        message: typeof error?.message === 'string' ? error.message : fallback.message,
        ...(typeof error?.retryAt === 'number' ? { retryAt: error.retryAt } : {}),
        ...(typeof error?.lockExpiresAt === 'number' ? { lockExpiresAt: error.lockExpiresAt } : {}),
    });
}
