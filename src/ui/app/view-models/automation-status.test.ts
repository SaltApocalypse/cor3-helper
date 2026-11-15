import { describe, expect, it } from 'vitest';
import { hasOverviewTimerData, isAutomationDebugLive } from './automation-status.js';

describe('isAutomationDebugLive', () => {
    it('is false when nothing runs', () => {
        expect(isAutomationDebugLive({})).toBe(false);
        expect(isAutomationDebugLive({
            autoJobsRunning: false,
            autoFinishRunning: false,
            jobRunActive: false,
            autoDailyRunning: false,
            autoDroneRunning: false,
            autoExpeditionRunning: false,
            autoMailRunning: false,
            valuableActive: false,
        })).toBe(false);
    });

    it.each([
        'autoJobsRunning',
        'autoFinishRunning',
        'jobRunActive',
        'autoDailyRunning',
        'autoDroneRunning',
        'autoExpeditionRunning',
        'autoMailRunning',
        'valuableActive',
    ] as const)('is true while %s is active', (flag) => {
        expect(isAutomationDebugLive({ [flag]: true })).toBe(true);
    });
});

describe('hasOverviewTimerData', () => {
    const empty = { expansions: [], offers: [], available: false };

    it('is false without timers', () => {
        expect(hasOverviewTimerData({ daily: null, specialists: null, networkDiag: null })).toBe(false);
        expect(hasOverviewTimerData({
            daily: { hasClaimedToday: false, currentStreak: 0, difficulty: 'easy', nextTaskTime: null, streakBonus: null },
            specialists: empty,
            networkDiag: null,
        })).toBe(false);
    });

    it('detects a daily reset, a stash expiry or maintenance', () => {
        expect(hasOverviewTimerData({
            daily: { hasClaimedToday: false, currentStreak: 0, difficulty: 'easy', nextTaskTime: '2026-01-01T00:00:00.000Z', streakBonus: null },
            specialists: null,
            networkDiag: null,
        })).toBe(true);
        expect(hasOverviewTimerData({
            daily: null,
            specialists: { ...empty, expansions: [{ id: 'e1', expiresAt: '2026-01-01T00:00:00.000Z' } as never] },
            networkDiag: null,
        })).toBe(true);
        expect(hasOverviewTimerData({
            daily: null,
            specialists: null,
            networkDiag: { maintenance: [{ serverId: 's1' }] } as never,
        })).toBe(true);
    });
});
