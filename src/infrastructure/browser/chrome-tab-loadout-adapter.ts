import type { LoadoutApplyPort, LoadoutRuntimePort, LoadoutRuntime } from '../../application/loadout/ports.js';
import type { GameError } from '../../application/game/ports.js';
import { unwrapTabResult } from './tab-response.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';
import { rawLoadoutSchema } from '../../contracts/loadout.js';
import { mapRawHardware, mapRawSoftware } from '../../application/loadout/raw-mapper.js';
import { mapRawLoadout } from '../game-ws/loadout-mapper.js';
import { loadStaticCatalog } from './static-catalog.js';
import { mergeCatalogs } from '../../application/catalog/catalog.js';

export type LoadoutDumpValidation =
    | {
        readonly ok: true;
        readonly hardware: number;
        readonly software: number;
        readonly equippedHardware: number;
        readonly equippedSoftware: number;
        /** Owned hardware rows whose category/specs could not be mapped. */
        readonly unmappedHardware: readonly string[];
        /** Owned software rows that produced no usable ability. */
        readonly softwareWithoutAbilities: readonly string[];
    }
    | { readonly ok: false; readonly error: string };

export interface LoadoutDump {
    readonly capturedAt: number;
    /** The exact `loadout:get.options` payload, unmodified. */
    readonly raw: unknown;
    readonly validation: LoadoutDumpValidation;
}

export class ChromeTabLoadoutAdapter implements LoadoutRuntimePort, LoadoutApplyPort {
    private pendingRead: Promise<Result<{ readonly raw: unknown }, GameError>> | null = null;

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
        return this.read();
    }

    private async read(): Promise<Result<LoadoutRuntime, GameError>> {
        const read = await this.readRaw();
        if (!read.ok) return read;
        const parsed = rawLoadoutSchema.safeParse(read.value.raw);
        if (!parsed.success) return err({ code: 'LOADOUT_INVALID', message: 'Loadout data failed schema validation' });
        const mapped = mapRawLoadout(parsed.data, this.clock.now());
        const staticCatalog = await loadStaticCatalog();
        return ok({ ...mapped, catalog: mergeCatalogs(mapped.catalog, staticCatalog) });
    }

    /**
     * Raw read used by the devtools export. It deliberately keeps the payload
     * even when schema validation fails, so a shape change can still be
     * inspected instead of being replaced by "LOADOUT_INVALID".
     */
    async dump(): Promise<Result<LoadoutDump, GameError>> {
        const read = await this.readRaw();
        if (!read.ok) return read;
        const capturedAt = this.clock.now();
        const parsed = rawLoadoutSchema.safeParse(read.value.raw);
        if (!parsed.success) {
            return ok({ capturedAt, raw: read.value.raw, validation: { ok: false, error: parsed.error.message } });
        }
        const mapped = mapRawLoadout(parsed.data, capturedAt);
        const unmappedHardware = (parsed.data.ownedHardware ?? [])
            .filter((item) => mapRawHardware(item) === null)
            .map((item) => item.id);
        const softwareWithoutAbilities = (parsed.data.ownedSoftware ?? [])
            .filter((item) => mapRawSoftware(item).abilities.length === 0)
            .map((item) => item.id);
        return ok({
            capturedAt,
            raw: read.value.raw,
            validation: {
                ok: true,
                hardware: mapped.catalog.hardware.length,
                software: mapped.catalog.software.length,
                equippedHardware: Object.keys(mapped.inventory.equippedHardware).length,
                equippedSoftware: mapped.inventory.equippedSoftwareIds.length,
                unmappedHardware,
                softwareWithoutAbilities,
            },
        });
    }

    private readRaw(): Promise<Result<{ readonly raw: unknown }, GameError>> {
        if (this.pendingRead) return this.pendingRead;
        const pending = this.doReadRaw();
        this.pendingRead = pending;
        void pending.finally(() => {
            if (this.pendingRead === pending) this.pendingRead = null;
        });
        return pending;
    }

    private async doReadRaw(): Promise<Result<{ readonly raw: unknown }, GameError>> {
        try {
            const tabId = await this.tabs.findCor3Tab();
            if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
            const response = await this.tabs.send(tabId, { type: 'V2_LOADOUT_GET' });
            const result = unwrapTabResult(response, { code: 'LOADOUT_COMMAND_FAILED', message: 'Loadout command failed' });
            if (!result.ok) return result;
            return ok({ raw: result.value });
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
