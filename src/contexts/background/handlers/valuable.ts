import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface ValuableHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

const valuableRunSchema = z.object({
    runId: z.string().min(1),
    owner: z.string().min(1).default('valuable-seller'),
}).strict();

export function registerValuableHandlers(server: CoreRuntime['server'], deps: ValuableHandlerDeps): void {
    const { automation } = deps;
    server.register('valuable.search', valuableRunSchema, async (request) => {
        const result = await automation.valuable.runSearch(request);
        return result.ok ? ok(result.value) : result;
    });
    server.register('valuable.sell', valuableRunSchema, async (request) => {
        const result = await automation.valuable.runSell(request);
        return result.ok ? ok(result.value) : result;
    });
    server.register('valuable.cancel', z.object({ runId: z.string().min(1) }).strict(), async ({ runId }) => {
        automation.valuable.cancel(runId);
        return ok(undefined);
    });
    server.register('valuable.progress', z.object({ runId: z.string().min(1) }).strict(), async ({ runId }) => {
        return ok(automation.valuable.progress(runId));
    });
    server.register('valuable.report', z.object({}).strict(), async () => ok(await automation.valuable.report()));
}
