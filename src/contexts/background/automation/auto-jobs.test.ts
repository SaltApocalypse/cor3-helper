import { describe, expect, it, vi } from 'vitest';
import { settingsV1Schema, type SettingsV1 } from '../../../contracts/storage.js';
import { AUTO_JOBS_INFO_ALARM, AUTO_JOBS_INFO_REPAIR_ALARM } from './alarm-ids.js';
import { AutoJobsCoordinator, type AutoFinishPort, type AutoJobsDeps } from './auto-jobs.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';

function makeCoordinator(overrides: Partial<SettingsV1>, now: number | (() => number) = 1_000) {
    const clockNow = typeof now === 'function' ? now : () => now;
    const settings = settingsV1Schema.parse(overrides);
    const tabs = { findCor3Tab: vi.fn(async () => 1) };
    const networkOps = { enqueue: vi.fn() };
    const scheduler = {
        create: vi.fn(),
        clear: vi.fn(async () => undefined),
        get: vi.fn(async () => ({ scheduledTime: 1 })),
    };
    const events = { publish: vi.fn() };
    const deps = {
        settings: {
            get: vi.fn(async () => settings),
            update: vi.fn(async () => settings),
        },
        scheduler,
        events,
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        runLogs: { add: vi.fn() },
        clock: { now: clockNow },
        store: { get: vi.fn(async () => null), set: vi.fn(async () => undefined) },
        locks: { persist: vi.fn(async () => undefined) },
        markets: { syncAll: vi.fn() },
        networkOps,
        tabs,
        isAutoRefreshRunning: () => false,
    } as unknown as AutoJobsDeps;

    return {
        coordinator: new AutoJobsCoordinator(deps),
        tabs,
        networkOps,
        scheduler,
        events,
        markets: deps.markets,
    };
}

describe('AutoJobsCoordinator gating', () => {
    it('does not fetch markets while Helper Mode is enabled', async () => {
        const { coordinator, tabs, networkOps } = makeCoordinator({
            helperMode: true,
            autoJobsEnabled: true,
        });

        await coordinator.ensureInfo('popup-open');

        expect(coordinator.lastSkipReasonText()).toBe('helper-mode');
        expect(tabs.findCor3Tab).not.toHaveBeenCalled();
        expect(networkOps.enqueue).not.toHaveBeenCalled();
    });

    it('does not fetch markets when Auto Jobs is disabled', async () => {
        const { coordinator, tabs, networkOps } = makeCoordinator({
            helperMode: false,
            autoJobsEnabled: false,
        });

        await coordinator.ensureInfo('ready', true, 1);

        expect(coordinator.lastSkipReasonText()).toBe('auto-jobs-disabled');
        expect(tabs.findCor3Tab).not.toHaveBeenCalled();
        expect(networkOps.enqueue).not.toHaveBeenCalled();
    });

    it('does not run a cycle directly while disabled', async () => {
        const { coordinator, networkOps } = makeCoordinator({
            helperMode: false,
            autoJobsEnabled: false,
        });

        const result = await coordinator.runCycle('owner', 'scheduled', 50, 1);

        expect(result).toEqual({ ok: true, value: { mode: 'info', jobs: 0, done: 0, failed: 0 } });
        expect(networkOps.enqueue).not.toHaveBeenCalled();
    });

    it('clears the alarm instead of scheduling when disabled', async () => {
        const { coordinator, scheduler } = makeCoordinator({
            helperMode: false,
            autoJobsEnabled: false,
        });

        await coordinator.scheduleNextRefresh();

        expect(scheduler.clear).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM);
        expect(scheduler.create).not.toHaveBeenCalled();
        expect(coordinator.nextRefreshAtValue()).toBeNull();
    });

    it('uses bounded recovery when Auto Jobs is enabled without a snapshot', async () => {
        const { coordinator, scheduler } = makeCoordinator({
            helperMode: false,
            autoJobsEnabled: true,
        });

        await coordinator.scheduleNextRefresh();

        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });
});

