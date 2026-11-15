import type { LoadoutApplyPort, LoadoutRuntimePort, LoadoutRuntime } from '../../application/loadout/ports.js';
import type { GameError } from '../../application/game/ports.js';
import { unwrapTabResult } from './tab-response.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';
import { rawLoadoutSchema } from '../../contracts/loadout.js';
import { mapRawLoadout } from '../game-ws/loadout-mapper.js';
import { loadStaticCatalog } from './static-catalog.js';
import { mergeCatalogs } from '../../application/catalog/catalog.js';

export class ChromeTabLoadoutAdapter implements LoadoutRuntimePort, LoadoutApplyPort {
    private pendingGet: Promise<Result<LoadoutRuntime, GameError>> | null = null;

    constructor(
        private readonly tabs: TabMessagePort,
        private readonly clock: { now(): number } = { now: () => Date.now() },
    ) {}

    /**
     * The game socket hub allows one pending request per event:action. Multiple
     * automations asking for the loadout at the same time used to fail with
     * "Request already pending: loadout:get.options"; share the in-flight read.
     */
    get(): Promise<Result<LoadoutRuntime, GameError>> {
        if (this.pendingGet) return this.pendingGet;
        const pending = this.read();
        this.pendingGet = pending;
        return pending.finally(() => {
            if (this.pendingGet === pending) this.pendingGet = null;
        });
    }

    private async read(): Promise<Result<LoadoutRuntime, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_LOADOUT_GET' });
            const result = unwrapTabResult(response, { code: 'LOADOUT_COMMAND_FAILED', message: 'Loadout command failed' });
            if (!result.ok) return result;
            const parsed = rawLoadoutSchema.safeParse(result.value);
            if (!parsed.success) return err({ code: 'LOADOUT_INVALID', message: 'Loadout data failed schema validation' });
            const mapped = mapRawLoadout(parsed.data, this.clock.now());
            const staticCatalog = await loadStaticCatalog();
            return ok({ ...mapped, catalog: mergeCatalogs(mapped.catalog, staticCatalog) });
        } catch (error) {
            return err({ code: 'LOADOUT_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    equipHardware(id: string): Promise<Result<void, GameError>> {
        return this.command('V2_EQUIP_HARDWARE', id);
    }

    equipSoftware(id: string): Promise<Result<void, GameError>> {
        return this.command('V2_EQUIP_SOFTWARE', id);
    }

    unequipSoftware(id: string): Promise<Result<void, GameError>> {
        return this.command('V2_UNEQUIP_SOFTWARE', id);
    }

    private async command(type: string, moduleConfigId: string): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type, moduleConfigId });
            const result = unwrapTabResult(response, { code: 'LOADOUT_COMMAND_FAILED', message: 'Loadout command failed' });
            return result.ok ? ok(undefined) : result;
        } catch (error) {
            return err({ code: 'LOADOUT_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

}
