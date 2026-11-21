import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../bridge/bridge-client.js';
import { makeBridgeResponse, type BridgeEnvelope } from '../../contracts/bridge.js';
import { autoJobsStatusSchema } from '../../contracts/auto-jobs.js';
import { autoFinishFailureSchema, autoFinishLastRunSchema, autoFinishRunResultSchema } from '../../contracts/auto-finish.js';
import { ChromePopupPortal, droneStateSchema, expeditionOverviewSchema, overviewStateSchema } from './chrome-popup-portal.js';

function portalWithRequest(request: ReturnType<typeof vi.fn>): ChromePopupPortal {
    return new ChromePopupPortal({ request } as unknown as BridgeClient);
}

function portalWithBridgeValue(value: unknown): ChromePopupPortal {
    const transport = {
        send: async (request: BridgeEnvelope) => makeBridgeResponse({
            request,
            id: request.id,
            result: { ok: true as const, value },
        }),
    };
    return new ChromePopupPortal(new BridgeClient(transport, 'popup', 'background'));
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

describe('Popup Bridge schema alignment', () => {
    const autoJobsStatus = {
        enabled: true,
        intervalMinutes: 15,
        running: false,
        stage: 'idle',
        nextRefreshAt: 1_700_000_000_000,
        refreshReason: 'interval' as const,
        scheduleState: 'scheduled' as const,
        repairAt: null,
        lastRefreshAt: 1_699_999_000_000,
        snapshotAt: 1_699_999_100_000,
        locks: { 'job-1': 1_700_000_100_000 },
        retryAttempts: { 'job-1': { count: 1, lastAttemptAt: 1_699_999_200_000 } },
    };

    const failure = {
        jobId: 'job-1',
        name: 'Decrypt report',
        serverName: 'USOL-1',
        code: 'COMPLETE_FAILED',
        message: 'Completion is blocked by an earlier unconfirmed Complete result',
        retryable: false,
        stage: 'complete',
    };

    const lastRun = {
        runId: 'auto-finish-1',
        finishedAt: 1_700_000_000_000,
        jobs: 1,
        done: 0,
        retry: 0,
        skipped: 0,
        expired: 0,
        failed: 1,
        stopped: false,
        markets: [],
        failures: [{ ...failure, unconfirmed: true }],
    };

    const overview = {
        auth: { authenticated: true, source: 'content' as const },
        network: {
            serverCount: 1,
            connectionCount: 0,
            hiddenConnectionCount: 0,
            home: 'HOME',
            endpoint: 'HOME',
        },
        networkAgeMs: 1_000,
        queue: { running: null, waiting: [], updatedAt: 1_700_000_000_000 },
        readiness: [],
        helperMode: false,
        autoJobs: {
            nextRefreshAt: autoJobsStatus.nextRefreshAt,
            refreshReason: autoJobsStatus.refreshReason,
            scheduleState: autoJobsStatus.scheduleState,
            repairAt: autoJobsStatus.repairAt,
            lastRefreshAt: autoJobsStatus.lastRefreshAt,
            lastError: null,
            lastSkipReason: null,
            lastAttemptAt: 1_699_999_300_000,
        },
        automations: [],
        timers: [],
        jobReport: lastRun,
    };

    it('T01 accepts the full background AutoJobsStatus shape', () => {
        const parsed = autoJobsStatusSchema.safeParse(autoJobsStatus);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.scheduleState).toBe('scheduled');
        expect(parsed.data.repairAt).toBeNull();
        expect(parsed.data.nextRefreshAt).toBe(autoJobsStatus.nextRefreshAt);
        expect(parsed.data.locks).toEqual(autoJobsStatus.locks);
        expect(parsed.data.retryAttempts).toEqual(autoJobsStatus.retryAttempts);
    });

    it('T02 accepts the full Overview AutoJobs shape without losing fields', () => {
        const parsed = overviewStateSchema.safeParse(overview);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.autoJobs.scheduleState).toBe('scheduled');
        expect(parsed.data.autoJobs.repairAt).toBeNull();
        expect(parsed.data.autoJobs.lastRefreshAt).toBe(autoJobsStatus.lastRefreshAt);
        expect(parsed.data.autoJobs.lastAttemptAt).toBe(1_699_999_300_000);
    });

    it('T03 accepts a legacy AutoFinishFailure without unconfirmed', () => {
        const parsed = autoFinishFailureSchema.safeParse(failure);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.unconfirmed).toBeUndefined();
    });

    it('T04 accepts AutoFinishFailure with unconfirmed=false', () => {
        const parsed = autoFinishFailureSchema.safeParse({ ...failure, unconfirmed: false });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.unconfirmed).toBe(false);
    });

    it('T05 accepts AutoFinishFailure with unconfirmed=true and preserves it', () => {
        const parsed = autoFinishFailureSchema.safeParse({ ...failure, unconfirmed: true });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.unconfirmed).toBe(true);
    });

    it('T06 accepts AutoFinishLastRun with an unconfirmed failure', () => {
        const parsed = autoFinishLastRunSchema.safeParse(lastRun);
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.failures[0]?.unconfirmed).toBe(true);
    });

    it('T07 accepts AutoFinishRunResult with an unconfirmed failure', () => {
        const parsed = autoFinishRunResultSchema.safeParse({
            jobs: lastRun.jobs,
            done: lastRun.done,
            retry: lastRun.retry,
            skipped: lastRun.skipped,
            expired: lastRun.expired,
            failed: lastRun.failed,
            stopped: lastRun.stopped,
            markets: lastRun.markets,
            failures: lastRun.failures,
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.failures[0]?.unconfirmed).toBe(true);
    });

    it('T08 accepts a complete Overview State with schedule fields and unconfirmed failure', () => {
        const parsed = overviewStateSchema.safeParse({
            ...overview,
            autoJobs: {
                ...overview.autoJobs,
                scheduleState: 'repair-pending',
                repairAt: 1_700_000_200_000,
            },
        });
        expect(parsed.success).toBe(true);
        if (!parsed.success) return;
        expect(parsed.data.autoJobs.scheduleState).toBe('repair-pending');
        expect(parsed.data.autoJobs.repairAt).toBe(1_700_000_200_000);
        expect(parsed.data.jobReport?.failures[0]?.unconfirmed).toBe(true);
    });

    it('T09 still rejects unknown fields and invalid types', () => {
        expect(autoJobsStatusSchema.safeParse({ ...autoJobsStatus, unexpected: true }).success).toBe(false);
        expect(autoJobsStatusSchema.safeParse({ ...autoJobsStatus, scheduleState: 'not-a-state' }).success).toBe(false);
        expect(autoFinishFailureSchema.safeParse({ ...failure, unconfirmed: 'yes' }).success).toBe(false);
        expect(overviewStateSchema.safeParse({
            ...overview,
            autoJobs: { ...overview.autoJobs, repairAt: 'later' },
        }).success).toBe(false);
    });

    it('parses autoJobsStatus through the real BridgeClient boundary', async () => {
        const result = await portalWithBridgeValue(autoJobsStatus).autoJobsStatus();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.scheduleState).toBe('scheduled');
        expect(result.value.repairAt).toBeNull();
    });

    it('parses overview.state through the real BridgeClient boundary', async () => {
        const result = await portalWithBridgeValue(overview).overviewState();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.autoJobs.scheduleState).toBe('scheduled');
        expect(result.value.jobReport?.failures[0]?.unconfirmed).toBe(true);
    });

    it('parses auto-finish.status and run results with unconfirmed failures', async () => {
        const status = {
            enabled: true,
            running: false,
            currentRunId: null,
            live: null,
            last: lastRun,
            progress: null,
            nextRetryAt: null,
            retryReason: null,
            completedJobsByMarket: { byMarket: {} },
            legacyCompletedJobs: {},
            completionStateStatus: 'loaded' as const,
        };
        const statusResult = await portalWithBridgeValue(status).autoFinishStatus();
        expect(statusResult.ok).toBe(true);
        if (statusResult.ok) {
            expect(statusResult.value.last?.failures[0]?.unconfirmed).toBe(true);
            // T14: old responses omit the new fields; defaults must not mean loaded.
            expect(statusResult.value.unknownJobs).toEqual([]);
            expect(statusResult.value.unknownStateStatus).toBe('unavailable');
            // T15: existing status fields keep their meaning.
            expect(statusResult.value.enabled).toBe(true);
            expect(statusResult.value.completionStateStatus).toBe('loaded');
        }

        const runResult = await portalWithBridgeValue({
            jobs: lastRun.jobs,
            done: lastRun.done,
            retry: lastRun.retry,
            skipped: lastRun.skipped,
            expired: lastRun.expired,
            failed: lastRun.failed,
            stopped: lastRun.stopped,
            markets: lastRun.markets,
            failures: lastRun.failures,
        }).runAutoFinish(true);
        expect(runResult.ok).toBe(true);
        if (runResult.ok) expect(runResult.value.failures[0]?.unconfirmed).toBe(true);
    });

    it('T01/T02 accepts manual queue unconfirmed failure through the Bridge', async () => {
        const result = await portalWithBridgeValue({
            stopped: false,
            done: [],
            failed: [{
                jobId: 'job-1',
                name: 'Job',
                serverName: null,
                marketKey: 'home',
                code: 'COMPLETE_FAILED',
                message: 'Completion result unconfirmed',
                unconfirmed: true,
            }],
        }).runJobQueue([], 'run-1');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.failed[0]?.unconfirmed).toBe(true);
        expect(result.value.failed[0]?.marketKey).toBe('home');
    });

    it('T03 accepts a legacy manual queue failure without unconfirmed', async () => {
        const result = await portalWithBridgeValue({
            stopped: false,
            done: [],
            failed: [{
                jobId: 'job-1',
                name: 'Job',
                serverName: null,
                marketKey: 'home',
                code: 'JOB_FAILED',
                message: 'ordinary failure',
            }],
        }).runJobQueue([], 'run-2');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.failed[0]?.unconfirmed).toBeUndefined();
    });

    it('T13 accepts the durable Unknown projection fields', async () => {
        const status = {
            enabled: true,
            running: false,
            currentRunId: null,
            live: null,
            last: lastRun,
            progress: null,
            nextRetryAt: null,
            retryReason: null,
            completedJobsByMarket: { byMarket: {} },
            legacyCompletedJobs: {},
            completionStateStatus: 'loaded' as const,
            unknownJobs: [{
                marketKey: 'home',
                jobId: 'job-1',
                resetAt: '2026-11-20T11:00:00.000Z',
            }, {
                marketKey: 'dark',
                jobId: 'job-1',
                resetAt: null,
            }],
            unknownStateStatus: 'partial' as const,
        };
        const result = await portalWithBridgeValue(status).autoFinishStatus();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.unknownJobs).toEqual(status.unknownJobs);
        expect(result.value.unknownStateStatus).toBe('partial');
    });
});

describe('AutoFinish status health bridge contract', () => {
    it('T31 accepts explicit partial/unavailable health states through the strict schema', async () => {
        const result = await portalWithBridgeValue({
            enabled: true,
            running: false,
            currentRunId: null,
            live: null,
            last: null,
            progress: null,
            nextRetryAt: null,
            retryReason: null,
            completedJobsByMarket: { byMarket: {} },
            legacyCompletedJobs: {},
            completionStateStatus: 'unavailable' as const,
            unknownJobs: [],
            unknownStateStatus: 'unavailable' as const,
        }).autoFinishStatus();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.completionStateStatus).toBe('unavailable');
        expect(result.value.unknownStateStatus).toBe('unavailable');
    });

    it('T32 keeps legacy responses compatible without pretending the new fields are loaded', async () => {
        const result = await portalWithBridgeValue({
            enabled: true,
            running: false,
            currentRunId: null,
            live: null,
            last: null,
            progress: null,
            nextRetryAt: null,
            retryReason: null,
        }).autoFinishStatus();

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.completionStateStatus).toBe('not-loaded');
        expect(result.value.unknownStateStatus).toBe('unavailable');
        expect(result.value.unknownJobs).toEqual([]);
    });
});
