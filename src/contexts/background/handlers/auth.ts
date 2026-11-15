import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';

export interface AuthHandlerDeps {
    readonly core: CoreRuntime;
}

export function registerAuthHandlers(server: CoreRuntime['server'], deps: AuthHandlerDeps): void {
    const { auth } = deps.core;
    server.register('auth.status', z.object({}).strict(), async () => ok(await auth.status()));
    server.register('auth.execute', z.object({
        operation: z.enum(['dailyOps', 'dailyRewards']),
        payload: z.unknown().optional(),
    }).strict(), async ({ operation, payload }) => {
        const result = await auth.execute({ operation, payload: payload ?? null });
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
