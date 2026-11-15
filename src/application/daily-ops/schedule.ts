import type { DailyOpsState } from '../../domains/daily-ops/model.js';

export type DailyScheduleReason = 'state-unavailable' | 'unclaimed' | 'next-task' | 'unknown-reset';

export interface DailyScheduleDecision {
    readonly at: number;
    readonly reason: DailyScheduleReason;
}

export interface DailyScheduleInput {
    readonly now: number;
    readonly state: DailyOpsState | null;
    readonly intervalMinutes: number;
}

export const DAILY_HACK_RETRY_MS = 5 * 60_000;
export const DAILY_HACK_GRACE_MS = 30_000;
export const DAILY_HACK_UNKNOWN_RESET_MS = 15 * 60_000;

/**
 * Decides when Auto Daily should wake up.
 *
 * - unknown/unclaimed state: retry soon instead of sleeping for the full interval
 * - claimed with a real future reset: wake just after that reset
 * - claimed without a usable reset time: poll at a bounded interval so the next
 *   daily reset cannot be skipped by the default 4-hour polling interval
 */
export function planNextDailyRun(input: DailyScheduleInput): DailyScheduleDecision {
    const { now, state } = input;
    const nextAt = state?.nextTaskTime ? new Date(state.nextTaskTime).getTime() : Number.NaN;
    if (!state || !state.hasClaimedToday) {
        return {
            at: now + DAILY_HACK_RETRY_MS,
            reason: state ? 'unclaimed' : 'state-unavailable',
        };
    }
    if (Number.isFinite(nextAt) && nextAt > now + 60_000) {
        return { at: nextAt + DAILY_HACK_GRACE_MS, reason: 'next-task' };
    }
    return {
        at: now + Math.min(input.intervalMinutes * 60_000, DAILY_HACK_UNKNOWN_RESET_MS),
        reason: 'unknown-reset',
    };
}
