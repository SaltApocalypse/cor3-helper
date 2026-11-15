import { describe, expect, it, vi } from 'vitest';
import { ExpeditionService, type ExpeditionPort } from './service.js';
import type { ExpeditionLocation } from '../../domains/expeditions/model.js';

const locations: ExpeditionLocation[] = [{
    id: 'loc-a',
    name: 'Location A',
    zones: [{
        id: 'zone-a',
        name: 'Zone A',
        goals: [
            { id: 'goal-a', name: 'Goal A' },
            { id: 'goal-b', name: 'Goal B' },
        ],
    }],
}];

function port(configure: ReturnType<typeof vi.fn>): ExpeditionPort {
    return {
        getActive: async () => ({ ok: true, value: [] }),
        getArchived: async () => ({ ok: true, value: [] }),
        getMercenaries: async () => ({ ok: true, value: { mercenaries: [{ id: 'merc-1', name: 'Merc', price: 100 }] } }),
        getConfig: async () => ({ ok: true, value: {} }),
        respond: async () => ({ ok: true, value: undefined }),
        configure,
        launch: async () => ({ ok: true, value: undefined }),
        openContainer: async () => ({ ok: true, value: undefined }),
    };
}

describe('ExpeditionService candidates', () => {
    it('configures candidates with the requested location and goal', async () => {
        const configure = vi.fn().mockResolvedValue({ ok: true, value: { totalCost: 250, riskScore: 40 } });
        const service = new ExpeditionService(port(configure), async () => undefined);
        const result = await service.candidates({
            marketId: 'home',
            marketKey: 'core',
            hasInsurance: false,
            locations,
            locationConfigId: 'loc-a',
            zoneConfigId: 'zone-a',
            goalId: 'goal-b',
        });
        expect(result.ok).toBe(true);
        expect(configure).toHaveBeenCalledWith(expect.objectContaining({
            mercenaryId: 'merc-1',
            locationConfigId: 'loc-a',
            zoneConfigId: 'zone-a',
            goalId: 'goal-b',
        }));
        if (result.ok) expect(result.value[0]).toMatchObject({ totalCost: 250, riskScore: 40 });
    });
});