describe('AutoJobsCoordinator scheduled trigger', () => {
    function makeScheduledCoordinator() {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 100_000);
        (made.networkOps.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async (_request: unknown, run: () => Promise<unknown>) => ({ ok: true, value: await run() }));
        (made.markets.syncAll as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ jobs: [], markets: [] }));
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt: '1970-01-01T00:05:00.000Z', updatedAt: 0 }],
        });
        return made;
    }

    it('allows a scheduled trigger to refresh inside the min interval', async () => {
        const made = makeScheduledCoordinator();
        await made.coordinator.ensureInfo('ready', true, 1);
        await made.coordinator.ensureInfo('scheduled', true, 1);

        expect(made.networkOps.enqueue).toHaveBeenCalledTimes(2);
    });

    it('keeps per-market TTL for unrelated future markets', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 100_000);
        (made.networkOps.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async (_request: unknown, run: () => Promise<unknown>) => ({ ok: true, value: await run() }));
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: JOB_MARKETS.map((market) => ({ marketKey: market.key, label: market.label, ok: true, skipped: 0, resetAt: '1970-01-01T00:05:00.000Z', updatedAt: 99_999 })),
        });

        await made.coordinator.ensureInfo('scheduled', true, 1);

        expect(made.networkOps.enqueue).not.toHaveBeenCalled();
        expect(made.coordinator.lastSkipReasonText()).toBe('snapshot-fresh');
    });

    it('keeps manual-enable as an explicit full refresh', async () => {
        const made = makeScheduledCoordinator();
        await made.coordinator.ensureInfo('manual-enable', true, 1);

        expect(made.networkOps.enqueue).toHaveBeenCalledTimes(1);
    });

    it('keeps the min interval for ordinary non-scheduled refreshes', async () => {
        const made = makeScheduledCoordinator();
        await made.coordinator.ensureInfo('ready', true, 1);
        await made.coordinator.ensureInfo('ready', true, 1);

        expect(made.networkOps.enqueue).toHaveBeenCalledTimes(1);
        expect(made.coordinator.lastSkipReasonText()).toBe('recently-refreshed');
    });
});

describe('AutoJobsCoordinator schedule concurrency', () => {
    it('serializes concurrent schedules and keeps the latest decision', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.clear as ReturnType<typeof vi.fn>).mockImplementation(async () => new Promise((resolve) => setTimeout(resolve, 5)));
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: JOB_MARKETS.map((market) => ({ marketKey: market.key, label: market.label, ok: true, skipped: 0, resetAt: '1970-01-01T00:05:00.000Z' })),
        });

        const first = made.coordinator.scheduleNextRefresh();
        made.coordinator.publishSnapshot({
            at: 2,
            jobs: [],
            markets: JOB_MARKETS.map((market) => ({ marketKey: market.key, label: market.label, ok: true, skipped: 0, resetAt: '1970-01-01T00:00:00.000Z' })),
        });
        const second = made.coordinator.scheduleNextRefresh();
        await Promise.all([first, second]);

        expect(made.scheduler.create.mock.calls.at(-1)?.[1]).toEqual({ when: 61_000 });
    });

    it('logs and continues when clearing the old alarm fails', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('clear failed'));

        await made.coordinator.scheduleNextRefresh();

        expect(made.scheduler.create).toHaveBeenCalled();
        expect(made.coordinator.nextRefreshAtValue()).not.toBeNull();
    });

    it('logs a create failure instead of throwing', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementationOnce(() => { throw new Error('create failed'); });

        await made.coordinator.scheduleNextRefresh();

        expect(made.coordinator.nextRefreshAtValue()).not.toBeNull();
    });

    it('creates a repair alarm after normal create failures', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementation((alarm: string) => {
            if (alarm === AUTO_JOBS_INFO_ALARM) throw new Error('create failed');
        });

        await made.coordinator.scheduleNextRefresh();

        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_REPAIR_ALARM, { when: 31_000 });
        expect(made.coordinator.scheduleStateValue()).toBe('repair-pending');
        expect(made.coordinator.repairAtValue()).toBe(31_000);
        expect(made.coordinator.nextRefreshAtValue()).toBeNull();
    });

    it('handles clear and normal create failures together with a repair alarm', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.clear as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('clear failed'));
        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementation((alarm: string) => {
            if (alarm === AUTO_JOBS_INFO_ALARM) throw new Error('create failed');
        });

        await made.coordinator.scheduleNextRefresh();

        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_REPAIR_ALARM, { when: 31_000 });
        expect(made.coordinator.scheduleStateValue()).toBe('repair-pending');
    });

    it('marks scheduling unavailable when the repair alarm cannot be created', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementation(() => { throw new Error('alarm unavailable'); });

        await made.coordinator.scheduleNextRefresh();

        expect(made.coordinator.scheduleStateValue()).toBe('schedule-unavailable');
        expect(made.coordinator.repairAtValue()).toBeNull();
        expect(made.coordinator.nextRefreshAtValue()).toBeNull();
    });

    it('backs off repair attempts and recovers the normal alarm', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 1_000);
        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementation((alarm: string) => {
            if (alarm === AUTO_JOBS_INFO_ALARM) throw new Error('create failed');
        });

        await made.coordinator.scheduleNextRefresh();
        expect(made.coordinator.repairAtValue()).toBe(31_000);

        await made.coordinator.repairSchedule();
        expect(made.coordinator.repairAtValue()).toBe(61_000);

        (made.scheduler.create as ReturnType<typeof vi.fn>).mockImplementation(() => undefined);
        await made.coordinator.repairSchedule();

        expect(made.coordinator.scheduleStateValue()).toBe('scheduled');
        expect(made.coordinator.nextRefreshAtValue()).not.toBeNull();
        expect(made.scheduler.create.mock.calls.some(([alarm]) => alarm === AUTO_JOBS_INFO_ALARM)).toBe(true);
    });

    it('recomputes the alarm when a snapshot reset changes', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 100_000);
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: JOB_MARKETS.map((market) => ({ marketKey: market.key, label: market.label, ok: true, skipped: 0, resetAt: '1970-01-01T00:00:00.000Z' })),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const before = made.scheduler.create.mock.calls.length;

        made.coordinator.publishSnapshot({
            at: 2,
            jobs: [],
            markets: JOB_MARKETS.map((market) => ({ marketKey: market.key, label: market.label, ok: true, skipped: 0, resetAt: '1970-01-01T00:05:00.000Z' })),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(made.scheduler.create.mock.calls.length).toBeGreaterThan(before);
    });
});

