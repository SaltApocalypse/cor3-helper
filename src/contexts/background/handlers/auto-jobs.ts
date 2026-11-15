import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface AutoJobsHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

export function registerAutoJobsHandlers(server: CoreRuntime['server'], deps: AutoJobsHandlerDeps): void {
    const { core, automation } = deps;
    server.register('auto-jobs.snapshot', z.object({}).strict(), async () => ok(automation.autoJobs.snapshotView()));
    server.register('auto-jobs.status', z.object({}).strict(), async () => ok(await automation.autoJobs.status()));
    server.register('auto-jobs.enable', z.object({}).strict(), async () => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        return ok(await automation.autoJobs.enable());
    });
    server.register('auto-jobs.disable', z.object({}).strict(), async () => {
        return ok(await automation.autoJobs.disable());
    });
}
