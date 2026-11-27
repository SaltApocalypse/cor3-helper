import { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket } from '../../domains/expeditions/profiles.js';
import { isExpeditionReady, type ExpeditionOverview } from '../../domains/expeditions/model.js';
import { droneChargeSecondsForMission, type DroneMission, type DroneState } from '../../domains/drone/model.js';

export { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket };

export interface ExpeditionPartition {
    readonly active: readonly ExpeditionOverview['active'][number][];
    /** Ready-but-unpaid expeditions shown in the active stage list. */
    readonly completed: readonly ExpeditionOverview['active'][number][];
    /** Archived expeditions, shown in the collapsible history section. */
    readonly history: readonly ExpeditionOverview['active'][number][];
}

export function partitionExpeditions(overview: ExpeditionOverview | null): ExpeditionPartition {
    const unique = (entries: readonly ExpeditionOverview['active'][number][]) =>
        [...new Map(entries.map((entry) => [entry.id, entry])).values()];
    const active = unique(overview?.active ?? []);
    const archived = unique(overview?.archived ?? []);
    const activeIds = new Set(active.map((entry) => entry.id));
    const completedAt = (entry: ExpeditionOverview['active'][number]) =>
        entry.completedAt ? Date.parse(entry.completedAt) : Number.NaN;
    return {
        active: active.filter((entry) => !isExpeditionReady(entry)),
        completed: active.filter((entry) => isExpeditionReady(entry) && entry.containerOpenedAt === null),
        history: archived
            .filter((entry) => !activeIds.has(entry.id))
            .sort((left, right) => {
                const leftAt = completedAt(left);
                const rightAt = completedAt(right);
                return (Number.isFinite(rightAt) ? rightAt : 0) - (Number.isFinite(leftAt) ? leftAt : 0);
            }),
    };
}

export interface DroneCardState {
    readonly activeMission: DroneMission | null;
    readonly targetMission: DroneMission | null;
    readonly chargeSeconds: number | null;
    readonly nextAvailableAt: number | null;
    readonly needsCharge: boolean;
    readonly phase: 'destroyed' | 'maintenance' | 'working' | 'charging' | 'ready' | 'none';
}

export function buildDroneCardState(drone: DroneState | null, now: number): DroneCardState {
    const activeMission = drone?.activeMissionId
        ? drone.missions.find((mission) => mission.id === drone.activeMissionId) ?? null
        : null;
    const targetMission = drone?.missions.find((mission) =>
        mission.locationConfigId === DRONE_EXPEDITION_PROFILE.locationConfigId
        && (mission.missionConfigId === DRONE_EXPEDITION_PROFILE.missionConfigId || mission.id === DRONE_EXPEDITION_PROFILE.missionConfigId)) ?? null;
    const chargeSeconds = drone && targetMission ? droneChargeSecondsForMission(drone, targetMission) : null;
    const needsCharge = Boolean(drone?.drone
        && !drone.drone.repairing
        && !drone.activeMissionId
        && targetMission
        && drone.battery < targetMission.batteryCost);
    const basePhase: DroneCardState['phase'] = drone?.drone?.destroyed
        ? 'destroyed'
        : drone?.drone?.repairing
            ? 'maintenance'
            : drone?.activeMissionId
                ? 'working'
                : drone?.drone ? 'ready' : 'none';
    return {
        activeMission,
        targetMission,
        chargeSeconds,
        nextAvailableAt: chargeSeconds !== null ? now + chargeSeconds * 1000 : null,
        needsCharge,
        phase: basePhase === 'ready' && needsCharge ? 'charging' : basePhase,
    };
}
