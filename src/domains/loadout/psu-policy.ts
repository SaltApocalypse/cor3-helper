import type { HardwareDefinition } from './model.js';

export interface PsuPolicyContext {
    readonly currentPsuId?: string;
}

export interface PsuSelectionPolicy {
    readonly id: string;
    readonly version: number;
    compare(a: HardwareDefinition, b: HardwareDefinition, context?: PsuPolicyContext): number;
}

/** Default policy: highest psuPower only; equal power keeps the current PSU. */
export class MaxPowerPsuPolicy implements PsuSelectionPolicy {
    readonly id = 'max-psu-power';
    readonly version = 2;

    compare(a: HardwareDefinition, b: HardwareDefinition, context?: PsuPolicyContext): number {
        const aPower = a.specs.psuPower ?? 0;
        const bPower = b.specs.psuPower ?? 0;
        if (aPower !== bPower) return aPower - bPower;
        return preferCurrent(a, b, context);
    }
}

/**
 * Weakest-plan policy: lowest psuPower that can still boot the plan. Equal
 * power still prefers the currently equipped PSU to avoid a pointless swap.
 */
export class MinPowerPsuPolicy implements PsuSelectionPolicy {
    readonly id = 'min-psu-power';
    readonly version = 1;

    compare(a: HardwareDefinition, b: HardwareDefinition, context?: PsuPolicyContext): number {
        const aPower = a.specs.psuPower ?? 0;
        const bPower = b.specs.psuPower ?? 0;
        if (aPower !== bPower) return bPower - aPower;
        return preferCurrent(a, b, context);
    }
}

function preferCurrent(a: HardwareDefinition, b: HardwareDefinition, context?: PsuPolicyContext): number {
    if (!context?.currentPsuId) return 0;
    if (a.id === context.currentPsuId && b.id !== context.currentPsuId) return 1;
    if (b.id === context.currentPsuId && a.id !== context.currentPsuId) return -1;
    return 0;
}
