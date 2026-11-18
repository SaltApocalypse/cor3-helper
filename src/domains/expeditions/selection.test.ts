import { describe, expect, it } from 'vitest';
import type { ExpeditionDecisionOption, ExpeditionMercenary } from './model.js';
import { chooseDecisionOption } from './model.js';
import { selectMercenary, shouldInsureMerc, type MercenaryCandidate } from './selection.js';

function merc(id: string, overrides: Partial<ExpeditionMercenary> = {}): ExpeditionMercenary {
    return {
        id,
        name: id,
        level: 1,
        rarity: 'COMMON',
        price: 1000,
        totalCost: 1000,
        riskScore: 10,
        status: 'AVAILABLE',
        faction: 'core',
        elite: false,
        ...overrides,
    };
}

function candidate(
    id: string,
    marketKey: MercenaryCandidate['marketKey'],
    totalCost: number,
    overrides: Partial<ExpeditionMercenary> & { readonly insurance?: boolean } = {},
): MercenaryCandidate {
    const { insurance, ...mercOverrides } = overrides;
    return {
        mercenary: merc(id, { totalCost, ...mercOverrides }),
        marketKey,
        totalCost,
        riskScore: mercOverrides.riskScore ?? 10,
        insurance: insurance ?? false,
    };
}

const options: readonly ExpeditionDecisionOption[] = [
    { id: 'fast', label: 'Fast', successChance: null, risk: null, lootModifier: 2, riskModifier: 2, requiredModuleId: null },
    { id: 'safe', label: 'Safe', successChance: null, risk: null, lootModifier: -1, riskModifier: -2, requiredModuleId: null },
    { id: 'loot', label: 'Loot', successChance: null, risk: null, lootModifier: 3, riskModifier: 1, requiredModuleId: null },
];

describe('chooseDecisionOption', () => {
    it('does not respond when the policy is off', () => {
        expect(chooseDecisionOption(options, 'off')).toBeNull();
    });

    it('prefers the highest risk for veterans', () => {
        expect(chooseDecisionOption(options, 'veterans')?.id).toBe('fast');
    });

    it('prefers the highest loot then the lowest risk', () => {
        expect(chooseDecisionOption(options, 'loot')?.id).toBe('loot');
    });

    it('prefers the lowest risk then the highest loot', () => {
        expect(chooseDecisionOption(options, 'risk')?.id).toBe('safe');
    });
});

describe('shouldInsureMerc', () => {
    it('never insures when the main insurance switch is off', () => {
        expect(shouldInsureMerc(20000, { enabled: false, minPriceEnabled: true, minPrice: 10000 })).toBe(false);
    });

    it('insures every mercenary when the price condition is off', () => {
        expect(shouldInsureMerc(100, { enabled: true, minPriceEnabled: false, minPrice: 10000 })).toBe(true);
    });

    it('insures only strictly above the threshold', () => {
        const policy = { enabled: true, minPriceEnabled: true, minPrice: 10000 };
        expect(shouldInsureMerc(10001, policy)).toBe(true);
        expect(shouldInsureMerc(10000, policy)).toBe(false);
        expect(shouldInsureMerc(9999, policy)).toBe(false);
    });
});

describe('selectMercenary', () => {
    it('uses the first market in the configured order', () => {
        const candidates = [
            candidate('core-expensive', 'core', 12000),
            candidate('usol-cheap', 'usol', 8000),
        ];
        expect(selectMercenary(candidates, { mode: 'market', marketOrder: ['core', 'usol'], maxPrice: null })?.mercenary.id).toBe('core-expensive');
    });

    it('ignores market order in global mode', () => {
        const candidates = [
            candidate('core-expensive', 'core', 12000),
            candidate('usol-cheap', 'usol', 8000),
        ];
        expect(selectMercenary(candidates, { mode: 'global', marketOrder: ['core', 'usol'], maxPrice: null })?.mercenary.id).toBe('usol-cheap');
    });

    it('respects the max price and availability filters', () => {
        const candidates = [
            candidate('too-expensive', 'core', 20000),
            candidate('unavailable', 'core', 5000, { status: 'RESTING' }),
            candidate('ok', 'core', 9000),
        ];
        expect(selectMercenary(candidates, { mode: 'global', marketOrder: ['core'], maxPrice: 15000 })?.mercenary.id).toBe('ok');
    });

    it('does not apply the price cap to an estimated initial cost', () => {
        const candidates = [
            { ...candidate('estimated-cheap', 'core', 3000), costEstimated: true },
            candidate('verified', 'core', 9000),
        ];
        expect(selectMercenary(candidates, { mode: 'global', marketOrder: ['core'], maxPrice: 15000 })?.mercenary.id).toBe('verified');
    });

    it('separates USOL elite from normal USOL when elite is in the order', () => {
        const candidates = [
            candidate('usol-normal', 'usol', 7000),
            candidate('usol-elite', 'usol-elite', 9000, { elite: true }),
        ];
        expect(selectMercenary(candidates, { mode: 'market', marketOrder: ['usol', 'usol-elite'], maxPrice: null })?.mercenary.id).toBe('usol-normal');
    });
});
