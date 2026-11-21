import { describe, expect, it, vi } from 'vitest';
import { ExpeditionService, totalCostInfo, type ExpeditionPort } from './service.js';
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

describe('totalCostInfo', () => {
    it('prefers an explicit nested totalCost over a root initial cost', () => {
        expect(totalCostInfo({ cost: 3000, selection: { totalCost: 5179 } })).toEqual({ total: 5179, explicit: true });
    });

    it('marks a price-only response as estimated', () => {
        expect(totalCostInfo({ mercenary: { price: 3000 } })).toEqual({ total: 3000, explicit: false });
    });
});

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

    it('uses the configured total cost instead of the initial hire cost', async () => {
        const configure = vi.fn().mockResolvedValue({ ok: true, value: { cost: 3000, selection: { totalCost: 5179 } } });
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
        if (result.ok) expect(result.value[0]).toMatchObject({ totalCost: 5179, costEstimated: false });
    });
});

describe('ExpeditionService auto decisions', () => {
    function decisionPort(respond: ReturnType<typeof vi.fn>): ExpeditionPort {
        return {
            getActive: async () => ({
                ok: true,
                value: {
                    expeditions: [],
                    decisions: [{
                        id: 'decision-1',
                        expeditionId: 'exp-1',
                        content: 'Pick',
                        riskScore: 20,
                        decisionDeadline: new Date(Date.now() + 60_000).toISOString(),
                        decisionOptions: [
                            { id: 'safe', label: 'Safe', lootModifier: 1, riskModifier: -5 },
                            { id: 'loot', label: 'Loot', lootModifier: 5, riskModifier: 3 },
                        ],
                    }],
                },
            }),
            getArchived: async () => ({ ok: true, value: {} }),
            getMercenaries: async () => ({ ok: true, value: {} }),
            getConfig: async () => ({ ok: true, value: {} }),
            respond,
            configure: async () => ({ ok: true, value: {} }),
            launch: async () => ({ ok: true, value: undefined }),
            openContainer: async () => ({ ok: true, value: undefined }),
        };
    }

    it('uses score mode and responds with the highest-scoring option', async () => {
        const respond = vi.fn(async () => ({ ok: true as const, value: undefined }));
        const service = new ExpeditionService(decisionPort(respond), async () => undefined);
        const result = await service.autoRespond('home', 'off', 'score', { loot: 1, risk: -5 });

        expect(result.ok).toBe(true);
        expect(respond).toHaveBeenCalledWith('exp-1', 'decision-1', 'safe');
    });
});

describe('ExpeditionService insurance candidates', () => {
    it('carries the requested insurance into configure and the selected candidate', async () => {
        const configure = vi.fn().mockResolvedValue({ ok: true, value: { totalCost: 250, hasInsurance: true } });
        const service = new ExpeditionService(port(configure), async () => undefined);
        const result = await service.candidates({
            marketId: 'home',
            marketKey: 'core',
            hasInsurance: true,
            locations,
            locationConfigId: 'loc-a',
            zoneConfigId: 'zone-a',
            goalId: 'goal-b',
        });

        expect(configure).toHaveBeenCalledWith(expect.objectContaining({ hasInsurance: true }));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value[0]).toMatchObject({ insurance: true, totalCost: 250 });
    });
});
