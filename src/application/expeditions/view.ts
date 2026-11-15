import { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket } from '../../domains/expeditions/profiles.js';
import { isExpeditionReady, type ExpeditionOverview } from '../../domains/expeditions/model.js';
import { droneChargeSecondsForMission, type DroneMission, type DroneState } from '../../domains/drone/model.js';

export { DRONE_EXPEDITION_PROFILE, MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket };

export function partitionExpeditions(overview: ExpeditionOverview | null): {
    readonly active: readonly ExpeditionOverview['active'][number][];
    readonly completed: readonly ExpeditionOverview['active'][number][];
} {
    const all = [...(overview?.active ?? []), ...(overview?.archived ?? [])];
    const unique = [...new Map(all.map((entry) => [entry.id, entry])).values()];
    return {
        active: unique.filter((entry) => !isExpeditionReady(entry)),
        completed: unique.filter(isExpeditionReady),
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
