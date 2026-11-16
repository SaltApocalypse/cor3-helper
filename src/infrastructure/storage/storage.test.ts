import { describe, expect, it } from 'vitest';
import { MemoryStorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';
import { z } from 'zod';
import { SettingsRepository } from './settings-repository.js';
import { MarketCacheStore } from './market-cache-store.js';
import { settingsV1Schema } from '../../contracts/storage.js';

const schema = z.object({ value: z.number() });

describe('VersionedRepository', () => {
    it('round-trips a schema-validated value', async () => {
        const area = new MemoryStorageArea();
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1, clock: { now: () => 42 } });
        await repo.set({ value: 7 });
        expect(await repo.get()).toEqual({ value: 7 });
        expect(await area.get('test')).toEqual({ test: { schemaVersion: 1, writtenAt: 42, data: { value: 7 } } });
    });

    it('ignores an incompatible schema version', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { schemaVersion: 99, writtenAt: 1, data: { value: 7 } } });
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        expect(await repo.get()).toBeNull();
    });

    it('ignores malformed data', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { nope: true } });
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        expect(await repo.get()).toBeNull();
    });
});

describe('SettingsRepository', () => {
    it('returns defaults and persists a patch', async () => {
        const repo = new SettingsRepository(new MemoryStorageArea(), { now: () => 1 });
        const defaults = await repo.get();
        expect(defaults.uiLanguage).toBe('en');
        expect(defaults.languageInitialized).toBe(false);
        expect(defaults.helperMode).toBe(true);
        expect(defaults.helperModeConsent).toBe(false);
        expect(defaults.helperModeSaved).toBeNull();
        expect(defaults.disableNetworkFog).toBe(false);
        expect(defaults.disableBackground).toBe(false);
        expect(defaults.moveNotificationsLeft).toBe(false);
        expect(defaults.antiAfkEnabled).toBe(false);
        expect(defaults.saiFileHighlightEnabled).toBe(false);
        expect(defaults.autoCompleteJobTypes).toHaveLength(9);
        expect(defaults.autoDismissFailedJobsEnabled).toBe(false);
        expect(defaults.mercMinCreditsEnabled).toBe(false);
        expect(defaults.mercMinCredits).toBe(50000);

        const updated = await repo.update({ uiLanguage: 'zh', autoDismissFailedJobsEnabled: true });
        expect(updated.uiLanguage).toBe('zh');
        expect(updated.autoDismissFailedJobsEnabled).toBe(true);
        expect((await repo.get()).uiLanguage).toBe('zh');
    });

    it('does not apply defaults to fields omitted from a patch', async () => {
        const repo = new SettingsRepository(new MemoryStorageArea(), { now: () => 1 });
        await repo.update({ autoJobsEnabled: true, autoFinishEnabled: true });
        const patched = await repo.update({ panelOpenState: { 'auto-jobs': true } });
        expect(patched.autoJobsEnabled).toBe(true);
        expect(patched.autoFinishEnabled).toBe(true);
        expect(patched.panelOpenState).toEqual({ 'auto-jobs': true });
    });

    it('ignores removed setting keys instead of resetting every setting', async () => {
        const area = new MemoryStorageArea();
        const data = {
            ...settingsV1Schema.parse({}),
            autoJobsEnabled: true,
            autoUpdateMarketsEnabled: true,
        };
        await area.set({ 'v2.settings': { schemaVersion: 1, writtenAt: 1, data } });
        const repo = new SettingsRepository(area, { now: () => 1 });
        const settings = await repo.get();
        expect(settings.autoJobsEnabled).toBe(true);
        expect(settings.uiLanguage).toBe('en');
    });

    it('migrates the removed drone veterans policy to loot-first', async () => {
        const area = new MemoryStorageArea();
        const data = {
            ...settingsV1Schema.parse({}),
            droneDecisionPolicy: 'veterans',
        };
        await area.set({ 'v2.settings': { schemaVersion: 1, writtenAt: 1, data } });
        const repo = new SettingsRepository(area, { now: () => 1 });
        expect((await repo.get()).droneDecisionPolicy).toBe('loot');
    });
});


describe('MarketCacheStore', () => {
    it('drops a cached view that no longer matches the market schema', async () => {
        const area = new MemoryStorageArea();
        await area.set({
            'v2.market.cache': {
                schemaVersion: 1,
                writtenAt: 1,
                data: { markets: { home: { at: 1, view: { bad: true } } } },
            },
        });
        const store = new MarketCacheStore(area);
        expect(await store.get('home')).toBeNull();
    });
});

describe('SettingsRepository concurrent patches', () => {
    it('does not let a panel-state write clobber a simultaneous enable', async () => {
        const repo = new SettingsRepository(new MemoryStorageArea(), { now: () => 1 });
        await Promise.all([
            repo.update({ autoJobsEnabled: true, dailyHackEnabled: true }),
            repo.update({ panelOpenState: { 'auto-jobs': true } }),
        ]);
        const stored = await repo.get();
        expect(stored.autoJobsEnabled).toBe(true);
        expect(stored.dailyHackEnabled).toBe(true);
    });
});
