import { describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../bridge/bridge-client.js';
import { ChromePopupPortal, droneStateSchema, expeditionOverviewSchema } from './chrome-popup-portal.js';

function portalWithRequest(request: ReturnType<typeof vi.fn>): ChromePopupPortal {
    return new ChromePopupPortal({ request } as unknown as BridgeClient);
}

const loadoutResult = {
    ability: 'HACK',
    target: 'EMERCODE',
    power: 20,
    requiredPower: 15,
    feasible: true,
    softwareName: 'RE-nova v3.0',
    policyId: 'max-power',
    policyVersion: 1,
};

describe('ChromePopupPortal', () => {
    it('forwards the weakest loadout strategy', async () => {
        const request = vi.fn().mockResolvedValue({ ok: true, value: loadoutResult });
        const portal = portalWithRequest(request);
        await portal.applyLoadout('HACK', 'EMERCODE', 15, 'weakest');
        expect(request).toHaveBeenCalledWith(
            'loadout.apply',
            { ability: 'HACK', target: 'EMERCODE', requiredPower: 15, strategy: 'weakest' },
            expect.anything(),
            90000,
        );
    });

    it('defaults to the optimized strategy', async () => {
        const request = vi.fn().mockResolvedValue({ ok: true, value: loadoutResult });
        const portal = portalWithRequest(request);
        await portal.applyLoadout('HACK', 'EMERCODE', 15);
        expect(request).toHaveBeenCalledWith(
            'loadout.apply',
            { ability: 'HACK', target: 'EMERCODE', requiredPower: 15, strategy: 'best' },
            expect.anything(),
            90000,
        );
    });
});


describe('portal response schemas', () => {
    it('accepts a full expedition overview with decisions and active fields', () => {
        const result = expeditionOverviewSchema.safeParse({
            active: [{
                id: 'exp-1', status: 'IN_PROGRESS', locationName: 'Skylift Remains',
                mercenaryName: 'Nova', totalCost: 100, riskScore: 20, hasInsurance: false, endsAt: null,
            }],
            archived: [],
            mercenaries: [{
                id: 'merc-1', name: 'Nova', level: 1, rarity: 'RARE', price: 100,
                totalCost: null, riskScore: null, status: 'AVAILABLE', faction: 'CORE', elite: false,
            }],
            locations: [],
            decisions: [{
                id: 'msg-1', expeditionId: 'exp-1', message: 'Pick',
                options: [{ id: 'a', label: 'A', successChance: 0.5, risk: 2, lootModifier: 1, riskModifier: 2, requiredModuleId: null }],
            }],
        });
        expect(result.success).toBe(true);
    });

    it('accepts a full drone state with charge and mission fields', () => {
        const result = droneStateSchema.safeParse({
            drone: {
                id: 'd1', name: 'Drone', durability: 80, maxDurability: 100,
                battery: 40, maxBattery: 100, repairing: false, destroyed: false, repairSecondsRemaining: null,
            },
            battery: 40, maxBattery: 100, batteryRestoreSeconds: 300, activeMissionId: 'm1',
            missions: [{ id: 'm1', name: 'Surface Exploration', batteryCost: 10, locationConfigId: 'l1', locationName: 'Surface', missionConfigId: 'mc1', risk: 1, durationSeconds: 600 }],
            archived: [],
        });
        expect(result.success).toBe(true);
    });
});
