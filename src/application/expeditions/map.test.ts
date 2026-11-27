import { describe, expect, it } from 'vitest';
import { mapExpeditionOverview } from './map.js';

const expedition = {
    id: 'exp-1',
    status: 'IN_PROGRESS',
    locationName: 'Skylift Remains',
    mercenary: null,
    totalCost: null,
    riskScore: null,
    hasInsurance: null,
    endsAt: null,
    messages: null,
};

describe('expedition mapping', () => {
    it('keeps an active expedition whose optional fields are null', () => {
        const overview = mapExpeditionOverview({ expeditions: [expedition] }, {}, {}, {});
        expect(overview.active).toHaveLength(1);
        expect(overview.active[0]).toMatchObject({ id: 'exp-1', status: 'IN_PROGRESS', locationName: 'Skylift Remains' });
    });

    it('keeps an active expedition even when optional fields have unexpected types', () => {
        const overview = mapExpeditionOverview({
            expeditions: [{ ...expedition, totalCost: '250', riskScore: 'high', mercenary: { callsign: 'Nova' } }],
        }, {}, {}, {});
        expect(overview.active).toHaveLength(1);
        expect(overview.active[0]?.mercenaryName).toBe('Nova');
    });

    it('accepts an active array wrapper', () => {
        const overview = mapExpeditionOverview({ active: [expedition] }, {}, {}, {});
        expect(overview.active).toHaveLength(1);
    });

    it('surfaces an in-progress archived expedition when active is empty', () => {
        const overview = mapExpeditionOverview({}, { expeditions: [expedition] }, {}, {});
        expect(overview.active).toHaveLength(1);
        expect(overview.archived).toHaveLength(0);
    });

    it('keeps the active expedition when a message entry is malformed', () => {
        const overview = mapExpeditionOverview({ expeditions: [{ ...expedition, messages: [{ weird: true }] }] }, {}, {}, {});
        expect(overview.active).toHaveLength(1);
        expect(overview.decisions).toHaveLength(0);
    });

    it('extracts decisions that use the options field instead of decisionOptions', () => {
        const overview = mapExpeditionOverview({
            expeditions: [{
                ...expedition,
                messages: [{
                    id: 'msg-options',
                    expeditionId: 'exp-1',
                    content: 'Pick one',
                    isResolved: false,
                    options: [{ id: 'opt-a', label: 'A', risk: 2, lootModifier: 2 }],
                }],
            }],
        }, {}, {}, {});
        expect(overview.decisions).toHaveLength(1);
        expect(overview.decisions[0]?.options[0]?.id).toBe('opt-a');
    });

    it('drops already resolved decisions', () => {
        const overview = mapExpeditionOverview({
            expeditions: [],
            decisions: [{ id: 'old', expeditionId: 'exp-1', isResolved: true, options: [{ id: 'a' }] }],
        }, {}, {}, {});
        expect(overview.decisions).toHaveLength(0);
    });

    it('extracts decisions from nullable message containers', () => {
        const overview = mapExpeditionOverview({
            expeditions: [{
                ...expedition,
                messages: [{
                    id: 'msg-1',
                    expeditionId: 'exp-1',
                    content: 'Pick one',
                    isResolved: false,
                    decisionDeadline: null,
                    decisionOptions: [{ id: 'opt-1', label: 'Go' }],
                }],
            }],
        }, {}, {}, {});
        expect(overview.decisions).toHaveLength(1);
        expect(overview.decisions[0]?.options[0]).toMatchObject({ id: 'opt-1', label: 'Go' });
    });
});

describe('expedition decision score baselines', () => {
    it('derives missing initial loot/risk from absolute option values', () => {
        const overview = mapExpeditionOverview({
            expeditions: [],
            decisions: [{
                id: 'decision-1',
                expeditionId: 'exp-1',
                content: 'Pick',
                decisionOptions: [{
                    id: 'option-1',
                    label: 'Option',
                    risk: 45,
                    riskModifier: 5,
                    loot: 30,
                    lootModifier: 2,
                }],
            }],
        }, {}, {}, {});
        expect(overview.decisions[0]).toMatchObject({ riskScore: 40, lootScore: 28 });
    });
});

describe('expedition payout metadata', () => {
    it('reads outcome, completedAt and flat loot from the expedition object', () => {
        const overview = mapExpeditionOverview({
            expeditions: [{
                id: 'exp-1',
                status: 'COMPLETED',
                outcome: 'FULL_SUCCESS',
                completedAt: '2026-11-27T10:00:00.000Z',
                riskScore: 91,
                containerData: [
                    { name: 'Artificial milk', quantity: 2, tier: 'RARE', imageUrl: 'milk.png', isCollected: true },
                ],
            }],
        }, {}, {}, {});
        expect(overview.active[0]).toMatchObject({
            outcome: 'FULL_SUCCESS',
            completedAt: '2026-11-27T10:00:00.000Z',
            riskScore: 91,
        });
        expect(overview.active[0]?.loot[0]).toMatchObject({ name: 'Artificial milk', quantity: 2, tier: 'RARE', isCollected: true });
    });

    it('accepts nested loot slots and the archived items wrapper', () => {
        const overview = mapExpeditionOverview({}, {
            items: [{
                id: 'exp-2',
                status: 'COMPLETED',
                outcome: 'PARTIAL_SUCCESS',
                container: [{
                    item: { name: 'Old Abibas beanie', quantity: 1, tier: 'EPIC' },
                    isCollected: true,
                    isDeleted: false,
                }],
            }],
            hasMore: false,
        }, {}, {});
        expect(overview.archived[0]?.outcome).toBe('PARTIAL_SUCCESS');
        expect(overview.archived[0]?.loot[0]).toMatchObject({
            name: 'Old Abibas beanie',
            quantity: 1,
            tier: 'EPIC',
            isCollected: true,
            isDeleted: false,
        });
    });
});
