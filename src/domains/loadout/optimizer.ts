import type {
    AbilityType,
    HardwareDefinition,
    HardwareSet,
    HardwareSlot,
    ItemCatalog,
    InventorySnapshot,
    LoadoutPlan,
    SoftwareDefinition,
} from './model.js';
import { matchesTargetValue } from './model.js';
import { abilityPower, calculateLoadout, hardwareSwitchCost } from './calculator.js';
import { MaxPowerPsuPolicy, MinPowerPsuPolicy, type PsuPolicyContext, type PsuSelectionPolicy } from './psu-policy.js';

export interface LoadoutOptimizationRequest {
    readonly catalog: ItemCatalog;
    readonly inventory: InventorySnapshot;
    readonly ability: AbilityType;
    readonly target: string;
    readonly requiredPower?: number;
    readonly currentHardware?: Partial<Record<HardwareSlot, string>>;
    readonly currentSoftwareIds?: readonly string[];
    readonly policy?: PsuSelectionPolicy;
    /** Use any owned software with the requested ability when no target match exists. */
    readonly fallbackToAnyAbility?: boolean;
    /** 'best' keeps current sufficient hardware, otherwise maximizes power; 'weakest' minimizes power. */
    readonly strategy?: 'best' | 'weakest';
}

export type LoadoutInfeasibleReason =
    | 'NO_SOFTWARE'
    | 'NO_HARDWARE'
    | 'NO_BOOTABLE_COMBINATION';

export interface LoadoutOptimizationResult {
    readonly feasible: boolean;
    readonly plan: LoadoutPlan | null;
    readonly reason: LoadoutInfeasibleReason | null;
    /** True when the candidate software came from fallbackToAnyAbility. */
    readonly fallbackUsed: boolean;
}

const SLOTS: readonly HardwareSlot[] = ['cpu', 'gpu', 'ram', 'psu'];

function matchesTarget(sw: SoftwareDefinition, ability: AbilityType, target: string): boolean {
    return sw.abilities.some((candidate) => {
        if (candidate.type !== ability) return false;
        const hasServer = Array.isArray(candidate.serverTypes) && candidate.serverTypes.length > 0;
        const hasFile = Array.isArray(candidate.fileTypes) && candidate.fileTypes.length > 0;
        if (!hasServer && !hasFile) return true;
        return (hasServer && candidate.serverTypes?.some((value) => matchesTargetValue(value, target)) === true) ||
            (hasFile && candidate.fileTypes?.some((value) => matchesTargetValue(value, target)) === true);
    });
}

function ownedHardware(catalog: ItemCatalog, inventory: InventorySnapshot): Record<HardwareSlot, HardwareDefinition[]> {
    const byId = new Map(catalog.hardware.map((item) => [item.id, item]));
    const current = inventory.equippedHardware;
    const result: Record<HardwareSlot, HardwareDefinition[]> = { cpu: [], gpu: [], ram: [], psu: [] };
    for (const item of catalog.hardware) {
        if (inventory.ownedHardwareIds.has(item.id)) result[item.slot].push(item);
    }
    for (const slot of SLOTS) {
        const id = current[slot];
        if (!id) continue;
        const item = byId.get(id);
        if (item && !result[slot].some((candidate) => candidate.id === item.id)) result[slot].push(item);
    }
    return result;
}

function effectivePolicy(strategy: 'best' | 'weakest', requested?: PsuSelectionPolicy): PsuSelectionPolicy {
    if (strategy === 'weakest') return new MinPowerPsuPolicy();
    return requested ?? new MaxPowerPsuPolicy();
}

function policyContext(currentHardware: Partial<Record<HardwareSlot, string>>): PsuPolicyContext {
    return currentHardware.psu ? { currentPsuId: currentHardware.psu } : {};
}

