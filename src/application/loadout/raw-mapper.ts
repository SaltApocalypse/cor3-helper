import type { RawHardware, RawSoftware } from '../../contracts/loadout.js';
import type { HardwareDefinition, HardwareSlot, SoftwareAbility, SoftwareDefinition } from '../../domains/loadout/model.js';

const SLOT_MAP: Record<string, HardwareSlot> = {
    CPU: 'cpu', GPU: 'gpu', RAM: 'ram', PSU: 'psu',
};

function numberSpec(specs: Record<string, unknown> | undefined, key: string): number | undefined {
    const value = specs?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function mapRawHardware(item: RawHardware): HardwareDefinition | null {
    const slot = SLOT_MAP[item.category.toUpperCase()];
    if (!slot) return null;
    const specs = item.specs ?? {};
    const cpuFrequency = numberSpec(specs, 'cpuFrequency');
    const cpuCores = numberSpec(specs, 'cpuCores');
    const cpuConsuming = numberSpec(specs, 'cpuConsuming');
    const gpuPower = numberSpec(specs, 'gpuPower');
    const gpuMemory = numberSpec(specs, 'gpuMemory');
    const gpuConsuming = numberSpec(specs, 'gpuConsuming');
    const ramFrequency = numberSpec(specs, 'ramFrequency');
    const ramMemory = numberSpec(specs, 'ramMemory');
    const psuPower = numberSpec(specs, 'psuPower');
    const psuProtection = numberSpec(specs, 'psuProtection');
    return {
        id: item.id,
        name: item.name ?? item.id,
        slot,
        specs: {
            ...(cpuFrequency !== undefined ? { cpuFrequency } : {}),
            ...(cpuCores !== undefined ? { cpuCores } : {}),
            ...(cpuConsuming !== undefined ? { cpuConsuming } : {}),
            ...(gpuPower !== undefined ? { gpuPower } : {}),
            ...(gpuMemory !== undefined ? { gpuMemory } : {}),
            ...(gpuConsuming !== undefined ? { gpuConsuming } : {}),
            ...(ramFrequency !== undefined ? { ramFrequency } : {}),
            ...(ramMemory !== undefined ? { ramMemory } : {}),
            ...(psuPower !== undefined ? { psuPower } : {}),
            ...(psuProtection !== undefined ? { psuProtection } : {}),
        },
        ...(typeof item.image === 'string' && item.image.length > 0 ? { image: item.image } : {}),
        ...(typeof item.description === 'string' && item.description.length > 0 ? { description: item.description } : {}),
        ...(typeof item.itemVulnerability === 'number' ? { itemVulnerability: item.itemVulnerability } : {}),
    };
}

export function mapRawSoftware(item: RawSoftware): SoftwareDefinition {
    const specs = item.specs === undefined ? [] : Array.isArray(item.specs) ? item.specs : [item.specs];
    const abilities: SoftwareAbility[] = specs.flatMap((spec) => {
        if (!spec || typeof spec !== 'object') return [];
        const entry = spec as { type?: unknown; power?: unknown; serverTypes?: unknown; fileTypes?: unknown };
        if (entry.type !== 'HACK' && entry.type !== 'DECRYPT' && entry.type !== 'SEARCH') return [];
        const power = Array.isArray(entry.power) ? entry.power : [];
        if (power.length < 2 || typeof power[0] !== 'number' || typeof power[1] !== 'number') return [];
        return [{
            type: entry.type,
            minPower: power[0],
            maxPower: power[1],
            ...(Array.isArray(entry.serverTypes) ? { serverTypes: entry.serverTypes.filter((value): value is string => typeof value === 'string') } : {}),
            ...(Array.isArray(entry.fileTypes) ? { fileTypes: entry.fileTypes.filter((value): value is string => typeof value === 'string') } : {}),
        }];
    });
    return {
        id: item.id,
        name: item.name ?? item.id,
        abilities,
        consuming: item.consuming ?? {},
        ...(typeof item.tier === 'number' ? { tier: item.tier } : {}),
        ...(typeof item.manufacturer === 'string' && item.manufacturer.length > 0 ? { manufacturer: item.manufacturer } : {}),
        ...(typeof item.image === 'string' && item.image.length > 0 ? { image: item.image } : {}),
        ...(typeof item.description === 'string' && item.description.length > 0 ? { description: item.description } : {}),
    };
}
