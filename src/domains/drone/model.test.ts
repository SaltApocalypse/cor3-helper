import { describe, expect, it } from 'vitest';
import { bestDroneMission, chooseDroneEventOption, chooseScoredDroneEventOption, droneEventScore, droneNextAvailableSeconds, droneRefreshDelayMs, type DroneMission, type DroneMissionEvent, type DroneState } from './model.js';

const missions: readonly DroneMission[] = [
    {
        id: 'm1',
        name: 'Short',
        batteryCost: 10,
        locationConfigId: 'l1',
        locationName: 'Alpha',
        missionConfigId: 'mc1',
        risk: 1,
        durationSeconds: 60,
    },
    {
        id: 'm2',
        name: 'Long',
        batteryCost: 10,
        locationConfigId: 'l2',
        locationName: 'Beta',
        missionConfigId: 'mc2',
        risk: 1,
        durationSeconds: 120,
    },
];

const state: DroneState = {
    drone: {
        id: 'd1', name: 'Drone', durability: 100, maxDurability: 100,
        battery: 100, maxBattery: 100, repairing: false, destroyed: false, repairSecondsRemaining: null,
    },
    battery: 100,
    maxBattery: 100,
    activeMissionId: null,
    missions,
    archived: [],
};

const event: DroneMissionEvent = {
    missionId: 'm1',
    eventId: 'e1',
    type: 'HAZARD',
    riskScore: 0,
    options: [
        { id: 'fast', label: 'Fast', lootDelta: 2, riskDelta: 2, requiredModuleId: null },
        { id: 'safe', label: 'Safe', lootDelta: -1, riskDelta: -2, requiredModuleId: null },
        { id: 'loot', label: 'Loot', lootDelta: 3, riskDelta: 1, requiredModuleId: null },
    ],
};

describe('drone decisions', () => {
    it('does not resolve when the policy is off', () => {
        expect(chooseDroneEventOption(event, 'off')).toBeNull();
    });

    it('uses the configured decision priority', () => {
        expect(chooseDroneEventOption(event, 'veterans')?.id).toBe('fast');
        expect(chooseDroneEventOption(event, 'loot')?.id).toBe('loot');
        expect(chooseDroneEventOption(event, 'risk')?.id).toBe('safe');
    });

    it('scores drone options with the v1 loot/risk defaults and keeps the first tie', () => {
        const weights = { loot: 3, risk: -2 };
        expect(droneEventScore(event.options[0]!, event.riskScore, weights)).toBe(5);
        expect(chooseScoredDroneEventOption(event, weights)?.id).toBe('loot');
        const tied: DroneMissionEvent = {
            ...event,
            options: [
                { id: 'first', label: 'First', lootDelta: 1, riskDelta: 1, requiredModuleId: null },
                { id: 'second', label: 'Second', lootDelta: 1, riskDelta: 1, requiredModuleId: null },
            ],
        };
        expect(chooseScoredDroneEventOption(tied, weights)?.id).toBe('first');
    });

    it('filters missions by configured location and goal', () => {
        expect(bestDroneMission(state, 'l2')?.id).toBe('m2');
        expect(bestDroneMission(state, null)?.id).toBe('m1');
        expect(bestDroneMission(state, null, 'm2')?.id).toBe('m2');
        // A stale goal falls back to the configured location instead of
        // silently blocking every launch.
        expect(bestDroneMission(state, 'l1', 'm2')?.id).toBe('m1');
        expect(bestDroneMission(state, 'missing', 'missing')?.id).toBe('m1');
    });
});


describe('drone availability', () => {
    it('estimates charge time from the game restoreSeconds', () => {
        const charging: DroneState = {
            ...state,
            battery: 40,
            batteryRestoreSeconds: 300,
            missions: [{ ...missions[0]!, batteryCost: 70 }],
        };
        expect(droneNextAvailableSeconds(charging)).toBe(150);
        expect(droneRefreshDelayMs(charging)).toBe(152_000);
    });

    it('uses the repair time while maintenance is running', () => {
        const repairing: DroneState = {
            ...state,
            drone: { ...state.drone!, repairing: true, repairSecondsRemaining: 600 },
        };
        expect(droneNextAvailableSeconds(repairing)).toBe(600);
        expect(droneRefreshDelayMs(repairing)).toBe(602_000);
    });

    it('uses a short poll for active missions and a slow poll when ready', () => {
        expect(droneRefreshDelayMs({ ...state, activeMissionId: 'm1' })).toBe(30_000);
        expect(droneRefreshDelayMs(state)).toBe(60_000);
        expect(droneNextAvailableSeconds({ ...state, activeMissionId: 'm1' })).toBeNull();
    });
});
