import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface DailyHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

export function registerDailyHandlers(server: CoreRuntime['server'], deps: DailyHandlerDeps): void {
    const { core, automation } = deps;
    server.register('daily.autoStatus', z.object({}).strict(), async () => ok(await automation.daily.status()));
    server.register('daily.autoEnable', z.object({ intervalMinutes: z.number().int().min(5).max(1440).optional() }).strict(), async ({ intervalMinutes }) => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        return ok(await automation.daily.enable(intervalMinutes));
    });
    server.register('daily.autoDisable', z.object({}).strict(), async () => {
        return ok(await automation.daily.disable());
    });
    server.register('daily.hack', z.object({}).strict(), async () => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        const result = await automation.daily.hackNow();
        return result.ok ? ok(result.value) : result;
    });
    server.register('daily.cancelHack', z.object({}).strict(), async () => {
        const result = await automation.daily.cancelHack();
        return result.ok ? ok(undefined) : result;
    });
    server.register('daily.view', z.object({ force: z.boolean().optional() }).strict(), async ({ force }) => {
        return automation.dailyCache.read(force === true);
    });
}
