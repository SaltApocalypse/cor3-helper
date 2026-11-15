import { describe, expect, it } from 'vitest';
import { computeInventoryMoves, inventorySellProtection, layoutInventoryCompact, layoutInventorySmart, planInventoryBatchSell, planInventorySort, type InventoryItem } from './model.js';

function item(id: string, width: number, height: number, extra: Partial<InventoryItem> = {}): InventoryItem {
    return { id, width, height, name: id, ...extra };
}

describe('inventory layouts', () => {
    it('packs compact items without overlap', () => {
        const result = layoutInventoryCompact([
            item('a', 2, 2),
            item('b', 2, 1),
            item('c', 1, 1),
        ], 4, 4);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.items.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
        expect(new Set(result.items.map((entry) => `${entry.x},${entry.y}`)).size).toBe(3);
    });

    it('uses rarity sections and height bands in smart layout', () => {
        const result = layoutInventorySmart([
            item('common', 1, 1, { tier: 'COMMON' }),
            item('legendary', 2, 2, { tier: 'LEGENDARY' }),
            item('quest', 2, 1, { tier: 'QUEST' }),
        ], 4, 6);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.items[0]?.id).toBe('quest');
    });

    it('packs shorter same-rarity groups into the spare space next to tall items', () => {
        const result = layoutInventorySmart([
            item('tall', 2, 2, { tier: 'RARE' }),
            item('short-a', 1, 1, { tier: 'RARE' }),
            item('short-b', 1, 1, { tier: 'RARE' }),
        ], 4, 4);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.items.find((entry) => entry.id === 'short-a')).toMatchObject({ x: 2, y: 0 });
        expect(result.items.find((entry) => entry.id === 'short-b')).toMatchObject({ x: 3, y: 0 });
        expect(result.usedRows).toBe(2);
    });

    it('returns an explicit error when items cannot fit', () => {
        const result = layoutInventoryCompact([item('wide', 5, 1)], 4, 2);
        expect(result).toEqual({ ok: false, reason: 'Not enough warehouse rows for the compact layout (item: wide).' });
    });

    it('computes moves from current cells to the target layout', () => {
        const stash = {
            gridWidth: 2,
            usableRows: 2,
            items: [item('a', 1, 1, { x: 1, y: 1 }), item('b', 1, 1, { x: 0, y: 0 })],
        };
        const plan = computeInventoryMoves(stash, [
            { id: 'a', x: 0, y: 0, w: 1, h: 1, rotated: false },
            { id: 'b', x: 1, y: 0, w: 1, h: 1, rotated: false },
        ]);
        expect(plan.ok).toBe(true);
        if (!plan.ok) return;
        expect(plan.moves).toContainEqual({ itemId: 'a', location: 'stash', x: 0, y: 0, rotated: false });
        expect(plan.moves).toContainEqual({ itemId: 'b', location: 'stash', x: 1, y: 0, rotated: false });
        expect(plan.moves.some((move) => move.location === 'sorting_table')).toBe(true);
    });

    it('falls back to compact when smart requires too many rows', () => {
        const plan = planInventorySort({
            gridWidth: 2,
            usableRows: 2,
            items: [item('a', 2, 2, { tier: 'QUEST', x: 0, y: 0 }), item('b', 2, 1, { tier: 'LEGENDARY', x: 0, y: 0 })],
        }, 'smart');
        expect(plan.ok).toBe(false);
    });
});


describe('inventory batch selling', () => {
    function sellable(id: string, tier: string, extra: Partial<InventoryItem> = {}): InventoryItem {
        return item(id, 1, 1, { tier, canSell: true, sellPrice: 100, ...extra });
    }

    it('protects craftable items and anything above RARE', () => {
        expect(inventorySellProtection(sellable('a', 'COMMON'))).toBeNull();
        expect(inventorySellProtection(sellable('b', 'RARE'))).toBeNull();
        expect(inventorySellProtection(sellable('c', 'RARE', { canCraft: true }))).toBe('craft');
        expect(inventorySellProtection(sellable('d', 'EPIC'))).toBe('high-tier');
        expect(inventorySellProtection(sellable('e', 'QUEST'))).toBe('high-tier');
    });

    it('builds an eligible plan and reports protected valuable items', () => {
        const plan = planInventoryBatchSell({
            items: [
                sellable('common', 'COMMON'),
                sellable('rare', 'RARE'),
                sellable('rare-craft', 'RARE', { canCraft: true }),
                sellable('epic', 'EPIC'),
                sellable('quest', 'QUEST'),
            ],
        }, { tiers: ['COMMON', 'RARE', 'EPIC', 'QUEST'], tag: 'any' });
        expect(plan.eligible.map((entry) => entry.itemId)).toEqual(['common', 'rare']);
        expect(plan.protected.map((entry) => entry.itemId)).toEqual(['rare-craft', 'epic', 'quest']);
        expect(plan.protected.map((entry) => entry.reason)).toEqual(['craft', 'high-tier', 'high-tier']);
        expect(plan.eligibleValue).toBe(200);
        expect(plan.protectedValue).toBe(300);
    });

    it('allows craftable items when the CRAFT tag is selected', () => {
        const plan = planInventoryBatchSell({
            items: [sellable('craft', 'COMMON', { canCraft: true, sellPrice: 50 })],
        }, { tiers: ['COMMON'], tag: 'craft' });
        expect(plan.eligible.map((entry) => entry.itemId)).toEqual(['craft']);
        expect(plan.protected).toEqual([]);
    });

    it('filters out craftable items when the non-craft tag is selected', () => {
        const plan = planInventoryBatchSell({
            items: [sellable('plain', 'COMMON'), sellable('craft', 'COMMON', { canCraft: true })],
        }, { tiers: ['COMMON'], tag: 'none' });
        expect(plan.eligible.map((entry) => entry.itemId)).toEqual(['plain']);
        expect(plan.protected).toEqual([]);
    });
});
