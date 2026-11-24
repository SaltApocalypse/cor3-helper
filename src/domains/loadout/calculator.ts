import type { HardwareSet, SoftwareDefinition } from './model.js';
import { matchesTargetValue } from './model.js';

export const RESOURCE_KEYS = [
    'cpu_frequency', 'cpu_cores', 'gpu_power', 'gpu_memory', 'ram_frequency', 'ram_memory',
] as const;

export type ResourceKey = typeof RESOURCE_KEYS[number];

export interface ParsedConsuming {
    readonly base: number;
    readonly min: number;
    readonly max: number;
}

export interface AbilityAnalysis {
    readonly type: string;
    /** Integer power used for feasibility (floor of `rawPower`). */
    readonly computedPower: number;
    /** Unrounded power, kept for diagnostics and game parity checks. */
    readonly rawPower: number;
    readonly minPower: number;
    readonly maxPower: number;
    readonly serverTypes?: readonly string[];
    readonly fileTypes?: readonly string[];
}

export interface SoftwareAnalysis {
    readonly name: string;
    readonly ratio: number;
    readonly bottleneck: string | null;
    readonly abilities: readonly AbilityAnalysis[];
}

export interface LoadoutAnalysis {
    readonly supply: Partial<Record<ResourceKey | 'psu_power', number>>;
    readonly demand: Partial<Record<ResourceKey | 'psu_total', number>>;
    readonly canBoot: boolean;
    readonly software: Readonly<Record<string, SoftwareAnalysis>>;
}

export function parseConsuming(values: readonly number[] | undefined): ParsedConsuming | null {
    if (!values || values.length < 2) return null;
    if (values.length === 2) return { base: 0, min: values[0] ?? 0, max: values[1] ?? 0 };
    return { base: values[0] ?? 0, min: values[1] ?? 0, max: values[2] ?? 0 };
}

export function calculateLoadout(hardware: HardwareSet, software: readonly SoftwareDefinition[]): LoadoutAnalysis {
    const supply: Partial<Record<ResourceKey | 'psu_power', number>> = {
        cpu_frequency: hardware.cpu.specs.cpuFrequency ?? 0,
        cpu_cores: hardware.cpu.specs.cpuCores ?? 0,
        gpu_power: hardware.gpu.specs.gpuPower ?? 0,
        gpu_memory: hardware.gpu.specs.gpuMemory ?? 0,
        ram_frequency: hardware.ram.specs.ramFrequency ?? 0,
        ram_memory: hardware.ram.specs.ramMemory ?? 0,
        psu_power: hardware.psu.specs.psuPower ?? 0,
    };

    const parsed: Record<string, Record<string, ParsedConsuming>> = {};
    for (const sw of software) {
        parsed[sw.id] = {};
        for (const key of RESOURCE_KEYS) {
            const value = parseConsuming(sw.consuming[key]);
            if (value) parsed[sw.id]![key] = value;
        }
    }

    const demand: Partial<Record<ResourceKey | 'psu_total', number>> = {};
    for (const key of RESOURCE_KEYS) {
        let base = 0;
        let uplift = 0;
        for (const sw of software) {
            const value = parsed[sw.id]?.[key];
            if (!value) continue;
            base += value.base;
            uplift = Math.max(uplift, value.min - value.base);
        }
        demand[key] = base + uplift;
    }
    demand.psu_total = (hardware.cpu.specs.cpuConsuming ?? 0) + (hardware.gpu.specs.gpuConsuming ?? 0);

    let canBoot = true;
    for (const key of RESOURCE_KEYS) {
        if ((supply[key] ?? 0) < (demand[key] ?? 0)) { canBoot = false; break; }
    }
    if (canBoot && (supply.psu_power ?? 0) < (demand.psu_total ?? 0)) canBoot = false;

    const analysis: Record<string, SoftwareAnalysis> = {};
    for (const sw of software) {
        let lowestRatio = 1;
        let bottleneck: string | null = null;
        for (const key of RESOURCE_KEYS) {
            const value = parsed[sw.id]?.[key];
            if (!value) continue;
            let otherBase = 0;
            for (const other of software) {
                if (other.id === sw.id) continue;
                otherBase += parsed[other.id]?.[key]?.base ?? 0;
            }
            const available = (supply[key] ?? 0) - otherBase;
            const ratio = value.max > value.min
                ? Math.max(0, Math.min(1, (available - value.min) / (value.max - value.min)))
                : available >= value.min ? 1 : 0;
            if (ratio < lowestRatio || (ratio === lowestRatio && bottleneck === null)) {
                lowestRatio = ratio;
                bottleneck = key;
            }
        }
        analysis[sw.id] = {
            name: sw.name,
            ratio: lowestRatio,
            bottleneck,
            abilities: sw.abilities.map((ability) => {
                const rawPower = ability.minPower + lowestRatio * (ability.maxPower - ability.minPower);
                return {
                    type: ability.type,
                    computedPower: Math.floor(rawPower),
                    rawPower,
                    minPower: ability.minPower,
                    maxPower: ability.maxPower,
                    ...(ability.serverTypes ? { serverTypes: ability.serverTypes } : {}),
                    ...(ability.fileTypes ? { fileTypes: ability.fileTypes } : {}),
                };
            }),
        };
    }

    return { supply, demand, canBoot, software: analysis };
}

export interface AbilityPower {
    readonly power: number;
    readonly rawPower: number;
}

export function abilityPowerDetails(
    analysis: LoadoutAnalysis,
    softwareId: string,
    abilityType: string,
    target?: string,
): AbilityPower {
    const software = analysis.software[softwareId];
    if (!software) return { power: 0, rawPower: 0 };
    let best: AbilityPower = { power: 0, rawPower: 0 };
    for (const ability of software.abilities) {
        if (ability.type !== abilityType) continue;
        if (target) {
            const hasServer = Array.isArray(ability.serverTypes) && ability.serverTypes.length > 0;
            const hasFile = Array.isArray(ability.fileTypes) && ability.fileTypes.length > 0;
            const matches = (!hasServer && !hasFile) ||
                (hasServer && ability.serverTypes?.some((value) => matchesTargetValue(value, target)) === true) ||
                (hasFile && ability.fileTypes?.some((value) => matchesTargetValue(value, target)) === true);
            if (!matches) continue;
        }
        if (ability.computedPower > best.power) {
            best = { power: ability.computedPower, rawPower: ability.rawPower };
        }
    }
    return best;
}

export function abilityPower(
    analysis: LoadoutAnalysis,
    softwareId: string,
    abilityType: string,
    target?: string,
): number {
    return abilityPowerDetails(analysis, softwareId, abilityType, target).power;
}

export function hardwareSwitchCost(current: Partial<Record<string, string>>, next: HardwareSet): number {
    let count = 0;
    for (const slot of ['cpu', 'gpu', 'ram', 'psu'] as const) {
        if (current[slot] !== next[slot].id) count++;
    }
    return count;
}