export function optimizeLoadout(request: LoadoutOptimizationRequest): LoadoutOptimizationResult {
    const requiredPower = request.requiredPower ?? 0;
    const hardware = ownedHardware(request.catalog, request.inventory);
    let software = request.catalog.software.filter((item) =>
        request.inventory.ownedSoftwareIds.has(item.id) && matchesTarget(item, request.ability, request.target),
    );
    let fallbackUsed = false;
    if (software.length === 0 && request.fallbackToAnyAbility) {
        software = request.catalog.software.filter((item) =>
            request.inventory.ownedSoftwareIds.has(item.id) && item.abilities.some((ability) => ability.type === request.ability),
        );
        fallbackUsed = software.length > 0;
    }
    if (software.length === 0) return { feasible: false, plan: null, reason: 'NO_SOFTWARE', fallbackUsed: false };
    if (SLOTS.some((slot) => hardware[slot].length === 0)) return { feasible: false, plan: null, reason: 'NO_HARDWARE', fallbackUsed };

    const currentSoftwareIds = request.currentSoftwareIds ?? request.inventory.equippedSoftwareIds;
    const currentHardware = request.currentHardware ?? request.inventory.equippedHardware;
    const strategy = request.strategy ?? 'best';
    const policy = effectivePolicy(strategy, request.policy);
    const context = policyContext(currentHardware);
    const better = (plan: LoadoutPlan, incumbent: LoadoutPlan): boolean => isBetterPlan(plan, incumbent, {
        requiredPower,
        strategy,
        policy,
        context,
        currentSoftwareIds,
    });
    let best: LoadoutPlan | null = null;

    for (const sw of software) {
        let bestSoftwarePlan: LoadoutPlan | null = null;
        for (const cpu of hardware.cpu) {
            const cpuDraw = cpu.specs.cpuConsuming ?? 0;
            for (const gpu of hardware.gpu) {
                const requiredPsuPower = cpuDraw + (gpu.specs.gpuConsuming ?? 0);
                for (const psu of hardware.psu) {
                    // A PSU below the CPU+GPU draw can never boot this pair.
                    // Skip the expensive loadout analysis for those candidates.
                    if ((psu.specs.psuPower ?? 0) < requiredPsuPower) continue;
                    for (const ram of hardware.ram) {
                        const set: HardwareSet = { cpu, gpu, ram, psu };
                        const analysis = calculateLoadout(set, [sw]);
                        if (!analysis.canBoot) continue;
                        const power = abilityPower(analysis, sw.id, request.ability, request.target);
                        const plan: LoadoutPlan = {
                            software: sw,
                            hardware: set,
                            ability: request.ability,
                            target: request.target,
                            power,
                            requiredPower,
                            feasible: requiredPower === 0 || power >= requiredPower,
                            switchCost: hardwareSwitchCost(currentHardware, set),
                            policyId: policy.id,
                            policyVersion: policy.version,
                        };
                        if (!bestSoftwarePlan || better(plan, bestSoftwarePlan)) {
                            bestSoftwarePlan = plan;
                        }
                    }
                }
            }
        }
        if (bestSoftwarePlan && (!best || better(bestSoftwarePlan, best))) {
            best = bestSoftwarePlan;
        }
    }

    if (best) {
        // "best" keeps the current hardware when it is already sufficient.
        // Only a plan that actually needs a hardware change is re-ranked by
        // the max-power PSU policy.
        const keepCurrentHardware = strategy === 'best' && best.switchCost === 0;
        if (!keepCurrentHardware) best = applyPsuPolicy(best, hardware.psu, policy, currentHardware, context);
    }
    return best
        ? { feasible: best.feasible, plan: best, reason: null, fallbackUsed }
        : { feasible: false, plan: null, reason: 'NO_BOOTABLE_COMBINATION', fallbackUsed };
}

interface BetterContext {
    readonly requiredPower: number;
    readonly strategy: 'best' | 'weakest';
    readonly policy: PsuSelectionPolicy;
    readonly context: PsuPolicyContext;
    readonly currentSoftwareIds: readonly string[];
}

