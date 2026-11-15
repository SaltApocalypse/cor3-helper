import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';
import { readWithRetry } from '../automation/delay.js';

export interface DroneHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

export function registerDroneHandlers(server: CoreRuntime['server'], deps: DroneHandlerDeps): void {
    const { core, game, automation } = deps;
    server.register('drone.autoRun', z.object({}).strict(), async () => {
        const result = await game.droneAuto.runOnce();
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('drone.view', z.object({}).strict(), async () => {
        const result = await readWithRetry(() => game.droneService.view(), 3);
        if (result.ok) {
            automation.drone.markViewSeen();
            core.logger.info('drone', 'Drone view loaded', {
                hasDrone: result.value.drone !== null,
                missions: result.value.missions.length,
                activeMissionId: result.value.activeMissionId,
            });
            await core.stores.featureAvailability.set({ droneExpedition: result.value.drone !== null });
        } else {
            core.logger.warn('drone', 'Drone view failed', { code: result.error.code, message: result.error.message });
            if (/locked|unlock|not.*available|not.*unlocked/i.test(result.error.message)) {
                await core.stores.featureAvailability.set({ droneExpedition: false });
            }
        }
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('drone.launch', z.object({
        locationConfigId: z.string().min(1),
        missionConfigId: z.string().min(1),
    }).strict(), async ({ locationConfigId, missionConfigId }) => {
        const result = await game.droneService.launch(locationConfigId, missionConfigId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('drone.repair', z.object({ targetDurability: z.number().nonnegative() }).strict(), async ({ targetDurability }) => {
        const result = await game.droneService.repair(targetDurability);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('drone.autoStatus', z.object({}).strict(), async () => ok(await automation.drone.status()));
    server.register('drone.autoEnable', z.object({ intervalMinutes: z.number().int().min(1).max(1440).optional() }).strict(), async ({ intervalMinutes }) => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        return ok(await automation.drone.enable(intervalMinutes));
    });
    server.register('drone.autoDisable', z.object({}).strict(), async () => {
        return ok(await automation.drone.disable());
    });
}
