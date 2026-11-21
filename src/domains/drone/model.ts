export interface DroneStatus {
    readonly id: string;
    readonly name: string;
    readonly durability: number;
    readonly maxDurability: number;
    readonly battery: number;
    readonly maxBattery: number;
    readonly repairing: boolean;
    readonly destroyed: boolean;
    readonly repairSecondsRemaining: number | null;
}

export interface DroneMission {
    readonly id: string;
    readonly name: string;
    readonly batteryCost: number;
    readonly locationConfigId: string;
    readonly locationName: string;
    readonly missionConfigId: string;
    readonly risk: number;
    readonly durationSeconds: number;
}

export interface DroneState {
    readonly drone: DroneStatus | null;
    readonly battery: number;
    readonly maxBattery: number;
    readonly activeMissionId: string | null;
    readonly missions: readonly DroneMission[];
    readonly archived: readonly { readonly id: string; readonly name: string }[];
    /** Seconds until the battery is fully restored, when provided by the game. */
    readonly batteryRestoreSeconds?: number | null;
}

export function canLaunch(state: DroneState, mission: DroneMission): boolean {
    return state.drone !== null
        && state.activeMissionId === null
        && !state.drone.destroyed
        && !state.drone.repairing
        && state.battery >= mission.batteryCost;
}

function missionCandidates(
    state: DroneState,
    locationId: string | null,
    goalId: string | null,
): DroneMission[] {
    const exact = state.missions.filter((mission) =>
        (locationId === null || mission.locationConfigId === locationId)
        && (goalId === null || mission.id === goalId || mission.missionConfigId === goalId));
    if (exact.length > 0) return [...exact];
    // A stored goal/location can become stale when the game rotates missions.
    // Fall back to the same location, then to any mission, instead of silently
    // never launching again.
    const byLocation = locationId === null
        ? []
        : state.missions.filter((mission) => mission.locationConfigId === locationId);
    if (byLocation.length > 0) return [...byLocation];
    return [...state.missions];
}

export function cheapestDroneMission(
    state: DroneState,
    locationId: string | null = null,
    goalId: string | null = null,
): DroneMission | null {
    const candidates = missionCandidates(state, locationId, goalId);
    candidates.sort((left, right) =>
        left.batteryCost - right.batteryCost
        || left.risk - right.risk
        || left.durationSeconds - right.durationSeconds,
    );
    return candidates[0] ?? null;
}

export function droneChargeSecondsForMission(state: DroneState, mission: DroneMission): number | null {
    if (!state.drone || state.drone.repairing || state.activeMissionId) return null;
    if (state.battery >= mission.batteryCost) return 0;
    if (mission.batteryCost > state.maxBattery) return null;
    const restore = state.batteryRestoreSeconds ?? null;
    const capacity = state.maxBattery - state.battery;
    if (restore === null || restore <= 0 || capacity <= 0) return null;
    return Math.max(1, Math.ceil(restore * Math.min(1, (mission.batteryCost - state.battery) / capacity)));
}

export function droneNextAvailableSeconds(
    state: DroneState,
    locationId: string | null = null,
    goalId: string | null = null,
): number | null {
    if (!state.drone || state.drone.destroyed) return null;
    if (state.drone.repairing) return state.drone.repairSecondsRemaining;
    if (state.activeMissionId) return null;
    const mission = cheapestDroneMission(state, locationId, goalId);
    if (!mission) return null;
    return droneChargeSecondsForMission(state, mission);
}

export function droneRefreshDelayMs(
    state: DroneState | null,
    locationId: string | null = null,
    goalId: string | null = null,
): number {
    if (!state?.drone || state.drone.destroyed) return 5 * 60_000;
    if (state.drone.repairing) {
        const seconds = state.drone.repairSecondsRemaining;
        return seconds === null ? 60_000 : Math.min(30 * 60_000, Math.max(5_000, seconds * 1000 + 2_000));
    }
    if (state.activeMissionId) return 30_000;
    const charge = droneNextAvailableSeconds(state, locationId, goalId);
    if (charge !== null && charge > 0) {
        return Math.min(30 * 60_000, Math.max(15_000, charge * 1000 + 2_000));
    }
    return 60_000;
}

export function bestDroneMission(
    state: DroneState,
    locationId: string | null = null,
    goalId: string | null = null,
): DroneMission | null {
    const candidates = missionCandidates(state, locationId, goalId).filter((mission) => canLaunch(state, mission));
    candidates.sort((left, right) =>
        left.batteryCost - right.batteryCost
        || left.risk - right.risk
        || left.durationSeconds - right.durationSeconds,
    );
    return candidates[0] ?? null;
}

export type DroneDecisionPolicy = 'off' | 'veterans' | 'loot' | 'risk';

export interface DroneEventOption {
    readonly id: string;
    readonly label: string;
    readonly lootDelta: number;
    readonly riskDelta: number;
    /** Absolute risk when the game exposes it; used to derive the event baseline. */
    readonly risk?: number | null;
    readonly requiredModuleId: string | null;
}

export interface DroneMissionEvent {
    readonly missionId: string;
    readonly eventId: string;
    readonly type: string;
    readonly riskScore: number | null;
    readonly options: readonly DroneEventOption[];
}

export function chooseDroneEventOption(
    event: DroneMissionEvent,
    policy: DroneDecisionPolicy = 'loot',
): DroneEventOption | null {
    if (policy === 'off') return null;
    const usable = event.options.filter((option) => option.requiredModuleId === null);
    const pool = [...(usable.length > 0 ? usable : event.options)];
    pool.sort((left, right) => {
        if (policy === 'veterans') {
            return right.riskDelta - left.riskDelta || right.lootDelta - left.lootDelta;
        }
        if (policy === 'risk') {
            return left.riskDelta - right.riskDelta || right.lootDelta - left.lootDelta;
        }
        return right.lootDelta - left.lootDelta || left.riskDelta - right.riskDelta;
    });
    return pool[0] ?? null;
}

export interface DroneDecisionWeights {
    readonly loot: number;
    readonly risk: number;
}

export function droneEventScore(
    option: Pick<DroneEventOption, 'lootDelta' | 'riskDelta'>,
    riskScore: number | null,
    weights: DroneDecisionWeights,
): number {
    const baseRisk = riskScore ?? 0;
    return Math.round(
        (option.lootDelta * weights.loot)
        + (option.riskDelta * weights.risk * (((baseRisk + Math.abs(option.riskDelta)) / 10) || 1)),
    );
}

export function chooseScoredDroneEventOption(
    event: DroneMissionEvent,
    weights: DroneDecisionWeights,
): DroneEventOption | null {
    const usable = event.options.filter((option) => option.requiredModuleId === null);
    const pool = usable.length > 0 ? usable : event.options;
    let best: DroneEventOption | null = null;
    let bestScore = -Infinity;
    for (const option of pool) {
        const score = droneEventScore(option, event.riskScore, weights);
        if (score > bestScore) {
            best = option;
            bestScore = score;
        }
    }
    return best;
}

export interface DroneCompletedMission {
    readonly missionId: string;
    readonly lootCount: number;
}

export function isDroneRateLimited(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('too many requests')
        || normalized.includes('rate limit')
        || normalized.includes('rate-limited');
}
