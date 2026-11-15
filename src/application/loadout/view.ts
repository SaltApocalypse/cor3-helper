import type {
    HardwareDefinition,
    HardwareSlot,
    ItemCatalog,
    InventorySnapshot,
    SoftwareAbility,
} from '../../domains/loadout/model.js';
import { calculateLoadout } from '../../domains/loadout/calculator.js';
import type { LoadoutRuntime } from './ports.js';

export const LOADOUT_SLOTS: readonly HardwareSlot[] = ['cpu', 'gpu', 'ram', 'psu'];

export interface LoadoutHardwareView {
    readonly id: string;
    readonly name: string;
    readonly slot: HardwareSlot;
    readonly category: string;
    readonly specs: Readonly<Record<string, number>>;
    readonly equipped: boolean;
    readonly image?: string;
    readonly description?: string;
    readonly itemVulnerability?: number;
}

export interface LoadoutAbilityView {
    readonly type: string;
    readonly minPower: number;
    readonly maxPower: number;
    readonly serverTypes?: readonly string[];
    readonly fileTypes?: readonly string[];
    readonly computedPower?: number;
}

export interface LoadoutSoftwareView {
    readonly id: string;
    readonly name: string;
    readonly equipped: boolean;
    readonly consuming: Readonly<Record<string, readonly number[]>>;
    readonly abilities: readonly LoadoutAbilityView[];
    readonly ratio?: number;
    readonly bottleneck?: string | null;
    readonly tier?: number;
    readonly manufacturer?: string;
    readonly image?: string;
    readonly description?: string;
}

export interface LoadoutAnalysisView {
    readonly canBoot: boolean;
    readonly supply: Readonly<Record<string, number>>;
    readonly demand: Readonly<Record<string, number>>;
}

export interface LoadoutView {
    readonly catalogVersion: string;
    readonly gameVersion: string;
    readonly hardwareCount: number;
    readonly softwareCount: number;
    readonly ownedHardware: number;
    readonly ownedSoftware: number;
    readonly equippedHardware: Readonly<Record<string, string | undefined>>;
    readonly equippedSoftwareIds: readonly string[];
    readonly hardware: readonly LoadoutHardwareView[];
    readonly software: readonly LoadoutSoftwareView[];
    readonly analysis: LoadoutAnalysisView;
    readonly capturedAt: number;
}

function specsOf(item: HardwareDefinition): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(item.specs)) {
        if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    }
    return result;
}

function abilityView(ability: SoftwareAbility, computedPower?: number): LoadoutAbilityView {
    return {
        type: ability.type,
        minPower: ability.minPower,
        maxPower: ability.maxPower,
        ...(ability.serverTypes ? { serverTypes: ability.serverTypes } : {}),
        ...(ability.fileTypes ? { fileTypes: ability.fileTypes } : {}),
        ...(computedPower !== undefined ? { computedPower } : {}),
    };
}

function emptyHardwareSet(catalog: ItemCatalog, inventory: InventorySnapshot) {
    const fallback = (slot: HardwareSlot): HardwareDefinition => {
        const id = inventory.equippedHardware[slot];
        const known = id ? catalog.hardware.find((item) => item.id === id) : undefined;
        if (known) return known;
        return { id: `missing-${slot}`, name: slot.toUpperCase(), slot, specs: {} };
    };
    return {
        cpu: fallback('cpu'),
        gpu: fallback('gpu'),
        ram: fallback('ram'),
        psu: fallback('psu'),
    };
}

function numericRecord(source: Partial<Record<string, number | undefined>>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    }
    return result;
}

function analysisFor(runtime: LoadoutRuntime) {
    const { catalog, inventory } = runtime;
    const equippedSoftware = catalog.software.filter((item) => inventory.equippedSoftwareIds.includes(item.id));
    return calculateLoadout(emptyHardwareSet(catalog, inventory), equippedSoftware);
}

/**
 * Builds the complete, serializable loadout payload used by the popup. The
 * domain optimizer stays in the background; the UI only renders this view.
 */
export function buildLoadoutView(runtime: LoadoutRuntime): LoadoutView {
    const { catalog, inventory } = runtime;
    const analysis = analysisFor(runtime);
    const equippedHardware = inventory.equippedHardware;
    const hardware = catalog.hardware
        .map((item): LoadoutHardwareView => ({
            id: item.id,
            name: item.name,
            slot: item.slot,
            category: item.slot.toUpperCase(),
            specs: specsOf(item),
            equipped: equippedHardware[item.slot] === item.id,
            ...(item.image ? { image: item.image } : {}),
            ...(item.description ? { description: item.description } : {}),
            ...(item.itemVulnerability !== undefined ? { itemVulnerability: item.itemVulnerability } : {}),
        }))
        .sort((left, right) => LOADOUT_SLOTS.indexOf(left.slot) - LOADOUT_SLOTS.indexOf(right.slot) || left.name.localeCompare(right.name));
    const software = catalog.software
        .map((item): LoadoutSoftwareView => {
            const equipped = inventory.equippedSoftwareIds.includes(item.id);
            const swAnalysis = analysis.software[item.id];
            return {
                id: item.id,
                name: item.name,
                equipped,
                consuming: item.consuming,
                abilities: item.abilities.map((ability) => abilityView(
                    ability,
                    equipped ? swAnalysis?.abilities.find((entry) => entry.type === ability.type)?.computedPower : undefined,
                )),
                ...(equipped && swAnalysis ? { ratio: swAnalysis.ratio, bottleneck: swAnalysis.bottleneck } : {}),
                ...(item.tier !== undefined ? { tier: item.tier } : {}),
                ...(item.manufacturer ? { manufacturer: item.manufacturer } : {}),
                ...(item.image ? { image: item.image } : {}),
                ...(item.description ? { description: item.description } : {}),
            };
        })
        .sort((left, right) => Number(right.equipped) - Number(left.equipped) || left.name.localeCompare(right.name));
    return {
        catalogVersion: catalog.catalogVersion,
        gameVersion: catalog.gameVersion,
        hardwareCount: catalog.hardware.length,
        softwareCount: catalog.software.length,
        ownedHardware: inventory.ownedHardwareIds.size,
        ownedSoftware: inventory.ownedSoftwareIds.size,
        equippedHardware,
        equippedSoftwareIds: inventory.equippedSoftwareIds,
        hardware,
        software,
        analysis: {
            canBoot: analysis.canBoot,
            supply: numericRecord(analysis.supply),
            demand: numericRecord(analysis.demand),
        },
        capturedAt: inventory.capturedAt,
    };
}
