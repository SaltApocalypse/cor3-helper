import { describe, expect, it } from 'vitest';
import { mapDroneState } from './map.js';

describe('mapDroneState', () => {
    it('treats a null options payload as an unavailable drone', () => {
        const state = mapDroneState(null, {});
        expect(state).not.toBeNull();
        expect(state?.drone).toBeNull();
        expect(state?.missions).toEqual([]);
    });

    it('captures the battery restore time for charge countdowns', () => {
        const state = mapDroneState({
            drone: { id: 'd1', name: 'Drone', durability: 80, maxDurability: 100 },
            battery: { current: 40, max: 100, restoreSeconds: 300 },
            missions: [],
        }, {});
        expect(state?.battery).toBe(40);
        expect(state?.batteryRestoreSeconds).toBe(300);
    });

    it('accepts a bare mission array payload', () => {
        const state = mapDroneState([
            {
                id: 'm1',
                name: 'Survey',
                batteryCost: 10,
                locationConfigId: 'l1',
                missionConfigId: 'mc1',
            },
        ], {});
        expect(state?.missions).toHaveLength(1);
        expect(state?.missions[0]?.id).toBe('m1');
    });
});
