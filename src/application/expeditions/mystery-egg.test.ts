import { describe, expect, it } from 'vitest';
import { isMysteryEggPayout, MYSTERY_EGG_ITEMS } from './mystery-egg.js';

function payout(overrides: Partial<Parameters<typeof isMysteryEggPayout>[0]> = {}) {
    return {
        riskScore: 96,
        outcome: 'FULL_SUCCESS',
        items: MYSTERY_EGG_ITEMS.slice(0, 2).map((name) => ({ name })),
        ...overrides,
    };
}

describe('isMysteryEggPayout', () => {
    it('matches a full success above the risk threshold with two pool items', () => {
        expect(isMysteryEggPayout(payout())).toBe(true);
    });

    it('allows two copies of the same pool item', () => {
        expect(isMysteryEggPayout(payout({ items: [{ name: 'Artificial milk' }, { name: 'Artificial milk' }] }))).toBe(
            true,
        );
    });

    it('requires risk at least 95', () => {
        expect(isMysteryEggPayout(payout({ riskScore: 94 }))).toBe(false);
        expect(isMysteryEggPayout(payout({ riskScore: 95 }))).toBe(true);
        expect(isMysteryEggPayout(payout({ riskScore: null }))).toBe(false);
    });

    it('rejects partial, failed and death outcomes even when items match', () => {
        for (const outcome of ['PARTIAL_SUCCESS', 'FAILURE', 'DEATH']) {
            expect(isMysteryEggPayout(payout({ outcome }))).toBe(false);
        }
    });

    it('fails closed on an unknown outcome', () => {
        expect(isMysteryEggPayout(payout({ outcome: 'SOMETHING_ELSE' }))).toBe(false);
    });

    it('accepts a missing outcome when the item pattern proves full success', () => {
        expect(isMysteryEggPayout(payout({ outcome: null }))).toBe(true);
    });

    it('requires exactly two items', () => {
        expect(isMysteryEggPayout(payout({ items: [{ name: 'Artificial milk' }] }))).toBe(false);
        expect(
            isMysteryEggPayout(
                payout({
                    items: [{ name: 'Artificial milk' }, { name: 'Artificial milk' }, { name: 'Artificial milk' }],
                }),
            ),
        ).toBe(false);
    });

    it('rejects items outside the pool', () => {
        expect(
            isMysteryEggPayout(
                payout({
                    items: [{ name: 'Artificial milk' }, { name: 'Something else' }],
                }),
            ),
        ).toBe(false);
    });

    it('trims surrounding whitespace on item names', () => {
        expect(
            isMysteryEggPayout(
                payout({
                    items: [{ name: ' Artificial milk ' }, { name: 'Old Abibas beanie ' }],
                }),
            ),
        ).toBe(true);
    });
});
