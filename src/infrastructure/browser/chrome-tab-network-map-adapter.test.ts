import { describe, expect, it } from 'vitest';
import { ChromeTabNetworkMapAdapter } from './chrome-tab-network-map-adapter.js';

const validMap = {
    servers: [{ id: 'home', serverName: 'Home Server', serverTypeName: 'Home' }],
    connections: [],
};

describe('ChromeTabNetworkMapAdapter', () => {
    it('returns a schema-valid map from content', async () => {
        const adapter = new ChromeTabNetworkMapAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: validMap }),
        });
        const result = await adapter.getMap();
        expect(result).toEqual({ ok: true, value: validMap });
    });

    it('fails when content is unavailable', async () => {
        const adapter = new ChromeTabNetworkMapAdapter({
            findCor3Tab: async () => null,
            send: async () => ({ ok: true, value: validMap }),
        });
        expect(await adapter.getMap()).toEqual({ ok: false, error: { code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' } });
    });

    it('rejects an invalid map payload', async () => {
        const adapter = new ChromeTabNetworkMapAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { servers: 'nope' } }),
        });
        expect((await adapter.getMap()).ok).toBe(false);
    });
});
