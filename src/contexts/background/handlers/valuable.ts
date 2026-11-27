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

const forceMaintenanceOptionsSchema = z.object({
    serverIds: z.array(z.string().min(1)).max(200),
    // Accepted for panels built before 2.0.13, where force maintenance also
    // downloaded valuables. The v1-parity loop no longer downloads.
    includeDownloads: z.boolean().optional(),
}).strict();

const valuableSellSchema = valuableRunSchema.extend({
    forceMaintenance: forceMaintenanceOptionsSchema.optional(),
}).strict();

const valuableForceSchema = valuableRunSchema.extend({
    serverIds: z.array(z.string().min(1)).max(200),
    includeDownloads: z.boolean().optional(),
}).strict();

export function registerValuableHandlers(server: CoreRuntime['server'], deps: ValuableHandlerDeps): void {
    const { core, automation } = deps;
    server.register('valuable.search', valuableRunSchema, async (request) => {
        const result = await automation.valuable.runSearch(request);
        return result.ok ? ok(result.value) : result;
    });
    server.register('valuable.sell', valuableSellSchema, async (request) => {
        const result = await automation.valuable.runSell(request);
        const force = request.forceMaintenance;
        if (result.ok && result.value.stopped !== true && force && force.serverIds.length > 0) {
            const started = await automation.valuable.startForceMaintenance({
                runId: `${request.runId}:force`,
                owner: request.owner,
                serverIds: force.serverIds,
            });
            if (!started.ok) {
                core.logger.warn('valuable', 'Automatic force maintenance did not start', {
                    code: started.error.code,
                    message: started.error.message,
                });
            }
        }
        return result.ok ? ok(result.value) : result;
    });
    server.register('valuable.forceMaintenance', valuableForceSchema, async (request) => {
        return automation.valuable.startForceMaintenance(request);
    });
    server.register('valuable.maintenance', z.object({ force: z.boolean().default(false) }).strict(), async ({ force }) => {
        return automation.valuable.maintenanceServers(force);
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
