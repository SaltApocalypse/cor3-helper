import type { AuthStatus } from '../../contracts/storage.js';
import type { AuthRequestPort, AuthOperation, AuthError } from '../../application/auth/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';

export interface TabMessagePort {
    findCor3Tab(): Promise<number | null>;
    send(tabId: number, message: unknown): Promise<unknown>;
}

export class ChromeTabAuthAdapter implements AuthRequestPort {
    constructor(
        private readonly tabs: TabMessagePort,
        private readonly retryDelayMs = 2000,
    ) {}

    async status(): Promise<AuthStatus> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return { authenticated: false, source: 'none' };
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_AUTH_STATUS' });
            if (response && typeof response === 'object' && 'authenticated' in response) {
                const candidate = response as { authenticated: unknown; source?: unknown; expiresAt?: unknown };
                if (candidate.authenticated === true && candidate.source === 'content') {
                    return {
                        authenticated: true,
                        source: 'content',
                        ...(typeof candidate.expiresAt === 'number' ? { expiresAt: candidate.expiresAt } : {}),
                    };
                }
            }
        } catch {
            // Content may not be ready yet; treat as no active session.
        }
        return { authenticated: false, source: 'none' };
    }

    async execute<T>(operation: AuthOperation): Promise<Result<T, AuthError>> {
        const first = await this.executeOnce<T>(operation);
        if (first.ok || first.error.code !== 'AUTH_EXPIRED') return first;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        return this.executeOnce<T>(operation);
    }

    private async executeOnce<T>(operation: AuthOperation): Promise<Result<T, AuthError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, {
                type: 'V2_AUTH_EXECUTE',
                operation: operation.operation,
                payload: operation.payload,
            });
            if (!response || typeof response !== 'object') {
                return err({ code: 'AUTH_FAILED', message: 'No auth operation result' });
            }
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value as T);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'AUTH_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Auth operation failed',
            });
        } catch (error) {
            return err({ code: 'AUTH_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