describe('AutoJobsCoordinator per-market freshness', () => {
    function makeReadyCoordinator() {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, 100_000);
        (made.networkOps.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async (_request: unknown, run: () => Promise<unknown>) => ({ ok: true, value: await run() }));
        (made.markets.syncAll as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ jobs: [], markets: [] }));
        made.coordinator.publishSnapshot({
            at: 100_000,
            jobs: [],
            markets: [
                { marketKey: 'home', label: 'CORE', ok: true, skipped: 0, updatedAt: 99_900 },
                { marketKey: 'dark', label: 'D4RK', ok: true, skipped: 0, updatedAt: 0 },
                { marketKey: 'soyuz', label: 'SOYUZ', ok: false, skipped: 0, error: 'timeout' },
                { marketKey: 'usol', label: 'USOL', ok: true, skipped: 0, updatedAt: 0 },
            ],
        });
        return made;
    }

    it('refreshes only the markets whose data is stale', async () => {
        const made = makeReadyCoordinator();
        await made.coordinator.ensureInfo('ready', true, 1);
        const targets = (made.markets.syncAll as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as readonly { key: string }[] | undefined;
        expect(targets?.map((market) => market.key).sort()).toEqual(['dark', 'soyuz', 'usol']);
    });

    it('does no network work when every market is fresh', async () => {
        const made = makeReadyCoordinator();
        made.coordinator.publishSnapshot({
            at: 100_000,
            jobs: [],
            markets: [
                { marketKey: 'home', label: 'CORE', ok: true, skipped: 0, updatedAt: 99_900 },
                { marketKey: 'dark', label: 'D4RK', ok: true, skipped: 0, updatedAt: 99_900 },
                { marketKey: 'soyuz', label: 'SOYUZ', ok: true, skipped: 0, updatedAt: 99_900 },
                { marketKey: 'usol', label: 'USOL', ok: true, skipped: 0, updatedAt: 99_900 },
            ],
        });
        await made.coordinator.ensureInfo('ready', true, 1);
        expect(made.markets.syncAll).not.toHaveBeenCalled();
        expect(made.coordinator.lastSkipReasonText()).toBe('snapshot-fresh');
    });
});

