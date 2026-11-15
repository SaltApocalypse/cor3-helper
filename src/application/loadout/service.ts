import type { LoadoutPlan, HardwareSlot } from '../../domains/loadout/model.js';
import { optimizeLoadout } from '../../domains/loadout/optimizer.js';
import { MaxPowerPsuPolicy, MinPowerPsuPolicy } from '../../domains/loadout/psu-policy.js';
import type { AbilityType } from '../../domains/loadout/model.js';
import { err, ok, type Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import type { LoadoutApplyPort, LoadoutRuntime, LoadoutRuntimePort } from './ports.js';

export interface LoadoutRequest {
    readonly ability: AbilityType;
    readonly target: string;
    readonly requiredPower: number;
    readonly fallbackToAnyAbility?: boolean;
    readonly strategy?: 'best' | 'weakest';
}

export interface LoadoutServiceError {
    readonly code:
        | 'RUNTIME_UNAVAILABLE'
        | 'NO_PLAN'
        | 'INFEASIBLE'
        | 'APPLY_FAILED'
        | 'VERIFY_FAILED';
    readonly message: string;
}

export interface LoadoutCapability {
    readonly feasible: boolean;
    readonly reason: string | null;
}

// Install the PSU first: swapping a CPU/GPU before its power supply can fail
// with the game's "not-enough-resources" error even though the final plan is valid.
const SLOTS: readonly HardwareSlot[] = ['psu', 'cpu', 'gpu', 'ram'];
/**
 * The game applies loadout changes asynchronously. v1 spaced these commands by
 * 500-1500 ms; keeping a similar gap avoids bursting equip/unequip commands into
 * the same server rate-limit window during automatic job runs.
 */
const COMMAND_GAP_MS = 500;
const VERIFY_ATTEMPTS = 4;
const VERIFY_GAP_MS = 300;
const CAPABILITY_TTL_MS = 15_000;

function runtimeFingerprint(runtime: LoadoutRuntime): string {
    const inventory = runtime.inventory;
    return [
        runtime.catalog.catalogVersion,
        runtime.catalog.hardware.map((item) => item.id).sort().join(','),
        runtime.catalog.software.map((item) => item.id).sort().join(','),
        [...inventory.ownedHardwareIds].sort().join(','),
        [...inventory.ownedSoftwareIds].sort().join(','),
        inventory.equippedHardware.cpu ?? '',
        inventory.equippedHardware.gpu ?? '',
        inventory.equippedHardware.ram ?? '',
        inventory.equippedHardware.psu ?? '',
        [...inventory.equippedSoftwareIds].sort().join(','),
    ].join('|');
}

function sameHardware(plan: LoadoutPlan, equipped: Partial<Record<HardwareSlot, string>>): boolean {
    return SLOTS.every((slot) => equipped[slot] === plan.hardware[slot].id);
}

function hasSoftware(inventory: { readonly equippedSoftwareIds: readonly string[] }, id: string): boolean {
    return inventory.equippedSoftwareIds.includes(id);
}

function policyFor(request: LoadoutRequest): MaxPowerPsuPolicy | MinPowerPsuPolicy {
    return (request.strategy ?? 'best') === 'weakest' ? new MinPowerPsuPolicy() : new MaxPowerPsuPolicy();
}

/**
 * Hardware equip order matters: the game rejects a PSU that cannot power the
 * hardware currently installed. Install the PSU first only when it can power the
 * old CPU/GPU pair. Otherwise replace the component that lowers consumption
 * first, then the other one, then the PSU.
 */
function hardwareOrder(
    plan: LoadoutPlan,
    inventory: { readonly equippedHardware: Partial<Record<HardwareSlot, string>> },
    catalog: { readonly hardware: readonly { readonly id: string; readonly slot: HardwareSlot; readonly specs: { readonly cpuConsuming?: number; readonly gpuConsuming?: number; readonly psuPower?: number } }[] },
): readonly HardwareSlot[] {
    if (inventory.equippedHardware.psu === plan.hardware.psu.id) return SLOTS;
    const byId = new Map(catalog.hardware.map((item) => [item.id, item]));
    const currentCpu = inventory.equippedHardware.cpu ? byId.get(inventory.equippedHardware.cpu) : undefined;
    const currentGpu = inventory.equippedHardware.gpu ? byId.get(inventory.equippedHardware.gpu) : undefined;
    const currentDraw = (currentCpu?.specs.cpuConsuming ?? 0) + (currentGpu?.specs.gpuConsuming ?? 0);
    const targetPsuPower = plan.hardware.psu.specs.psuPower ?? 0;
    if (targetPsuPower >= currentDraw) return SLOTS;
    const currentCpuDraw = currentCpu?.specs.cpuConsuming ?? 0;
    const targetCpuDraw = plan.hardware.cpu.specs.cpuConsuming ?? 0;
    return targetCpuDraw <= currentCpuDraw
        ? ['cpu', 'gpu', 'psu', 'ram']
        : ['gpu', 'cpu', 'psu', 'ram'];
}

export class LoadoutService {
    private readonly capabilityCache = new Map<string, { readonly at: number; readonly fingerprint: string; readonly value: LoadoutCapability }>();
    private capabilityRuntime: { readonly at: number; readonly value: LoadoutRuntime } | null = null;

    constructor(
        private readonly runtime: LoadoutRuntimePort,
        private readonly applier: LoadoutApplyPort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly trace?: (message: string, data?: unknown) => void,
    ) {}

    /**
     * Read-only capability check used before taking a job. It verifies that the
     * owned catalog/inventory can produce a bootable plan for the ability and
     * target, without equipping anything. Results are cached briefly because
     * automatic job runs ask the same question for every job.
     */
    async canSatisfy(request: LoadoutRequest): Promise<Result<LoadoutCapability, LoadoutServiceError>> {
        const strategy = request.strategy ?? 'best';
        const policy = policyFor(request);
        const key = [
            request.ability,
            request.target.toLowerCase(),
            request.requiredPower,
            request.fallbackToAnyAbility === true ? 'fallback' : 'exact',
            strategy,
            policy.id,
            String(policy.version),
        ].join('|');
        const cached = this.capabilityCache.get(key);
        const freshRuntime = this.capabilityRuntime && Date.now() - this.capabilityRuntime.at < CAPABILITY_TTL_MS;
        const cachedFingerprint = freshRuntime ? runtimeFingerprint(this.capabilityRuntime!.value) : null;
        if (cached && freshRuntime && cached.fingerprint === cachedFingerprint) {
            return ok(cached.value);
        }
        const runtime = freshRuntime && !cached
            ? ok(this.capabilityRuntime!.value)
            : await this.runtime.get();
        if (!runtime.ok) {
            return err({ code: 'RUNTIME_UNAVAILABLE', message: runtime.error.message });
        }
        this.capabilityRuntime = { at: Date.now(), value: runtime.value };
        const fingerprint = runtimeFingerprint(runtime.value);
        const matching = this.capabilityCache.get(key);
        if (matching && matching.fingerprint === fingerprint && Date.now() - matching.at < CAPABILITY_TTL_MS) {
            return ok(matching.value);
        }
        const optimized = optimizeLoadout({
            catalog: runtime.value.catalog,
            inventory: runtime.value.inventory,
            ability: request.ability,
            target: request.target,
            requiredPower: request.requiredPower,
            ...(request.fallbackToAnyAbility ? { fallbackToAnyAbility: true } : {}),
            strategy,
            policy,
        });
        const value: LoadoutCapability = {
            feasible: optimized.feasible && optimized.plan !== null,
            reason: optimized.reason,
        };
        this.capabilityCache.set(key, { at: Date.now(), fingerprint, value });
        return ok(value);
    }

    invalidate(): void {
        this.capabilityCache.clear();
        this.capabilityRuntime = null;
    }

    async ensure(request: LoadoutRequest): Promise<Result<LoadoutPlan, LoadoutServiceError>> {
        const runtime = await this.runtime.get();
        if (!runtime.ok) {
            return err({ code: 'RUNTIME_UNAVAILABLE', message: runtime.error.message });
        }
        const strategy = request.strategy ?? 'best';
        const policy = policyFor(request);
        const optimized = optimizeLoadout({
            catalog: runtime.value.catalog,
            inventory: runtime.value.inventory,
            ability: request.ability,
            target: request.target,
            requiredPower: request.requiredPower,
            ...(request.fallbackToAnyAbility ? { fallbackToAnyAbility: true } : {}),
            strategy,
            policy,
        });
        if (!optimized.plan) {
            return err({ code: 'NO_PLAN', message: optimized.reason ?? 'No loadout plan' });
        }
        if (!optimized.feasible) {
            return err({ code: 'INFEASIBLE', message: 'Best available loadout is still below the required power' });
        }
        const plan = optimized.plan;
        this.trace?.('Loadout plan selected', {
            ability: plan.ability,
            target: plan.target,
            requiredPower: plan.requiredPower,
            power: plan.power,
            software: plan.software.name,
            cpu: plan.hardware.cpu.name,
            gpu: plan.hardware.gpu.name,
            ram: plan.hardware.ram.name,
            psu: plan.hardware.psu.name,
            switchCost: plan.switchCost,
        });
        if (sameHardware(plan, runtime.value.inventory.equippedHardware) &&
            hasSoftware(runtime.value.inventory, plan.software.id) &&
            runtime.value.inventory.equippedSoftwareIds.length === 1) {
            return ok(plan);
        }

        const applied = await this.apply(plan, runtime.value.inventory, runtime.value.catalog);
        if (!applied.ok) return applied;
        this.invalidate();
        const verified = await this.verifyWithRetry(plan);
        if (verified) return ok(plan);

        const current = await this.runtime.get();
        const retry = await this.apply(plan, current.ok ? current.value.inventory : runtime.value.inventory, current.ok ? current.value.catalog : runtime.value.catalog);
        if (!retry.ok) return retry;
        this.invalidate();
        if (await this.verifyWithRetry(plan)) return ok(plan);
        return err({ code: 'VERIFY_FAILED', message: 'Target software/hardware did not appear after apply' });
    }

    private async apply(
        plan: LoadoutPlan,
        inventory: { readonly equippedHardware: Partial<Record<HardwareSlot, string>>; readonly equippedSoftwareIds: readonly string[] },
        catalog: { readonly hardware: readonly { readonly id: string; readonly slot: HardwareSlot; readonly specs: { readonly cpuConsuming?: number; readonly gpuConsuming?: number; readonly psuPower?: number } }[] },
    ): Promise<Result<void, LoadoutServiceError>> {
        try {
            for (const softwareId of inventory.equippedSoftwareIds) {
                if (softwareId === plan.software.id) continue;
                const result = await this.applier.unequipSoftware(softwareId);
                if (!result.ok) {
                    this.trace?.('Loadout step failed', { step: 'unequip-software', id: softwareId, message: result.error.message });
                    return err({ code: 'APPLY_FAILED', message: result.error.message });
                }
                await this.sleep(COMMAND_GAP_MS);
            }
            for (const slot of hardwareOrder(plan, inventory, catalog)) {
                if (inventory.equippedHardware[slot] === plan.hardware[slot].id) continue;
                const result = await this.applier.equipHardware(plan.hardware[slot].id);
                if (!result.ok) {
                    this.trace?.('Loadout step failed', {
                        step: `equip-${slot}`,
                        id: plan.hardware[slot].id,
                        name: plan.hardware[slot].name,
                        message: result.error.message,
                    });
                    return err({ code: 'APPLY_FAILED', message: result.error.message });
                }
                await this.sleep(COMMAND_GAP_MS);
            }
            if (!inventory.equippedSoftwareIds.includes(plan.software.id)) {
                const result = await this.applier.equipSoftware(plan.software.id);
                if (!result.ok) {
                    this.trace?.('Loadout step failed', { step: 'equip-software', id: plan.software.id, name: plan.software.name, message: result.error.message });
                    return err({ code: 'APPLY_FAILED', message: result.error.message });
                }
                await this.sleep(COMMAND_GAP_MS);
            }
            return ok(undefined);
        } catch (error) {
            return err({
                code: 'APPLY_FAILED',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async verifyWithRetry(plan: LoadoutPlan): Promise<boolean> {
        for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
            if (await this.verify(plan)) return true;
            if (attempt < VERIFY_ATTEMPTS - 1) await this.sleep(VERIFY_GAP_MS);
        }
        return false;
    }

    private async verify(plan: LoadoutPlan): Promise<boolean> {
        const runtime = await this.runtime.get();
        if (!runtime.ok) return false;
        return sameHardware(plan, runtime.value.inventory.equippedHardware) &&
            runtime.value.inventory.equippedSoftwareIds.length === 1 &&
            runtime.value.inventory.equippedSoftwareIds[0] === plan.software.id;
    }
}
