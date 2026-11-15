import { describe, expect, it } from 'vitest';
import { ChromeTabAuthAdapter } from './chrome-tab-auth-adapter.js';

describe('ChromeTabAuthAdapter', () => {
    it('reports no session when there is no cor3 tab', async () => {
        const adapter = new ChromeTabAuthAdapter({
            findCor3Tab: async () => null,
            send: async () => ({ authenticated: true, source: 'content' }),
        });
        expect(await adapter.status()).toEqual({ authenticated: false, source: 'none' });
    });

    it('reports a content session only when the content response says so', async () => {
        const adapter = new ChromeTabAuthAdapter({
            findCor3Tab: async () => 7,
            send: async () => ({ authenticated: true, source: 'content' }),
        });
        expect(await adapter.status()).toEqual({ authenticated: true, source: 'content' });
    });

    it('does not expose a token in status', async () => {
        const adapter = new ChromeTabAuthAdapter({
            findCor3Tab: async () => 7,
            send: async () => ({ authenticated: true, source: 'content', token: 'secret' }),
        });
        expect(JSON.stringify(await adapter.status())).not.toContain('secret');
    });
});
