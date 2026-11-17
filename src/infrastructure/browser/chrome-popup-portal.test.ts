import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeClient } from '../bridge/bridge-client.js';
import { ChromePopupPortal, droneStateSchema, expeditionOverviewSchema } from './chrome-popup-portal.js';

function portalWithRequest(request: ReturnType<typeof vi.fn>): ChromePopupPortal {
    return new ChromePopupPortal({ request } as unknown as BridgeClient);
}

const loadoutResult = {
    ability: 'HACK',
    target: 'EMERCODE',
    power: 20,
    requiredPower: 15,
    feasible: true,
    softwareName: 'RE-nova v3.0',
    policyId: 'max-power',
    policyVersion: 1,
};

describe('ChromePopupPortal', () => {
    it('forwards the weakest loadout strategy', async () => {
        const request = vi.fn().mockResolvedValue({ ok: true, value: loadoutResult });
        const portal = portalWithRequest(request);
        await portal.applyLoadout('HACK', 'EMERCODE', 15, 'weakest');
        expect(request).toHaveBeenCalledWith(
            'loadout.apply',
            { ability: 'HACK', target: 'EMERCODE', requiredPower: 15, strategy: 'weakest' },
            expect.anything(),
            90000,
        );
    });

    it('defaults to the optimized strategy', async () => {
        const request = vi.fn().mockResolvedValue({ ok: true, value: loadoutResult });
        const portal = portalWithRequest(request);
        await portal.applyLoadout('HACK', 'EMERCODE', 15);
        expect(request).toHaveBeenCalledWith(
            'loadout.apply',
            { ability: 'HACK', target: 'EMERCODE', requiredPower: 15, strategy: 'best' },
            expect.anything(),
            90000,
        );
    });
});


describe('portal response schemas', () => {
    it('accepts a full expedition overview with decisions and active fields', () => {
        const result = expeditionOverviewSchema.safeParse({
            active: [{
                id: 'exp-1', status: 'IN_PROGRESS', locationName: 'Skylift Remains',
                mercenaryName: 'Nova', totalCost: 100, riskScore: 20, hasInsurance: false, endsAt: null,
            }],
            archived: [],
            mercenaries: [{
                id: 'merc-1', name: 'Nova', level: 1, rarity: 'RARE', price: 100,
                totalCost: null, riskScore: null, status: 'AVAILABLE', faction: 'CORE', elite: false,
            }],
            locations: [],
            decisions: [{
                id: 'msg-1', expeditionId: 'exp-1', message: 'Pick',
                options: [{ id: 'a', label: 'A', successChance: 0.5, risk: 2, lootModifier: 1, riskModifier: 2, requiredModuleId: null }],
            }],
        });
        expect(result.success).toBe(true);
    });

    it('accepts a full drone state with charge and mission fields', () => {
        const result = droneStateSchema.safeParse({
            drone: {
                id: 'd1', name: 'Drone', durability: 80, maxDurability: 100,
                battery: 40, maxBattery: 100, repairing: false, destroyed: false, repairSecondsRemaining: null,
            },
            battery: 40, maxBattery: 100, batteryRestoreSeconds: 300, activeMissionId: 'm1',
            missions: [{ id: 'm1', name: 'Surface Exploration', batteryCost: 10, locationConfigId: 'l1', locationName: 'Surface', missionConfigId: 'mc1', risk: 1, durationSeconds: 600 }],
            archived: [],
        });
        expect(result.success).toBe(true);
    });
});

