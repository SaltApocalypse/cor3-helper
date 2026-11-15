import { describe, expect, it } from 'vitest';
import type { DroneMission } from '../../domains/drone/model.js';
import { DroneAutoService, type DroneAutomationSettings } from './auto.js';
import { DroneService, type DronePort } from './service.js';

function mission(overrides: Partial<DroneMission> = {}): DroneMission {
    return {
        id: 'mission-row-id',
        name: 'Surface Exploration',
        batteryCost: 30,
        locationConfigId: 'location-id',
        locationName: 'The Surface of Mars',
        missionConfigId: 'mission-config-id',
        risk: 25,
        durationSeconds: 1200,
        ...overrides,
    };
}

function fakePort(options: { readonly missions?: readonly DroneMission[] } = {}): DronePort & { readonly launches: string[] } {
    const launches: string[] = [];
    return {
        launches,
        getOptions: async () => ({
            ok: true,
            value: {
                drone: {
                    id: 'drone', name: 'Drone', durability: 100, maxDurability: 100,
                    isRepairing: false, isDestroyed: false, repairSecondsRemaining: null,
                    battery: { current: 100, max: 100 },
                },
                battery: { current: 100, max: 100 },
                activeMissionId: null,
                locations: [{
                    id: 'location-id',
                    name: 'The Surface of Mars',
                    baseRisk: 25,
                    missions: options.missions ?? [mission()],
                }],
            },
        }),
        getArchived: async () => ({ ok: true, value: { items: [] } }),
        getLatestEvent: async () => ({ ok: true, value: null }),
        getCompleted: async () => ({ ok: true, value: null }),
        launch: async (locationConfigId, missionConfigId) => {
            launches.push(`${locationConfigId}:${missionConfigId}`);
            return { ok: true, value: undefined };
        },
        resolve: async () => ({ ok: true, value: undefined }),
        repair: async () => ({ ok: true, value: undefined }),
    };
}

const settings: DroneAutomationSettings = {
    repairEnabled: false,
    repairThreshold: 60,
    repairOnCharge: false,
    decisionPolicy: 'off',
    locationId: null,
    goalId: null,
    targetLocationConfigId: 'location-id',
    targetMissionConfigId: 'mission-config-id',
    autoSendEnabled: true,
};

describe('DroneAutoService fixed target', () => {
    it('launches the configured location and mission config IDs', async () => {
        const port = fakePort();
        const service = new DroneAutoService(new DroneService(port));
        const result = await service.runOnce(settings);
        expect(result.ok && result.value.status).toBe('launched');
        expect(port.launches).toEqual(['location-id:mission-config-id']);
    });

    it('does not launch a different mission when the configured target is missing', async () => {
        const port = fakePort({ missions: [mission({ id: 'other-row', missionConfigId: 'other-config' })] });
        const service = new DroneAutoService(new DroneService(port));
        const result = await service.runOnce(settings);
        expect(result.ok && result.value.status).toBe('blocked');
        expect(port.launches).toEqual([]);
    });
});
