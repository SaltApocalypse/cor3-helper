import { describe, expect, it, vi } from 'vitest';
import { settingsV1Schema, type SettingsV1 } from '../../../contracts/storage.js';
import { AUTO_JOBS_INFO_ALARM } from './alarm-ids.js';
import { AutoJobsCoordinator, type AutoFinishPort, type AutoJobsDeps } from './auto-jobs.js';
import type { JobOffer } from '../../../domains/jobs/model.js';

function makeCoordinator(overrides: Partial<SettingsV1>, now = 1_000) {
    const settings = settingsV1Schema.parse(overrides);
    const tabs = { findCor3Tab: vi.fn(async () => 1) };
    const networkOps = { enqueue: vi.fn() };
    const scheduler = {
        create: vi.fn(),
        clear: vi.fn(async () => undefined),
        get: vi.fn(async () => null),
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
        clock: { now: () => now },
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

    it('schedules the interval alarm when Auto Jobs is enabled', async () => {
        const { coordinator, scheduler } = makeCoordinator({
            helperMode: false,
            autoJobsEnabled: true,
        });

        await coordinator.scheduleNextRefresh();

        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            delayInMinutes: 60,
            periodInMinutes: 60,
        });
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

    function coordinatorWithCompletedJobs(completedJobs: Readonly<Record<string, string>>) {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true });
        made.coordinator.attachAutoFinish({
            run: vi.fn(),
            lastRun: vi.fn(() => null),
            completedResetsSnapshot: () => ({}),
            completedJobsSnapshot: () => completedJobs,
        } as unknown as AutoFinishPort);
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [job('new-job')],
            markets: [{ marketKey: 'home', label: 'HOME', ok: true, skipped: 0, resetAt }],
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
            markets: [{
                marketKey: 'home',
                label: 'HOME',
                ok: true,
                skipped: 0,
                resetAt: '1970-01-01T00:05:00.000Z',
            }],
        });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 330_000 });
    });

    it('polls sooner when every known reset time is already past', async () => {
        const made = makeCoordinator({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true, autoJobsIntervalMinutes: 60 });
        made.coordinator.publishSnapshot({
            at: 1,
            jobs: [],
            markets: [{
                marketKey: 'home',
                label: 'HOME',
                ok: true,
                skipped: 0,
                resetAt: '1970-01-01T00:00:00.000Z',
            }],
        });
        await made.coordinator.scheduleNextRefresh();
        expect(made.scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, { when: 601_000 });
    });

    it('schedules the next reset only when every current job is completed for that reset', async () => {
        const { coordinator, scheduler } = coordinatorWithCompletedJobs({ 'new-job': resetAt });
        await coordinator.scheduleNextRefresh();
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            when: Date.parse(resetAt) + 30_000,
        });
    });
});
