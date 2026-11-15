import { describe, expect, it } from 'vitest';
import { ChromeTabMarketDataAdapter } from './chrome-tab-market-data-adapter.js';

describe('ChromeTabMarketDataAdapter', () => {
    it('validates and returns market data', async () => {
        const adapter = new ChromeTabMarketDataAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { options: { a: 1 }, lots: [], jobs: [] } }),
        });
        expect(await adapter.fetchMarket('m1')).toEqual({
            ok: true,
            value: { options: { a: 1 }, lots: [], jobs: [] },
        });
    });

    it('rejects malformed market data', async () => {
        const adapter = new ChromeTabMarketDataAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { lots: [] } }),
        });
        expect((await adapter.fetchMarket('m1')).ok).toBe(false);
    });
});
