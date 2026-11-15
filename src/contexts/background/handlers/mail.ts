import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface MailHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

export function registerMailHandlers(server: CoreRuntime['server'], deps: MailHandlerDeps): void {
    const { core, game, automation } = deps;
    server.register('mail.autoStatus', z.object({}).strict(), async () => ok(await automation.mail.status()));
    server.register('mail.autoEnable', z.object({ intervalMinutes: z.number().int().min(1).max(1440).optional() }).strict(), async () => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        return ok(await automation.mail.enable());
    });
    server.register('mail.autoDisable', z.object({}).strict(), async () => {
        return ok(await automation.mail.disable());
    });
    server.register('mail.autoRun', z.object({}).strict(), async () => {
        await automation.mail.run();
        return ok(automation.mail.lastRun());
    });
    server.register('mail.view', z.object({}).strict(), async () => {
        const result = await game.mailService.view();
        return result.ok
            ? ok(result.value)
            : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('mail.claimSource', z.object({
        source: z.string().min(1),
        sourceId: z.string().min(1),
    }).strict(), async ({ source, sourceId }) => {
        const result = await game.mailService.claimForSource(source, sourceId);
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('mail.claimAll', z.object({ messageId: z.string().min(1) }).strict(), async ({ messageId }) => {
        const result = await game.mailService.claimMessage(messageId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('mail.claimPending', z.object({}).strict(), async () => {
        const result = await game.mailService.claimPending();
        return result.ok
            ? ok(result.value)
            : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
