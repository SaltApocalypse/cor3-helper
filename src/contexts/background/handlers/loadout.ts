import { z } from 'zod';
import { buildLoadoutView } from '../../../application/loadout/view.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';

export interface LoadoutHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
}

const loadoutApplySchema = z.object({
    ability: z.enum(['HACK', 'DECRYPT', 'SEARCH']),
    target: z.string().min(1),
    requiredPower: z.number().nonnegative().default(0),
    strategy: z.enum(['best', 'weakest']).default('best'),
}).strict();

const loadoutModuleSchema = z.object({ moduleConfigId: z.string().min(1) }).strict();

export function registerLoadoutHandlers(server: CoreRuntime['server'], deps: LoadoutHandlerDeps): void {
    const { core, game } = deps;
    server.register('loadout.view', z.object({}).strict(), async () => {
        const runtime = await game.loadoutAdapter.get();
        if (!runtime.ok) return { ok: false, error: { code: runtime.error.code, message: runtime.error.message } };
        return ok(buildLoadoutView(runtime.value));
    });
    server.register('loadout.apply', loadoutApplySchema, async (request) => {
        const result = await game.loadout.ensure(request);
        if (!result.ok) {
            core.logger.warn('loadout', 'Loadout apply failed', { strategy: request.strategy, ability: request.ability, target: request.target, requiredPower: request.requiredPower, code: result.error.code, message: result.error.message });
            return { ok: false, error: { code: result.error.code, message: result.error.message } };
        }
        core.logger.info('loadout', 'Loadout applied', {
            strategy: request.strategy,
            ability: request.ability,
            target: request.target,
            requiredPower: request.requiredPower,
            power: result.value.power,
            feasible: result.value.feasible,
            software: result.value.software.name,
            cpu: result.value.hardware.cpu.name,
            gpu: result.value.hardware.gpu.name,
            ram: result.value.hardware.ram.name,
            psu: result.value.hardware.psu.name,
        });
        return ok({
            ability: result.value.ability,
            target: result.value.target,
            power: result.value.power,
            requiredPower: result.value.requiredPower,
            feasible: result.value.feasible,
            softwareName: result.value.software.name,
            policyId: result.value.policyId,
            policyVersion: result.value.policyVersion,
        });
    });
    server.register('loadout.equipHardware', loadoutModuleSchema, async ({ moduleConfigId }) => {
        const result = await game.loadoutAdapter.equipHardware(moduleConfigId);
        if (result.ok) game.loadout.invalidate();
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('loadout.equipSoftware', loadoutModuleSchema, async ({ moduleConfigId }) => {
        const result = await game.loadoutAdapter.equipSoftware(moduleConfigId);
        if (result.ok) game.loadout.invalidate();
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('loadout.unequipSoftware', loadoutModuleSchema, async ({ moduleConfigId }) => {
        const result = await game.loadoutAdapter.unequipSoftware(moduleConfigId);
        if (result.ok) game.loadout.invalidate();
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
