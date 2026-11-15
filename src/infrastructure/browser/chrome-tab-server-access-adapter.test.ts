import { describe, expect, it, vi } from 'vitest';
import { asServerId } from '../../kernel/ids.js';
import { err, ok } from '../../kernel/result.js';
import { ChromeTabServerAccessAdapter } from './chrome-tab-server-access-adapter.js';

const serverId = asServerId('server-1');

function accessResponse() {
    return ok({ activeAccesses: [{ id: 'access-1' }] });
}

describe('ChromeTabServerAccessAdapter', () => {
    it('uses an existing access grant without touching the loadout', async () => {
        const calls: string[] = [];
        const loadout = { ensure: vi.fn() };
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                calls.push(type);
                if (type === 'V2_LOGIN_STATUS') return accessResponse();
                return ok(undefined);
            },
        }, async () => undefined, loadout);

        const result = await adapter.ensureAccess(serverId, { serverTypeName: 'URM7-M' });

        expect(result.ok).toBe(true);
        expect(loadout.ensure).not.toHaveBeenCalled();
        expect(calls).toEqual(['V2_LOGIN_STATUS', 'V2_LOGIN_WITH_ACCESS']);
    });

    it('tries the current loadout before equipping a HACK plan', async () => {
        let hacked = false;
        const loadout = { ensure: vi.fn() };
        const calls: string[] = [];
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                calls.push(type);
                if (type === 'V2_LOGIN_STATUS') {
                    return hacked ? accessResponse() : ok({ activeAccesses: [] });
                }
                if (type === 'V2_HACK_START') {
                    hacked = true;
                    return ok({ autoHacked: true });
                }
                return ok(undefined);
            },
        }, async () => undefined, loadout);

        const result = await adapter.ensureAccess(serverId, { serverTypeName: 'URM7-M' });

        expect(result.ok).toBe(true);
        expect(loadout.ensure).not.toHaveBeenCalled();
        expect(calls.filter((type) => type === 'V2_HACK_START')).toHaveLength(1);
    });

    it('swaps the loadout only after a retryable hack error', async () => {
        let hacked = false;
        let hackCalls = 0;
        const loadout = { ensure: vi.fn(async () => ok({})) };
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                if (type === 'V2_LOGIN_STATUS') {
                    return hacked ? accessResponse() : ok({ activeAccesses: [] });
                }
                if (type === 'V2_HACK_START') {
                    hackCalls += 1;
                    if (hackCalls === 1) return err({ code: 'sai-no-hack-software', message: 'no hack software' });
                    hacked = true;
                    return ok({ autoHacked: true });
                }
                return ok(undefined);
            },
        }, async () => undefined, loadout);

        const result = await adapter.ensureAccess(serverId, { serverTypeName: 'URM7-M' });

        expect(result.ok).toBe(true);
        expect(loadout.ensure).toHaveBeenCalledTimes(1);
        expect(hackCalls).toBe(2);
    });

    it('returns LOADOUT_NO_PLAN when the retry cannot find HACK software', async () => {
        const loadout = {
            ensure: vi.fn(async () => err({ code: 'NO_PLAN', message: 'NO_SOFTWARE' })),
        };
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                if (type === 'V2_LOGIN_STATUS') return ok({ activeAccesses: [] });
                if (type === 'V2_HACK_START') return err({ code: 'sai-no-hack-software', message: 'no hack software' });
                return ok(undefined);
            },
        }, async () => undefined, loadout);

        const result = await adapter.ensureAccess(serverId, { serverTypeName: 'URM7-M' });

        expect(result).toEqual({ ok: false, error: { code: 'LOADOUT_NO_PLAN', message: 'NO_SOFTWARE' } });
        expect(loadout.ensure).toHaveBeenCalledTimes(1);
    });
});
