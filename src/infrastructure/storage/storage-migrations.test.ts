import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MemoryStorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';
import { DailyOpsCacheStore } from './daily-ops-cache-store.js';
import { FeatureAvailabilityStore } from './feature-availability-store.js';
import { AutomationStateStore } from './automation-state-store.js';
import { ChromeStorageDiscoveryProgressStore } from './discovery-progress-store.js';

const simpleSchema = z.object({ value: z.number() });

describe('VersionedRepository migrations', () => {
    it('migrates a legacy unversioned payload', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { value: 3 } });
        const repo = new VersionedRepository({
            area,
            key: 'test',
            schema: simpleSchema,
            schemaVersion: 2,
            migrate: (data, fromVersion) => fromVersion === 0 ? simpleSchema.parse(data) : null,
        });
        expect(await repo.get()).toEqual({ value: 3 });
    });

    it('migrates an older envelope version', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { schemaVersion: 1, writtenAt: 1, data: { value: 4 } } });
        const repo = new VersionedRepository({
            area,
            key: 'test',
            schema: simpleSchema,
            schemaVersion: 2,
            migrate: (data, fromVersion) => fromVersion === 1 ? simpleSchema.parse(data) : null,
        });
        expect(await repo.get()).toEqual({ value: 4 });
    });

    it('does not migrate a future envelope version', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { schemaVersion: 99, writtenAt: 1, data: { value: 9 } } });
        const repo = new VersionedRepository({
            area,
            key: 'test',
            schema: simpleSchema,
            schemaVersion: 2,
            migrate: (_data, fromVersion) => fromVersion < 2 ? { value: 0 } : null,
        });
        expect(await repo.get()).toBeNull();
    });
});

describe('store migrations', () => {
    it('reads legacy daily ops cache data and writes a versioned envelope', async () => {
        const area = new MemoryStorageArea();
        const legacy = {
            at: 5,
            value: {
                hasClaimedToday: true,
                currentStreak: 2,
                difficulty: 'hard',
                nextTaskTime: null,
                streakBonus: null,
            },
        };
        await area.set({ 'v2.dailyOpsCache': legacy });
        const store = new DailyOpsCacheStore(area);
        expect(await store.get()).toEqual(legacy);
        await store.set(legacy.value);
        expect((await area.get('v2.dailyOpsCache'))['v2.dailyOpsCache']).toMatchObject({ schemaVersion: 1 });
    });

    it('reads legacy feature availability data', async () => {
        const area = new MemoryStorageArea();
        await area.set({
            'v2.featureAvailability': {
                mercenaryExpedition: false,
                droneExpedition: true,
                stashExpansion: false,
                updatedAt: 9,
            },
        });
        const store = new FeatureAvailabilityStore(area);
        expect(await store.get()).toMatchObject({
            mercenaryExpedition: false,
            droneExpedition: true,
            stashExpansion: false,
            updatedAt: 9,
        });
    });

    it('reads legacy automation state and persists a versioned write', async () => {
        const area = new MemoryStorageArea();
        await area.set({
            'v2.automationState': {
                'auto-jobs': {
                    phase: 'idle',
                    runId: null,
                    startedAt: 0,
                    updatedAt: 1,
                    nextActionAt: null,
                    attempts: 0,
                    lastError: null,
                    payload: {},
                    leaseOwner: null,
                    leaseExpiresAt: null,
                },
            },
        });
        const store = new AutomationStateStore(area, () => 10);
        expect((await store.get('auto-jobs')).phase).toBe('idle');
        await store.set('auto-jobs', { attempts: 1 });
        expect((await area.get('v2.automationState'))['v2.automationState']).toMatchObject({ schemaVersion: 1 });
    });

    it('reads legacy discovery progress data', async () => {
        const area = new MemoryStorageArea();
        await area.set({
            'v2.discovery.progress': {
                fingerprint: 'map-1',
                scannedIps: ['10.0.0.1'],
                startedAt: 2,
            },
        });
        const store = new ChromeStorageDiscoveryProgressStore(area);
        expect(await store.get()).toEqual({
            fingerprint: 'map-1',
            scannedIps: ['10.0.0.1'],
            startedAt: 2,
        });
    });
});
