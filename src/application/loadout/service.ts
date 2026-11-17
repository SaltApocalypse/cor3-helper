import type { LoadoutPlan, HardwareSlot } from '../../domains/loadout/model.js';
import { optimizeLoadout, type LoadoutOptimizationResult } from '../../domains/loadout/optimizer.js';
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
    /** True when some hardware/software commands succeeded before the failure. */
    readonly partial?: boolean;
}

export interface LoadoutCapability {
    readonly feasible: boolean;
    readonly reason: string | null;
}

// Fallback verification order when the current hardware is already the target
// or the current hardware specs are unavailable.
const SLOTS: readonly HardwareSlot[] = ['psu', 'cpu', 'gpu', 'ram'];
/**
 * The game applies loadout changes asynchronously. v1 spaced these commands by
 * 500-1500 ms; keeping a similar gap avoids bursting equip/unequip commands into
 * the same server rate-limit window during automatic job runs.
 */
const COMMAND_GAP_MS = 500;
const RATE_LIMIT_BACKOFF_MS = 3_000;
const VERIFY_ATTEMPTS = 4;
const VERIFY_GAP_MS = 300;
const CAPABILITY_TTL_MS = 5_000;
const MAX_CAPABILITY_ENTRIES = 64;
const PLAN_TTL_MS = 60_000;
const MAX_PLAN_ENTRIES = 32;

export interface LoadoutServiceOptions {
    readonly commandGapMs?: number;
    readonly rateLimitBackoffMs?: number;
}

function isRateLimitFailure(message: string): boolean {
    return /too many requests|rate[\s-]?limit|busy|processing|try again|cooldown/i.test(message);
}