describe('AutoJobsCoordinator reset completion', () => {
    const resetAt = '2026-11-16T04:00:00.000Z';
    const allMarkets = (at: string | null) => JOB_MARKETS.map((market) => ({
        marketKey: market.key,
        label: market.label,
        ok: true,
        skipped: 0,
        ...(at !== null ? { resetAt: at } : {}),
    }));
    const job = (id: string): JobOffer => ({
        id,
        name: id,
        type: 'Data Upload',
        marketId: 'home-market',
        marketKey: 'home',
        serverId: 'server-1',
        serverName: 'Server 1',
        rewardCredits: 0,
        rewardReputation: 0,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
    });

    function coordinatorWithCompletedJobs(
        completedJobs: Readonly<Record<string, string>>,
        available = true,
        jobs: readonly JobOffer[] = [job('new-job')],
        completedByMarket: Readonly<Record<string, Readonly<Record<string, string>>>> = { home: completedJobs },
    ) {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true });
        made.coordinator.attachAutoFinish({
            run: vi.fn(),
            lastRun: vi.fn(() => null),
            completedResetsSnapshot: () => ({}),
            completedJobsByMarketSnapshot: () => ({ byMarket: completedByMarket }),
            completionsAvailable: () => available,
        } as unknown as AutoFinishPort);
        made.coordinator.publishSnapshot({
            at: 1,
            jobs,
            markets: allMarkets(resetAt),
        });
        return made;
    }

    it('keeps the interval refresh when a new job appears in a completed reset', async () => {
        const { coordinator, scheduler } = coordinatorWithCompletedJobs({});
        await coordinator.scheduleNextRefresh();
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            delayInMinutes: 60,
            periodInMinutes: 60,
        });
    });

    it('wakes at a future reset countdown even when jobs are still pending', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true, autoJobsIntervalMinutes: 60 });
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [job('pending')],
            markets: allMarkets('1970-01-01T00:05:00.000Z'),
        });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 330_000 });
    });

    it('polls sooner when every known reset time is already past', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true, autoJobsIntervalMinutes: 60 });
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: allMarkets('1970-01-01T00:00:00.000Z'),
        });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });

    it('does not treat an unavailable completion state as complete', async () => {
        const { coordinator, scheduler } = coordinatorWithCompletedJobs({ 'new-job': resetAt }, false);
        await coordinator.scheduleNextRefresh();
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            delayInMinutes: 60,
            periodInMinutes: 60,
        });
    });

    function withMarketOverride(overrides: Record<string, Partial<{ resetAt: string | null; stale: boolean; ok: boolean }>>) {
        const markets = allMarkets(resetAt).map((market) => ({ ...market, ...overrides[market.marketKey] }));
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true }, 1_000);
        made.coordinator.publishSnapshot({ at: 1, jobs: [], markets });
        return made;
    }

    it('does not let a future market hide another past reset', async () => {
        const made = withMarketOverride({ home: { resetAt: '1970-01-01T00:00:00.000Z' } });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });

    it('gives a missing reset market a bounded recovery wake-up', async () => {
        const made = withMarketOverride({ home: { resetAt: null } });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });

    it('gives an invalid reset market a bounded recovery wake-up', async () => {
        const made = withMarketOverride({ home: { resetAt: 'not-a-date' } });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });

    it('gives an unavailable market a bounded recovery wake-up even with a future reset', async () => {
        const made = withMarketOverride({ home: { ok: false } });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 61_000 });
    });

    it('backs off repeated recovery attempts', async () => {
        let now = 100_000;
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: false }, () => now);
        (made.networkOps.enqueue as ReturnType<typeof vi.fn>).mockImplementation(async (_request: unknown, run: () => Promise<unknown>) => ({ ok: true, value: await run() }));
        (made.markets.syncAll as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ jobs: [], markets: [] }));
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: allMarkets('1970-01-01T00:00:00.000Z'),
        });

        await made.coordinator.ensureInfo('scheduled', true, 1);
        expect(made.scheduler.create.mock.calls.at(-1)?.[1]).toEqual({ when: 160_000 });

        now = 160_000;
        await made.coordinator.ensureInfo('scheduled', true, 1);
        expect(made.scheduler.create.mock.calls.at(-1)?.[1]).toEqual({ when: 280_000 });
    });

    it('schedules the next reset only when every current job is completed for that reset', async () => {
        const jobs = JOB_MARKETS.map((market) => ({ ...job('new-job'), marketKey: market.key }));
        const completedByMarket = Object.fromEntries(JOB_MARKETS.map((market) => [market.key, { 'new-job': resetAt }]));
        const { coordinator, scheduler } = coordinatorWithCompletedJobs({}, true, jobs, completedByMarket);
        await coordinator.scheduleNextRefresh();
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            when: Date.parse(resetAt) + 30_000,
        });
    });
});
