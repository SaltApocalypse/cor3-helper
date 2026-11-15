import { describe, expect, it } from 'vitest';
import { asServerId } from '../../kernel/ids.js';
import { ChromeTabEndpointCommandAdapter } from './chrome-tab-endpoint-command-adapter.js';
import { ChromeTabMarketRequestAdapter } from './chrome-tab-market-request-adapter.js';
import { ChromeTabServerAccessAdapter } from './chrome-tab-server-access-adapter.js';

describe('Phase 3 Chrome tab adapters', () => {
    it('maps endpoint command results', async () => {
        const adapter = new ChromeTabEndpointCommandAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true }),
        });
        expect(await adapter.setEndpoint(asServerId('s1'))).toEqual({ ok: true, value: undefined });
    });

    it('logs in through existing access', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                sent.push(message);
                if ((message as { type: string }).type === 'V2_LOGIN_STATUS') {
                    return { ok: true, value: { activeAccesses: [{ id: 'access-1' }] } };
                }
                return { ok: true };
            },
        });
        expect(await adapter.ensureAccess(asServerId('s1'))).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([
            { type: 'V2_LOGIN_STATUS', serverId: 's1' },
            { type: 'V2_LOGIN_WITH_ACCESS', serverId: 's1', accessGrantId: 'access-1' },
        ]);
    });

    it('auto-hacks and logs in when the server grants access without a minigame', async () => {
        let statusCalls = 0;
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                if (type === 'V2_LOGIN_STATUS') {
                    statusCalls++;
                    return statusCalls === 1
                        ? { ok: true, value: { activeAccesses: [] } }
                        : { ok: true, value: { activeAccesses: [{ id: 'access-1' }] } };
                }
                if (type === 'V2_HACK_START') return { ok: true, value: { autoHacked: true } };
                return { ok: true };
            },
        }, async () => {});
        expect(await adapter.ensureAccess(asServerId('s1'))).toEqual({ ok: true, value: undefined });
        expect(statusCalls).toBe(2);
    });

    it('reapplies the hack loadout and retries once after sai-hack-impossible', async () => {
        let hackCalls = 0;
        let hacked = false;
        let loadoutCalls = 0;
        const adapter = new ChromeTabServerAccessAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const type = (message as { type: string }).type;
                if (type === 'V2_LOGIN_STATUS') {
                    return hacked
                        ? { ok: true, value: { activeAccesses: [{ id: 'access-1' }] } }
                        : { ok: true, value: { activeAccesses: [], serverDefenceRate: 12 } };
                }
                if (type === 'V2_HACK_START') {
                    hackCalls++;
                    if (hackCalls === 1) return { ok: false, error: { code: 'sai-hack-impossible', message: 'not enough power' } };
                    hacked = true;
                    return { ok: true, value: { autoHacked: true } };
                }
                return { ok: true };
            },
        }, async () => {}, {
            ensure: async () => { loadoutCalls++; return { ok: true, value: {} }; },
        });
        expect(await adapter.ensureAccess(asServerId('s1'), { serverTypeName: 'CEDRT' })).toEqual({ ok: true, value: undefined });
        expect(loadoutCalls).toBe(2);
        expect(hackCalls).toBe(2);
    });

    it('requests market jobs through content', async () => {
        const adapter = new ChromeTabMarketRequestAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true }),
        });
        expect(await adapter.requestMarket('m1')).toEqual({ ok: true, value: undefined });
    });
});
