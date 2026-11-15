import { describe, expect, it } from 'vitest';
import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import {
    DAILY_HACK_GRACE_MS,
    DAILY_HACK_RETRY_MS,
    DAILY_HACK_UNKNOWN_RESET_MS,
    planNextDailyRun,
} from './schedule.js';

const now = Date.parse('2026-11-12T10:00:00.000Z');

function state(overrides: Partial<DailyOpsState>): DailyOpsState {
    return {
        hasClaimedToday: false,
        currentStreak: 3,
        difficulty: 'normal',
        nextTaskTime: null,
        streakBonus: null,
        ...overrides,
    };
}

describe('planNextDailyRun', () => {
    it('retries soon when the daily state is unavailable', () => {
        expect(planNextDailyRun({ now, state: null, intervalMinutes: 240 })).toEqual({
            at: now + DAILY_HACK_RETRY_MS,
            reason: 'state-unavailable',
        });
    });

    it('retries soon while today is still unclaimed', () => {
        expect(planNextDailyRun({
            now,
            state: state({ nextTaskTime: '2026-11-13T00:00:00.000Z' }),
            intervalMinutes: 240,
        })).toEqual({ at: now + DAILY_HACK_RETRY_MS, reason: 'unclaimed' });
    });

    it('wakes just after a real future reset when today is claimed', () => {
        const reset = '2026-11-13T00:00:00.000Z';
        expect(planNextDailyRun({
            now,
            state: state({ hasClaimedToday: true, nextTaskTime: reset }),
            intervalMinutes: 240,
        })).toEqual({
            at: Date.parse(reset) + DAILY_HACK_GRACE_MS,
            reason: 'next-task',
        });
    });

    it('polls at a bounded interval when the reset timestamp is stale', () => {
        expect(planNextDailyRun({
            now,
            state: state({ hasClaimedToday: true, nextTaskTime: '2026-11-12T00:00:00.000Z' }),
            intervalMinutes: 240,
        })).toEqual({ at: now + DAILY_HACK_UNKNOWN_RESET_MS, reason: 'unknown-reset' });
    });

    it('polls at a bounded interval when the reset timestamp is missing', () => {
        expect(planNextDailyRun({
            now,
            state: state({ hasClaimedToday: true }),
            intervalMinutes: 240,
        })).toEqual({ at: now + DAILY_HACK_UNKNOWN_RESET_MS, reason: 'unknown-reset' });
    });
});
