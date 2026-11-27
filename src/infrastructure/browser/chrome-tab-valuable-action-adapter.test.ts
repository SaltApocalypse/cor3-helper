import { describe, expect, it } from 'vitest';
import { ChromeTabValuableActionAdapter } from './chrome-tab-valuable-action-adapter.js';

describe('ChromeTabValuableActionAdapter', () => {
    it('maps search and file/log rows', async () => {
        const adapter = new ChromeTabValuableActionAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const kind = (message as { kind?: string }).kind;
                if (kind === 'searchFiles') return { ok: true, value: { found: [{ id: 'f1', basePrice: 10 }] } };
                if (kind === 'getFiles') return { ok: true, value: { files: [{ fileId: 'f1', name: 'a', basePrice: 10, tags: ['data'] }] } };
                if (kind === 'getLogs') return { ok: true, value: { logs: [{ seq: 4, message: 'm', basePrice: 5, tags: ['log'] }] } };
                if (kind === 'getSellableItems') return { ok: true, value: { items: [{ itemType: 'file', itemId: 'f1', price: 10, reputationGain: 1 }], totalPrice: 10, totalRepGain: 1 } };
                return { ok: true, value: {} };
            },
        });
        const search = await adapter.searchFiles('s');
        expect(search.ok).toBe(true);
        if (search.ok) expect(search.value.found).toEqual([{ id: 'f1', basePrice: 10 }]);
        const files = await adapter.getFiles('s');
        expect(files.ok).toBe(true);
        if (files.ok) expect(files.value[0]?.tags).toEqual(['data']);
        const logs = await adapter.getLogs('s');
        expect(logs.ok).toBe(true);
        if (logs.ok) expect(logs.value[0]?.seq).toBe(4);
        const sellable = await adapter.getSellableItems('m');
        expect(sellable.ok).toBe(true);
        if (sellable.ok) {
            expect(sellable.value.totalPrice).toBe(10);
            expect(sellable.value.items[0]).toMatchObject({ price: 10, reputation: 1 });
        }
    });

    it('forwards the force-maintenance cooldown bypass only when requested', async () => {
        const payloads: Array<Record<string, unknown>> = [];
        const adapter = new ChromeTabValuableActionAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                payloads.push((message as { payload?: Record<string, unknown> }).payload ?? {});
                return { ok: true, value: { found: [] } };
            },
        });
        await adapter.searchFiles('s', 15_000, { bypassRateLimitCooldown: true });
        await adapter.searchFiles('s', 15_000);
        expect(payloads[0]).toMatchObject({ serverId: 's', timeoutMs: 15_000, bypassRateLimitCooldown: true });
        expect(payloads[1]).not.toHaveProperty('bypassRateLimitCooldown');
    });

    it('counts successful sell calls', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabValuableActionAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => { sent.push(message); return { ok: true, value: {} }; },
        });
        const result = await adapter.sellItems('m', [
            { itemType: 'file', itemId: 'a', price: 12, reputation: 1 },
            { itemType: 'log', itemId: 'b', price: 8, reputation: 2 },
        ]);
        expect(result).toEqual({ ok: true, value: { sold: 2, credits: 20, reputation: 3 } });
        expect(sent).toHaveLength(2);
    });
});