function isCurrentSoftware(softwareId: string, currentSoftwareIds: readonly string[]): boolean {
    return currentSoftwareIds.length === 1 && currentSoftwareIds[0] === softwareId;
}

function isBetterPlan(plan: LoadoutPlan, best: LoadoutPlan, ctx: BetterContext): boolean {
    if (ctx.requiredPower > 0 && plan.feasible !== best.feasible) return plan.feasible;

    const planCurrent = isCurrentSoftware(plan.software.id, ctx.currentSoftwareIds);
    const bestCurrent = isCurrentSoftware(best.software.id, ctx.currentSoftwareIds);
    const planCurrentHardware = plan.switchCost === 0;
    const bestCurrentHardware = best.switchCost === 0;

    if (ctx.strategy === 'best') {
        // Job-driven loadouts should not churn hardware when the current
        // hardware can already run the target software.
        if (planCurrentHardware !== bestCurrentHardware) return planCurrentHardware;

        if (planCurrentHardware) {
            // Keep the current software first; if neither candidate is the
            // current module, prefer the higher-power result.
            if (planCurrent !== bestCurrent) return planCurrent;
            if (plan.power !== best.power) return plan.power > best.power;
            const psuCmp = ctx.policy.compare(plan.hardware.psu, best.hardware.psu, ctx.context);
            return psuCmp > 0;
        }

        // A hardware change is required: "best" means the highest power
        // available, with the max-power PSU policy as the tie-break.
        if (plan.power !== best.power) return plan.power > best.power;
        if (planCurrent !== bestCurrent) return planCurrent;
        if (plan.switchCost !== best.switchCost) return plan.switchCost < best.switchCost;
        const psuCmp = ctx.policy.compare(plan.hardware.psu, best.hardware.psu, ctx.context);
        return psuCmp > 0;
    }

    // Weakest mode prefers the smallest PSU even when that means switching
    // hardware, so PSU ranking comes before switch cost.
    if (plan.power !== best.power) return plan.power < best.power;
    const psuCmp = ctx.policy.compare(plan.hardware.psu, best.hardware.psu, ctx.context);
    if (psuCmp !== 0) return psuCmp > 0;
    if (planCurrent !== bestCurrent) return planCurrent;
    if (plan.switchCost !== best.switchCost) return plan.switchCost < best.switchCost;
    return false;
}

/**
 * Re-selects the PSU for the chosen CPU/GPU/RAM/software through the policy.
 * All psuPower ranking stays inside PsuSelectionPolicy (D-007), and the best
 * and weakest strategies use the same post-processing hook.
 */
function applyPsuPolicy(
    plan: LoadoutPlan,
    psus: readonly HardwareDefinition[],
    policy: PsuSelectionPolicy,
    currentHardware: Partial<Record<HardwareSlot, string>>,
    context: PsuPolicyContext,
): LoadoutPlan {
    let selected: HardwareDefinition | null = null;
    const requiredPsuPower = (plan.hardware.cpu.specs.cpuConsuming ?? 0) + (plan.hardware.gpu.specs.gpuConsuming ?? 0);
    for (const psu of psus) {
        if ((psu.specs.psuPower ?? 0) < requiredPsuPower) continue;
        const set: HardwareSet = { ...plan.hardware, psu };
        if (!calculateLoadout(set, [plan.software]).canBoot) continue;
        if (selected === null || policy.compare(psu, selected, context) > 0) selected = psu;
    }
    if (selected === null) return plan;
    const set: HardwareSet = { ...plan.hardware, psu: selected };
    const analysis = calculateLoadout(set, [plan.software]);
    const power = abilityPower(analysis, plan.software.id, plan.ability, plan.target);
    return {
        ...plan,
        hardware: set,
        power,
        feasible: plan.requiredPower === 0 || power >= plan.requiredPower,
        switchCost: hardwareSwitchCost(currentHardware, set),
    };
}
