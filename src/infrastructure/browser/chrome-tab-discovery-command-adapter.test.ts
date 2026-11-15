import { describe, expect, it } from 'vitest';
import { ChromeTabDiscoveryCommandAdapter } from './chrome-tab-discovery-command-adapter.js';

describe('ChromeTabDiscoveryCommandAdapter', () => {
    it('sends connect.ip through the content tab', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabDiscoveryCommandAdapter({
            findCor3Tab: async () => 5,
            send: async (_tabId, message) => { sent.push(message); return { ok: true }; },
        });
        expect(await adapter.connectIp('1.2.3.4')).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([{ type: 'V2_CONNECT_IP', ip: '1.2.3.4' }]);
    });

    it('returns an error when there is no tab', async () => {
        const adapter = new ChromeTabDiscoveryCommandAdapter({
            findCor3Tab: async () => null,
            send: async () => ({ ok: true }),
        });
        expect(await adapter.connectIp('1.2.3.4')).toEqual({ ok: false, error: { code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' } });
    });
});