describe('ChromePopupPortal detached window', () => {
    const baseUrl = 'chrome-extension://test-id/sidepanel.html';
    const portal = (): ChromePopupPortal => portalWithRequest(vi.fn());

    function stubChrome(options: {
        readonly windows?: readonly { readonly id: number; readonly type: string; readonly tabs?: readonly { readonly url?: string }[] }[];
        readonly create?: ReturnType<typeof vi.fn>;
        readonly update?: ReturnType<typeof vi.fn>;
        readonly sidePanelOpen?: ReturnType<typeof vi.fn>;
        readonly currentWindowId?: number;
    } = {}) {
        const create = options.create ?? vi.fn().mockResolvedValue({ id: 2 });
        const update = options.update ?? vi.fn().mockResolvedValue({ id: 1 });
        vi.stubGlobal('chrome', {
            runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
            windows: {
                getCurrent: vi.fn().mockResolvedValue({ id: options.currentWindowId ?? 1 }),
                getAll: vi.fn().mockResolvedValue(options.windows ?? []),
                create,
                update,
            },
            sidePanel: { open: options.sidePanelOpen ?? vi.fn().mockResolvedValue(undefined) },
        });
        return { create, update };
    }

    afterEach(() => vi.unstubAllGlobals());

    it('opens the workspace in a dedicated popup window', async () => {
        const { create } = stubChrome();
        await expect(portal().openWindow()).resolves.toBe(true);
        expect(create).toHaveBeenCalledWith({
            url: `${baseUrl}?mode=window`,
            type: 'popup',
            width: 430,
            height: 800,
            focused: true,
        });
    });

    it('focuses an existing workspace window instead of creating another one', async () => {
        const { create, update } = stubChrome({
            windows: [{ id: 7, type: 'popup', tabs: [{ url: `${baseUrl}?mode=window` }] }],
        });
        await expect(portal().openWindow()).resolves.toBe(true);
        expect(update).toHaveBeenCalledWith(7, { focused: true });
        expect(create).not.toHaveBeenCalled();
    });

    it('ignores the workspace document in a normal browser tab', async () => {
        const { create, update } = stubChrome({
            windows: [{ id: 7, type: 'normal', tabs: [{ url: `${baseUrl}?mode=window` }] }],
        });
        await expect(portal().openWindow()).resolves.toBe(true);
        expect(update).not.toHaveBeenCalled();
        expect(create).toHaveBeenCalled();
    });

    it('reports failure when Chrome blocks the window', async () => {
        stubChrome({ create: vi.fn().mockRejectedValue(new Error('blocked')) });
        await expect(portal().openWindow()).resolves.toBe(false);
    });

    it('falls back to the window when the side panel API is unavailable', async () => {
        const { create } = stubChrome({
            sidePanelOpen: vi.fn().mockRejectedValue(new Error('sidePanel unavailable')),
        });
        await expect(portal().openSidePanel()).resolves.toBe(true);
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: `${baseUrl}?mode=window` }));
    });
});

describe('ChromePopupPortal in-popup workspace', () => {
    const baseUrl = 'chrome-extension://test-id/sidepanel.html';
    const portal = (): ChromePopupPortal => portalWithRequest(vi.fn());

    afterEach(() => vi.unstubAllGlobals());

    it('navigates the current popup document to the full workspace', async () => {
        const replace = vi.fn();
        vi.stubGlobal('chrome', {
            runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
        });
        vi.stubGlobal('window', { location: { replace } });

        await expect(portal().openInPopup()).resolves.toBe(true);
        expect(replace).toHaveBeenCalledWith(`${baseUrl}?mode=popup`);
    });

    it('reports failure when the browser blocks the navigation', async () => {
        vi.stubGlobal('chrome', {
            runtime: { getURL: (path: string) => `chrome-extension://test-id/${path}` },
        });
        vi.stubGlobal('window', {
            location: { replace: vi.fn().mockImplementation(() => { throw new Error('blocked'); }) },
        });

        await expect(portal().openInPopup()).resolves.toBe(false);
    });
});

describe('Auto Jobs snapshot compatibility', () => {
    it('keeps the short error code for failed markets', async () => {
        const request = vi.fn().mockResolvedValue({
            ok: true,
            value: {
                at: 1,
                jobs: [],
                markets: [{
                    marketKey: 'usol',
                    label: 'USOL',
                    ok: false,
                    skipped: 0,
                    failed: 0,
                    expired: 0,
                    skippedJobs: [],
                    resetAt: null,
                    error: 'market-not-reachable',
                    errorCode: 'MARKET_FETCH_FAILED',
                }],
            },
        });
        const result = await portalWithRequest(request).autoJobsSnapshot();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.markets[0]?.errorCode).toBe('MARKET_FETCH_FAILED');
    });
});
