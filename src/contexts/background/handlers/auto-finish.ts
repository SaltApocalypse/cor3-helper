import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface AutoFinishHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

const autoFinishRunSchema = z.object({
    owner: z.string().min(1).default('auto-finish'),
    force: z.boolean().default(false),
}).strict();

export function registerAutoFinishHandlers(server: CoreRuntime['server'], deps: AutoFinishHandlerDeps): void {
    const { core, automation } = deps;
    server.register('auto-finish.run', autoFinishRunSchema, async ({ owner, force }) => {
        const result = await automation.autoFinish.runExclusive(owner, force);
        return result.ok
            ? ok(result.value)
            : { ok: false, error: result.error ?? { code: 'AUTO_FINISH_FAILED', message: 'Auto Finish failed' } };
    });
    server.register('auto-finish.enable', z.object({}).strict(), async () => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        if (automation.autoFinish.isRunning()) {
            return { ok: false, error: { code: 'AUTO_FINISH_RUNNING', message: 'Auto complete is running; wait for it to finish or cancel it' } };
        }
        return ok(await automation.autoFinish.enable());
    });
    server.register('auto-finish.disable', z.object({}).strict(), async () => {
        return ok(await automation.autoFinish.disable());
    });
    server.register('auto-finish.cancel', z.object({}).strict(), async () => {
        await automation.autoFinish.cancel();
        return ok(undefined);
    });
    server.register('auto-finish.status', z.object({}).strict(), async () => ok(await automation.autoFinish.status()));
    server.register('auto-finish.progress', z.object({}).strict(), async () => ok({
        running: automation.autoFinish.isRunning(),
        progress: automation.autoFinish.progressValue(),
        last: automation.autoFinish.lastRun(),
    }));
}
