import { describe, expect, it } from 'vitest';
import { ChromeTabMinigameAdapter } from './chrome-tab-minigame-adapter.js';

describe('ChromeTabMinigameAdapter', () => {
    it('maps minigame results', async () => {
        const adapter = new ChromeTabMinigameAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { kind: 'config-hack', solved: true } }),
        });
        const result = await adapter.solve(1000);
        expect(result).toEqual({ ok: true, value: { kind: 'config-hack', solved: true } });
    });

    it('rejects unknown minigame kinds', async () => {
        const adapter = new ChromeTabMinigameAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: { kind: 'unknown', solved: true } }),
        });
        const result = await adapter.solve(1000);
        expect(result.ok).toBe(false);
    });

    it('cancels through the content bridge', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabMinigameAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => { sent.push(message); return { ok: true }; },
        });
        expect(await adapter.cancel()).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([{ type: 'V2_CANCEL_MINIGAME' }]);
    });
});
