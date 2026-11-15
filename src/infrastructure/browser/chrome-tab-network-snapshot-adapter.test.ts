import { describe, expect, it } from 'vitest';
import { ChromeTabNetworkSnapshotAdapter } from './chrome-tab-network-snapshot-adapter.js';

describe('ChromeTabNetworkSnapshotAdapter', () => {
    it('maps a raw map into a snapshot', async () => {
        const adapter = new ChromeTabNetworkSnapshotAdapter({
            getMap: async () => ({
                ok: true,
                value: {
                    servers: [{ id: 'home', serverName: 'Home Server', serverTypeName: 'Home' }],
                    connections: [],
                },
            }),
        }, { now: () => 99 });
        const result = await adapter.getSnapshot();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.capturedAt).toBe(99);
            expect(result.value.homeId).toBe('home');
        }
    });

    it('propagates map errors', async () => {
        const adapter = new ChromeTabNetworkSnapshotAdapter({
            getMap: async () => ({ ok: false, error: { code: 'NO_COR3_TAB', message: 'none' } }),
        });
        expect(await adapter.getSnapshot()).toEqual({ ok: false, error: { code: 'NO_COR3_TAB', message: 'none' } });
    });
});
