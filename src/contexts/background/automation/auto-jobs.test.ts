import { describe, expect, it, vi } from 'vitest';
import { settingsV1Schema, type SettingsV1 } from '../../../contracts/storage.js';
import { AUTO_JOBS_INFO_ALARM } from './alarm-ids.js';
import { AutoJobsCoordinator, type AutoFinishPort, type AutoJobsDeps } from './auto-jobs.js';
import type { JobOffer } from '../../../domains/jobs/model.js';

function makeCoordinator(overrides: Partial<SettingsV1>) {
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
        clock: { now: () => 1_000 },
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

    it('schedules the next reset only when every current job is completed for that reset', async () => {
        const { coordinator, scheduler } = coordinatorWithCompletedJobs({ 'new-job': resetAt });
        await coordinator.scheduleNextRefresh();
        expect(scheduler.create).toHaveBeenCalledWith(AUTO_JOBS_INFO_ALARM, {
            when: Date.parse(resetAt) + 30_000,
        });
    });
});
