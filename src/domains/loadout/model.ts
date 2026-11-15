export type HardwareSlot = 'cpu' | 'gpu' | 'ram' | 'psu';

export interface HardwareSpecs {
    readonly cpuFrequency?: number;
    readonly cpuCores?: number;
    readonly cpuConsuming?: number;
    readonly gpuPower?: number;
    readonly gpuMemory?: number;
    readonly gpuConsuming?: number;
    readonly ramFrequency?: number;
    readonly ramMemory?: number;
    readonly psuPower?: number;
    readonly psuProtection?: number;
}

export interface HardwareDefinition {
    readonly id: string;
    readonly name: string;
    readonly slot: HardwareSlot;
    readonly specs: HardwareSpecs;
    readonly image?: string;
    readonly description?: string;
    readonly itemVulnerability?: number;
}

export type AbilityType = 'HACK' | 'DECRYPT' | 'SEARCH';

export interface SoftwareAbility {
    readonly type: AbilityType;
    readonly minPower: number;
    readonly maxPower: number;
    readonly serverTypes?: readonly string[];
    readonly fileTypes?: readonly string[];
}

export interface SoftwareDefinition {
    readonly id: string;
    readonly name: string;
    readonly abilities: readonly SoftwareAbility[];
    readonly consuming: Readonly<Record<string, readonly number[]>>;
    readonly tier?: number;
    readonly manufacturer?: string;
    readonly image?: string;
    readonly description?: string;
}

export interface ItemCatalog {
    readonly catalogVersion: string;
    readonly gameVersion: string;
    readonly hardware: readonly HardwareDefinition[];
    readonly software: readonly SoftwareDefinition[];
}

export interface InventorySnapshot {
    readonly ownedHardwareIds: ReadonlySet<string>;
    readonly ownedSoftwareIds: ReadonlySet<string>;
    readonly equippedHardware: Partial<Record<HardwareSlot, string>>;
    readonly equippedSoftwareIds: readonly string[];
    readonly capturedAt: number;
}

export interface HardwareSet {
    readonly cpu: HardwareDefinition;
    readonly gpu: HardwareDefinition;
    readonly ram: HardwareDefinition;
    readonly psu: HardwareDefinition;
}

export interface LoadoutPlan {
    readonly software: SoftwareDefinition;
    readonly hardware: HardwareSet;
    readonly ability: AbilityType;
    readonly target: string;
    readonly power: number;
    readonly requiredPower: number;
    readonly feasible: boolean;
    readonly switchCost: number;
    readonly policyId: string;
    readonly policyVersion: number;
}

/**
 * Compares a software target against a requested target. File extensions may
 * be reported with or without a leading dot, and legacy payloads occasionally
 * differ in case, so comparisons are normalized.
 */
export function matchesTargetValue(value: string, target: string): boolean {
    const left = value.trim().toLowerCase();
    const right = target.trim().toLowerCase();
    if (left === right) return true;
    return left.replace(/^\./, '') === right.replace(/^\./, '');
}
