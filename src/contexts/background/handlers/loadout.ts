import { z } from 'zod';
import { buildLoadoutView } from '../../../application/loadout/view.js';
import { redact } from '../../../infrastructure/logging/logger.js';
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

/**
 * Wraps the raw `loadout:get.options` payload for the devtools export. The
 * payload stays at the top level (with `_meta` added) so the file can be fed
 * directly to `npm run catalog -- from-loadout --input <file>`.
 */
function buildLoadoutDumpBody(dump: {
    readonly capturedAt: number;
    readonly raw: unknown;
    readonly validation: unknown;
}, appVersion: string): { readonly fileName: string; readonly json: string } {
    const meta = {
        schemaVersion: 1,
        source: 'loadout:get.options',
        capturedAt: new Date(dump.capturedAt).toISOString(),
        extensionVersion: appVersion,
        validation: dump.validation,
    };
    const redacted = redact(dump.raw);
    const body = redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
        ? { ...(redacted as Record<string, unknown>), _meta: meta }
        : { payload: redacted, _meta: meta };
    const stamp = new Date(dump.capturedAt).toISOString().replace(/[:.]/g, '-');
    return {
        fileName: `cor3-loadout-${stamp}.json`,
        json: JSON.stringify(body, null, 2),
    };
}

export function registerLoadoutHandlers(server: CoreRuntime['server'], deps: LoadoutHandlerDeps): void {
    const { core, game } = deps;
    server.register('loadout.view', z.object({}).strict(), async () => {
        const runtime = await game.loadoutAdapter.get();
        if (!runtime.ok) return { ok: false, error: { code: runtime.error.code, message: runtime.error.message } };
        return ok(buildLoadoutView(runtime.value));
    });
    server.register('loadout.dump', z.object({}).strict(), async () => {
        const dump = await game.loadoutAdapter.dump();
        if (!dump.ok) return { ok: false, error: { code: dump.error.code, message: dump.error.message } };
        const body = buildLoadoutDumpBody(dump.value, core.appVersion());
        core.logger.info('loadout', 'Exported raw loadout dump', {
            fileName: body.fileName,
            bytes: body.json.length,
            validation: dump.value.validation,
        });
        return ok(body);
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
        const result = await game.loadout.equipHardware(moduleConfigId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('loadout.equipSoftware', loadoutModuleSchema, async ({ moduleConfigId }) => {
        const result = await game.loadout.equipSoftware(moduleConfigId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('loadout.unequipSoftware', loadoutModuleSchema, async ({ moduleConfigId }) => {
        const result = await game.loadout.unequipSoftware(moduleConfigId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
