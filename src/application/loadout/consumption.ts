import { parseConsuming, RESOURCE_KEYS } from '../../domains/loadout/calculator.js';
import type { LoadoutSoftwareView } from './view.js';

export interface SoftwareConsumptionRow {
    readonly key: string;
    readonly unit: string;
    readonly min: number;
    readonly max: number;
    readonly base: number;
    readonly alloc: number | null;
}

const RESOURCE_UNIT: Record<string, string> = {
    cpu_frequency: 'GHz',
    cpu_cores: 'count',
    gpu_power: 'PFLOPS',
    gpu_memory: 'TB',
    ram_frequency: 'GHz',
    ram_memory: 'TB',
    psu_power: 'kW',
};

export const LOADOUT_RESOURCE_KEYS = [...RESOURCE_KEYS, 'psu_power'] as const;

/** Normalise software consumption for the loadout detail UI. */
export function softwareConsumptionRows(item: LoadoutSoftwareView): SoftwareConsumptionRow[] {
    return RESOURCE_KEYS.flatMap((key) => {
        const parsed = parseConsuming(item.consuming[key]);
        if (!parsed) return [];
        const noAlloc = key === 'cpu_frequency' || key === 'ram_frequency';
        return [{
            key,
            unit: RESOURCE_UNIT[key] ?? '',
            min: parsed.min,
            max: parsed.max,
            base: parsed.base,
            alloc: noAlloc ? null : parsed.base,
        }];
    });
}