function runtimeFingerprint(runtime: LoadoutRuntime): string {
    const inventory = runtime.inventory;
    return [
        runtime.catalog.catalogVersion,
        runtime.catalog.hardware.map((item) => `${item.id}:${item.specs.cpuConsuming ?? ''}/${item.specs.gpuConsuming ?? ''}/${item.specs.psuPower ?? ''}`).sort().join(','),
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
    const byId = new Map(catalog.hardware.map((item) => [item.id, item]));
    const currentCpu = inventory.equippedHardware.cpu ? byId.get(inventory.equippedHardware.cpu) : undefined;
    const currentGpu = inventory.equippedHardware.gpu ? byId.get(inventory.equippedHardware.gpu) : undefined;
    const currentPsu = inventory.equippedHardware.psu ? byId.get(inventory.equippedHardware.psu) : undefined;
    if (!currentCpu || !currentGpu || !currentPsu) {
        // Without current specs we cannot prove an intermediate PSU state is
        // safe. Replace the compute hardware before touching the PSU.
        return ['cpu', 'gpu', 'psu', 'ram'];
    }
    const currentCpuDraw = currentCpu.specs.cpuConsuming ?? 0;
    const currentGpuDraw = currentGpu.specs.gpuConsuming ?? 0;
    const targetCpuDraw = plan.hardware.cpu.specs.cpuConsuming ?? 0;
    const targetGpuDraw = plan.hardware.gpu.specs.gpuConsuming ?? 0;
    const currentDraw = currentCpuDraw + currentGpuDraw;
    const targetPsuPower = plan.hardware.psu.specs.psuPower ?? 0;
    const psuPower = currentPsu.specs.psuPower ?? 0;
    const psuUnchanged = inventory.equippedHardware.psu === plan.hardware.psu.id;

    // If the target PSU can power the current pair, installing it first is
    // safe. Once it is installed, still choose the CPU/GPU order against the
    // target PSU; the final pair fitting does not guarantee that a CPU-first
    // intermediate fits.
    const psuFirst = !psuUnchanged && targetPsuPower >= currentDraw;
    const planningPsuPower = psuFirst ? targetPsuPower : psuPower;

    // Replace the component that reduces intermediate draw first. This matters
    // when the active PSU is already at its limit: installing a higher-draw CPU
    // before lowering the GPU (or vice versa) fails with `not-enough-resources`
    // even though the final pair fits.
    const cpuFirstDraw = targetCpuDraw + currentGpuDraw;
    const gpuFirstDraw = currentCpuDraw + targetGpuDraw;
    const fits = (draw: number): boolean => planningPsuPower <= 0 || draw <= planningPsuPower;
    let order: HardwareSlot[];
    if (fits(cpuFirstDraw) && (!fits(gpuFirstDraw) || cpuFirstDraw <= gpuFirstDraw)) {
        order = ['cpu', 'gpu'];
    } else if (fits(gpuFirstDraw)) {
        order = ['gpu', 'cpu'];
    } else {
        order = cpuFirstDraw <= gpuFirstDraw ? ['cpu', 'gpu'] : ['gpu', 'cpu'];
    }
    return psuUnchanged || psuFirst ? ['psu', ...order, 'ram'] : [...order, 'psu', 'ram'];
}

export class LoadoutService {
    private readonly capabilityCache = new Map<string, { readonly at: number; readonly fingerprint: string; readonly value: LoadoutCapability }>();
    private readonly planCache = new Map<string, { readonly at: number; readonly fingerprint: string; readonly value: LoadoutOptimizationResult }>();
    private capabilityRuntime: { readonly at: number; readonly value: LoadoutRuntime } | null = null;
    private mutationQueue: Promise<unknown> = Promise.resolve();
    private mutationVersion = 0;
    private readonly commandGapMs: number;
    private readonly rateLimitBackoffMs: number;

    constructor(
        private readonly runtime: LoadoutRuntimePort,
        private readonly applier: LoadoutApplyPort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly trace?: (message: string, data?: unknown) => void,
        options: LoadoutServiceOptions = {},
    ) {
        this.commandGapMs = options.commandGapMs ?? COMMAND_GAP_MS;
        this.rateLimitBackoffMs = options.rateLimitBackoffMs ?? RATE_LIMIT_BACKOFF_MS;
    }

    /** Monotonic revision used by callers that cache "already ensured" results. */
    revision(): number {
        return this.mutationVersion;
    }

    private serialize<T>(run: () => Promise<T>): Promise<T> {
        const next = this.mutationQueue.then(run, run);
        this.mutationQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    private prunePlanCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.planCache) {
            if (now - entry.at >= PLAN_TTL_MS) this.planCache.delete(key);
        }
        while (this.planCache.size > MAX_PLAN_ENTRIES) {
            const oldest = this.planCache.keys().next().value;
            if (oldest === undefined) break;
            this.planCache.delete(oldest);
        }
    }

    private pruneCapabilityCache(): void {
        const now = Date.now();
        for (const [key, entry] of this.capabilityCache) {
            if (now - entry.at >= CAPABILITY_TTL_MS) this.capabilityCache.delete(key);
        }
        while (this.capabilityCache.size > MAX_CAPABILITY_ENTRIES) {
            const oldest = this.capabilityCache.keys().next().value;
            if (oldest === undefined) break;
            this.capabilityCache.delete(oldest);
        }
    }

    /**
     * Read-only capability check used before taking a job. It verifies that the
     * owned catalog/inventory can produce a bootable plan for the ability and
     * target, without equipping anything. Results are cached briefly because
     * automatic job runs ask the same question for every job.
     */
    async canSatisfy(request: LoadoutRequest): Promise<Result<LoadoutCapability, LoadoutServiceError>> {
        this.pruneCapabilityCache();
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
        const fallbackBlocked = optimized.fallbackUsed && request.requiredPower > 0;
        const value: LoadoutCapability = {
            feasible: optimized.feasible && optimized.plan !== null && !fallbackBlocked,
            reason: fallbackBlocked ? 'NO_SOFTWARE' : optimized.reason,
        };
        this.capabilityCache.set(key, { at: Date.now(), fingerprint, value });
        this.pruneCapabilityCache();
        return ok(value);
    }

    invalidate(): void {
        this.capabilityCache.clear();
        this.capabilityRuntime = null;
        this.mutationVersion += 1;
    }

    async ensure(request: LoadoutRequest): Promise<Result<LoadoutPlan, LoadoutServiceError>> {
        return this.serialize(() => this.ensureInternal(request));
    }

    async equipHardware(id: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.serialize(async () => {
            const result = await this.applier.equipHardware(id);
            this.invalidate();
            return result;
        });
    }

    async equipSoftware(id: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.serialize(async () => {
            const result = await this.applier.equipSoftware(id);
            this.invalidate();
            return result;
        });
    }

    async unequipSoftware(id: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.serialize(async () => {
            const result = await this.applier.unequipSoftware(id);
            this.invalidate();
            return result;
        });
    }

    private async ensureInternal(request: LoadoutRequest): Promise<Result<LoadoutPlan, LoadoutServiceError>> {
        const runtime = await this.runtime.get();
        if (!runtime.ok) {
            return err({ code: 'RUNTIME_UNAVAILABLE', message: runtime.error.message });
        }
        const strategy = request.strategy ?? 'best';
        const policy = policyFor(request);
        const fingerprint = runtimeFingerprint(runtime.value);
        const cacheKey = [
            request.ability,
            request.target.toLowerCase(),
            request.requiredPower,
            request.fallbackToAnyAbility === true ? 'fallback' : 'exact',
            strategy,
            policy.id,
            policy.version,
        ].join('|');
        const cached = this.planCache.get(cacheKey);
        let optimized: LoadoutOptimizationResult;
        if (cached && Date.now() - cached.at < PLAN_TTL_MS && cached.fingerprint === fingerprint) {
            optimized = cached.value;
        } else {
            optimized = optimizeLoadout({
                catalog: runtime.value.catalog,
                inventory: runtime.value.inventory,
                ability: request.ability,
                target: request.target,
                requiredPower: request.requiredPower,
                ...(request.fallbackToAnyAbility ? { fallbackToAnyAbility: true } : {}),
                strategy,
                policy,
            });
            this.planCache.set(cacheKey, { at: Date.now(), fingerprint, value: optimized });
            this.prunePlanCache();
        }
        if (!optimized.plan) {
            return err({ code: 'NO_PLAN', message: optimized.reason ?? 'No loadout plan' });
        }
        if (optimized.fallbackUsed && request.requiredPower > 0) {
            return err({ code: 'INFEASIBLE', message: 'Fallback software cannot satisfy a positive power requirement' });
        }
        if (!optimized.feasible) {
            return err({ code: 'INFEASIBLE', message: 'Best available loadout is still below the required power' });
        }
        const plan = optimized.plan;
        this.trace?.('Loadout plan selected', {
            ability: plan.ability,
            target: plan.target,
            strategy,
            policyId: plan.policyId,
            policyVersion: plan.policyVersion,
            fallbackToAnyAbility: request.fallbackToAnyAbility === true,
            fallbackUsed: optimized.fallbackUsed,
            requiredPower: plan.requiredPower,
            power: plan.power,
            software: plan.software.name,
            cpu: plan.hardware.cpu.name,
            gpu: plan.hardware.gpu.name,
            ram: plan.hardware.ram.name,
            psu: plan.hardware.psu.name,
            switchCost: plan.switchCost,
            keptCurrentHardware: sameHardware(plan, runtime.value.inventory.equippedHardware),
            currentCpu: runtime.value.inventory.equippedHardware.cpu ?? null,
            currentGpu: runtime.value.inventory.equippedHardware.gpu ?? null,
            currentRam: runtime.value.inventory.equippedHardware.ram ?? null,
            currentPsu: runtime.value.inventory.equippedHardware.psu ?? null,
            currentSoftware: runtime.value.inventory.equippedSoftwareIds,
        });
        if (sameHardware(plan, runtime.value.inventory.equippedHardware) &&
            hasSoftware(runtime.value.inventory, plan.software.id) &&
            runtime.value.inventory.equippedSoftwareIds.length === 1) {
            return ok(plan);
        }

        const applied = await this.apply(plan, runtime.value.inventory, runtime.value.catalog);
        if (!applied.ok) {
            // The applier may have already unequipped software or changed some
            // hardware before the failing step. Do not keep a capability
            // snapshot that describes the pre-failure hardware.
            this.invalidate();
            if (applied.error.partial) {
                this.trace?.('Loadout apply left a partial state; next run will re-read inventory', {
                    code: applied.error.code,
                    message: applied.error.message,
                });
            }
            return applied;
        }
        this.invalidate();
        const verified = await this.verifyWithRetry(plan);
        if (verified) return ok(plan);

        const current = await this.runtime.get();
        const retry = await this.apply(plan, current.ok ? current.value.inventory : runtime.value.inventory, current.ok ? current.value.catalog : runtime.value.catalog);
        if (!retry.ok) {
            this.invalidate();
            return retry;
        }
        this.invalidate();
        if (await this.verifyWithRetry(plan)) return ok(plan);
        this.invalidate();
        return err({ code: 'VERIFY_FAILED', message: 'Target software/hardware did not appear after apply' });
    }

    private async apply(
        plan: LoadoutPlan,
        inventory: { readonly equippedHardware: Partial<Record<HardwareSlot, string>>; readonly equippedSoftwareIds: readonly string[] },
        catalog: { readonly hardware: readonly { readonly id: string; readonly slot: HardwareSlot; readonly specs: { readonly cpuConsuming?: number; readonly gpuConsuming?: number; readonly psuPower?: number } }[] },
    ): Promise<Result<void, LoadoutServiceError>> {
        interface ApplyStep {
            readonly label: string;
            readonly data: Record<string, unknown>;
            readonly run: () => Promise<Result<void, { readonly code: string; readonly message: string }>>;
        }
        const steps: ApplyStep[] = [];
        // Unequip every software module before changing hardware. The game
        // validates the active software against the new hardware while the
        // swap is applied; keeping the target software equipped can make a
        // valid CPU/GPU plan fail with `not-enough-resources`.
        for (const softwareId of inventory.equippedSoftwareIds) {
            steps.push({
                label: 'unequip-software',
                data: { id: softwareId },
                run: () => this.applier.unequipSoftware(softwareId),
            });
        }
        for (const slot of hardwareOrder(plan, inventory, catalog)) {
            if (inventory.equippedHardware[slot] === plan.hardware[slot].id) continue;
            steps.push({
                label: `equip-${slot}`,
                data: { id: plan.hardware[slot].id, name: plan.hardware[slot].name },
                run: () => this.applier.equipHardware(plan.hardware[slot].id),
            });
        }
        // Every equipped software module was unequipped above, including the
        // target module. Always re-equip it after the hardware swap.
        steps.push({
            label: 'equip-software',
            data: { id: plan.software.id, name: plan.software.name },
            run: () => this.applier.equipSoftware(plan.software.id),
        });

        let mutated = false;
        try {
            for (let index = 0; index < steps.length; index += 1) {
                const step = steps[index]!;
                let result = await step.run();
                if (!result.ok && isRateLimitFailure(result.error.message)) {
                    this.trace?.('Loadout command rate-limited; backing off', {
                        step: step.label,
                        ...step.data,
                        message: result.error.message,
                    });
                    await this.sleep(this.rateLimitBackoffMs);
                    result = await step.run();
                }
                if (!result.ok) {
                    this.trace?.('Loadout step failed', {
                        step: step.label,
                        ...step.data,
                        message: result.error.message,
                    });
                    return err({ code: 'APPLY_FAILED', message: result.error.message, partial: mutated });
                }
                mutated = true;
                // No trailing sleep after the final command; verification reads
                // the fresh state immediately after the last mutation.
                if (index < steps.length - 1) await this.sleep(this.commandGapMs);
            }
            return ok(undefined);
        } catch (error) {
            return err({
                code: 'APPLY_FAILED',
                message: error instanceof Error ? error.message : String(error),
                partial: mutated,
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
