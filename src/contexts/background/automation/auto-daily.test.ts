import { describe, expect, it } from 'vitest';
import { settingsV1Schema } from '../../../contracts/storage.js';
import { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { DailyOpsCacheStore } from '../../../infrastructure/storage/daily-ops-cache-store.js';
import { MemoryStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { AUTO_DAILY_HACK_ALARM } from './alarm-ids.js';
import { AutoDailyCoordinator, isAutoDailyLoading, isAutoDailyWaiting } from './auto-daily.js';
import { DailyOpsCacheService } from './daily-cache.js';

describe('Auto Daily waiting state', () => {
    it('does not treat an already-claimed daily as an error', () => {
        expect(isAutoDailyWaiting({
            at: 1,
            solved: false,
            puzzle: 'claimed',
            message: 'Already claimed today; waiting for next reset',
        })).toBe(true);
    });

    it('recognizes startup data-not-ready states as loading', () => {
        expect(isAutoDailyLoading({
            at: 1,
            solved: false,
            puzzle: 'unknown',
            message: 'No cor3.gg tab found',
        })).toBe(true);
        expect(isAutoDailyLoading({
            at: 1,
            solved: false,
            puzzle: 'unknown',
            message: 'Daily hack failed: unexpected error',
        })).toBe(false);
    });

    it('keeps real failures visible', () => {
        expect(isAutoDailyWaiting({
            at: 1,
            solved: false,
            puzzle: 'unknown',
            message: 'Daily hack failed: no game WebSocket is available',
        })).toBe(false);
        expect(isAutoDailyWaiting(null)).toBe(false);
    });

    it('retries instead of solving when the daily state is unavailable', async () => {
        let solveCalls = 0;
        const created: string[] = [];
        const settings = {
            ...settingsV1Schema.parse({}),
            dailyHackEnabled: true,
            helperMode: false,
        };
        const adapter = {
            getDailyOps: async () => ({ ok: false as const, error: { code: 'GAME_NO_SOCKET', message: 'No game WebSocket' } }),
            getRewards: async () => ({ ok: true as const, value: [] }),
            solveHack: async () => { solveCalls += 1; return { ok: true as const, value: { solved: true } }; },
            cancelHack: async () => ({ ok: true as const, value: undefined }),
        };
        const cache = new DailyOpsCacheService({
            adapter,
            store: new DailyOpsCacheStore(new MemoryStorageArea()),
            clock: { now: () => 1_000 },
        });
        const coordinator = new AutoDailyCoordinator({
            settings: {
                get: async () => settings,
                update: async () => settings,
            },
            scheduler: {
                create: (alarm) => { created.push(alarm); },
                clear: async () => undefined,
                get: async () => null,
            },
            events: { publish: () => undefined },
            logger: {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            },
            clock: { now: () => 1_000 },
            state: new AutomationStateStore(new MemoryStorageArea(), () => 1_000),
            adapter,
            cache,
            networkOps: {
                enqueue: async (_request, run) => run({ id: '1', owner: 'daily', reason: 'test', isCancelled: () => false }),
            },
        });

        await coordinator.runExclusive();
        expect(solveCalls).toBe(0);
        expect(created).toContain(AUTO_DAILY_HACK_ALARM);
    });
});
