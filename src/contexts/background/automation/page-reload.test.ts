import { describe, expect, it, vi } from 'vitest';
import { PageReloadCoordinator, type PageReloadDeps } from './page-reload.js';
import { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { settingsV1Schema } from '../../../contracts/storage.js';

function makeCoordinator(now = { value: 1_000_000 }) {
    const settings = settingsV1Schema.parse({ helperMode: false, autoJobsEnabled: true, autoFinishEnabled: true });
    const state = new AutomationStateStore(new MemoryStorageArea(), () => now.value);
    const autoJobs = {
        isRunning: vi.fn(() => true),
        cancel: vi.fn(),
        resetAfterPageReload: vi.fn(),
        ensureInfo: vi.fn(async () => undefined),
    };
    const autoFinish = {
        isRunning: vi.fn(() => true),
        cancel: vi.fn(async () => undefined),
        runExclusive: vi.fn(async () => ({ ok: true })),
    };
    const tabs = {
        findCor3Tab: vi.fn(async () => 7),
        reload: vi.fn(async () => undefined),
    };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const deps: PageReloadDeps = {
        tabs,
        settings: { get: async () => settings, update: async () => settings },
        state,
        autoJobs,
        autoFinish,
        logger,
        events: { publish: vi.fn() },
        clock: { now: () => now.value },
    };
    return { coordinator: new PageReloadCoordinator(deps), deps, now, tabs, autoJobs, autoFinish };
}

describe('PageReloadCoordinator', () => {
    it('reloads only automation runs and resumes with a full refresh', async () => {
        const made = makeCoordinator();
        expect(await made.coordinator.request('awaiting secure channel', 'ice-wall')).toBe(true);
        expect(made.autoJobs.cancel).toHaveBeenCalled();
        expect(made.autoFinish.cancel).toHaveBeenCalled();
        expect(made.tabs.reload).toHaveBeenCalledWith(7);

        await made.coordinator.handleGameReady(7);
        expect(made.autoJobs.resetAfterPageReload).toHaveBeenCalled();
        expect(made.autoJobs.ensureInfo).toHaveBeenCalledWith('reload-ready', true, 7, true);
    });

    it('ignores readiness from a different tab while a reload is pending', async () => {
        const made = makeCoordinator();
        await made.coordinator.request('stuck', 'ice-wall');
        await made.coordinator.handleGameReady(8);
        expect(made.autoJobs.resetAfterPageReload).not.toHaveBeenCalled();
    });

    it('allows at most two reloads per ten-minute window', async () => {
        const made = makeCoordinator();
        expect(await made.coordinator.request('stuck', 'ice-wall')).toBe(true);
        await made.coordinator.handleGameReady(7);
        expect(await made.coordinator.request('stuck', 'ice-wall')).toBe(true);
        await made.coordinator.handleGameReady(7);
        expect(await made.coordinator.request('stuck', 'ice-wall')).toBe(false);

        made.now.value += 10 * 60_000 + 1;
        expect(await made.coordinator.request('stuck', 'ice-wall')).toBe(true);
    });
});
