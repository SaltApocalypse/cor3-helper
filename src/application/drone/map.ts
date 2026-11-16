import { rawDroneArchivedSchema, rawDroneEventSchema, rawDroneOptionsSchema } from '../../contracts/drone.js';
import type { DroneMission, DroneState } from '../../domains/drone/model.js';

function normalizeDroneOptions(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const entry = value as { drone?: unknown; data?: unknown; options?: unknown; durability?: unknown; maxDurability?: unknown; activeMission?: unknown };
        if (Array.isArray(entry.drone)) return { ...value, drone: entry.drone[0] ?? null };
        if (Array.isArray(entry.activeMission)) return { ...value, activeMission: entry.activeMission[0] ?? null };
        if (entry.drone && typeof entry.drone === 'object') return value;
        if (entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)) return normalizeDroneOptions(entry.data);
        if (entry.options && typeof entry.options === 'object' && !Array.isArray(entry.options)) return normalizeDroneOptions(entry.options);
        if (typeof entry.durability === 'number' || typeof entry.maxDurability === 'number') return { ...value, drone: value };
        return value;
    }
    if (Array.isArray(value)) {
        // Some game builds return a bare mission/location list for get.options.
        const first = value[0] as Record<string, unknown> | undefined;
        if (first && (typeof first.missionConfigId === 'string' || typeof first.batteryCost === 'number')) {
            return { missions: value };
        }
        return { locations: value };
    }
    // A locked/not-yet-unlocked drone feature can return null. Treat it as an
    // empty payload so the UI can mark the feature unavailable instead of
    // surfacing a schema validation error.
    return {};
}

export function mapDroneState(optionsRaw: unknown, archivedRaw: unknown): DroneState | null {
    const parsed = rawDroneOptionsSchema.safeParse(normalizeDroneOptions(optionsRaw));
    if (!parsed.success) return null;
    const archived = rawDroneArchivedSchema.safeParse(archivedRaw);
    const drone = parsed.data.drone;
    const rawMissions = [
        ...(parsed.data.missions ?? []),
        ...(parsed.data.availableMissions ?? []),
        ...(parsed.data.locations ?? []).flatMap((location) =>
            (location.missions ?? []).map((mission) => ({
                ...mission,
                locationConfigId: mission.locationConfigId ?? location.id,
                risk: location.baseRisk,
            })),
        ),
    ];
    const locationNames = new Map((parsed.data.locations ?? []).map((location) => [location.id ?? '', location.name ?? location.id ?? 'Location']));
    const missions = rawMissions.map((mission) => ({
        id: mission.id ?? '',
        name: mission.name ?? mission.id ?? 'Mission',
        batteryCost: mission.batteryCost ?? 0,
        locationConfigId: mission.locationConfigId ?? '',
        locationName: locationNames.get(mission.locationConfigId ?? '') ?? 'Location',
        missionConfigId: mission.missionConfigId ?? mission.id ?? '',
        risk: typeof (mission as { risk?: unknown }).risk === 'number' ? (mission as { risk: number }).risk : 0,
        durationSeconds: mission.durationSeconds ?? 0,
    })).filter((mission) => mission.id.length > 0) satisfies DroneMission[];
    const activeMissionId = parsed.data.activeMissionId ?? parsed.data.activeMission?.id ?? null;
    const activeDrone = drone ?? parsed.data.activeMission?.drone ?? null;
    const batterySource = parsed.data.battery ?? activeDrone?.battery;
    return {
        drone: activeDrone ? {
            id: activeDrone.id ?? '',
            name: activeDrone.name ?? 'Drone',
            durability: activeDrone.durability ?? 0,
            maxDurability: activeDrone.maxDurability ?? 0,
            battery: batterySource?.current ?? 0,
            maxBattery: batterySource?.max ?? 0,
            repairing: activeDrone.isRepairing === true,
            destroyed: activeDrone.isDestroyed === true,
            repairSecondsRemaining: activeDrone.repairSecondsRemaining ?? null,
        } : null,
        battery: batterySource?.current ?? 0,
        maxBattery: batterySource?.max ?? 0,
        batteryRestoreSeconds: batterySource?.restoreSeconds ?? null,
        activeMissionId,
        missions,
        archived: (archived.success ? archived.data.items ?? [] : []).map((item) => ({
            id: item.id ?? '',
            name: item.name ?? item.id ?? 'Mission',
        })),
    };
}

import type { DroneMissionEvent } from '../../domains/drone/model.js';

export function mapDroneEvent(raw: unknown): DroneMissionEvent | null {
    const parsed = rawDroneEventSchema.safeParse(raw);
    if (!parsed.success) return null;
    const event = parsed.data.event;
    const options = event?.options ?? parsed.data.options ?? [];
    if (event && event.isResolvable === false) return null;
    if (event && event.isResolved === true) return null;
    return {
        missionId: parsed.data.missionId
            ?? event?.missionId
            ?? parsed.data.mission?.missionId
            ?? parsed.data.mission?.id
            ?? '',
        eventId: event?.eventId ?? parsed.data.eventId ?? '',
        type: event?.type ?? parsed.data.type ?? 'EVENT',
        options: options.map((option) => ({
            id: option.id ?? '',
            label: option.label ?? option.id ?? 'Option',
            lootDelta: option.lootDelta ?? option.effect?.lootDelta ?? 0,
            riskDelta: option.riskDelta ?? option.effect?.riskDelta ?? 0,
            requiredModuleId: option.requiredModuleId ?? null,
        })).filter((option) => option.id.length > 0),
    };
}


export function mapDroneCompleted(raw: unknown): import('../../domains/drone/model.js').DroneCompletedMission | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as { missionId?: unknown; loot?: unknown };
    if (typeof entry.missionId !== 'string' || entry.missionId.length === 0) return null;
    return {
        missionId: entry.missionId,
        lootCount: Array.isArray(entry.loot) ? entry.loot.length : 0,
    };
}
