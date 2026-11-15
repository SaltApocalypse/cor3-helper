import { describe, expect, it } from 'vitest';
import { ChromeTabInventoryAdapter } from './chrome-tab-inventory-adapter.js';

describe('ChromeTabInventoryAdapter', () => {
    it('maps nested raw stash data', async () => {
        const adapter = new ChromeTabInventoryAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { stash: {
                gridWidth: 12,
                usableRows: 30,
                items: [{ id: 'a', width: 2, height: 1, x: 0, y: 0, tier: 'RARE' }],
            } } }),
        });
        const result = await adapter.getStash();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.gridWidth).toBe(12);
            expect(result.value.items[0]?.width).toBe(2);
        }
    });

    it('sends stash move messages', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabInventoryAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => { sent.push(message); return { ok: true }; },
        });
        expect(await adapter.moveItem({ itemId: 'a', location: 'stash', x: 1, y: 2, rotated: false })).toEqual({ ok: true, value: undefined });
        expect(sent[0]).toEqual({ type: 'V2_STASH_MOVE', itemId: 'a', location: 'stash', x: 1, y: 2, rotated: false });
    });
});
