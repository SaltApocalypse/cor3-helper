import { describe, expect, it } from 'vitest';
import { resolveAutoFinishRunState, shouldUsePrefetched } from './auto-finish-options.js';
import { isCompletedForReset } from '../../../application/auto-job/completion.js';

const stored = {
    completedResets: { home: 'reset-home' },
    completedJobs: { 'job-1': 'reset-home' },
};

describe('resolveAutoFinishRunState', () => {
    it('keeps completion and retry state for a normal run', () => {
        const state = resolveAutoFinishRunState({}, stored);
        expect(state.completedResets).toBe(stored.completedResets);
        expect(state.completedJobs).toBe(stored.completedJobs);
        expect(state.clearAttempts).toBe(false);
        expect(state.clearLocks).toBe(false);
    });

    it('keeps completion records for a force refresh', () => {
        const state = resolveAutoFinishRunState({ forceRefresh: true }, stored);
        expect(state.completedResets).toBe(stored.completedResets);
        expect(state.completedJobs).toBe(stored.completedJobs);
        expect(state.clearAttempts).toBe(false);
        expect(state.clearLocks).toBe(false);
        expect(isCompletedForReset('job-1', state.completedJobs, 'reset-home')).toBe(true);
        expect(shouldUsePrefetched({ forceRefresh: true }, {})).toBe(false);
        expect(shouldUsePrefetched({}, {})).toBe(true);
        expect(shouldUsePrefetched({}, undefined)).toBe(false);
    });

    it('keeps completed records when retrying failed jobs', () => {
        const state = resolveAutoFinishRunState({ forceRefresh: true, retryFailed: true }, stored);
        expect(state.completedResets).toBe(stored.completedResets);
        expect(state.completedJobs).toBe(stored.completedJobs);
        expect(state.clearAttempts).toBe(true);
        expect(state.clearLocks).toBe(true);
    });

    it('keeps completed records when resetting only the retry budget', () => {
        const state = resolveAutoFinishRunState({ resetRetryBudget: true }, stored);
        expect(state.completedResets).toBe(stored.completedResets);
        expect(state.completedJobs).toBe(stored.completedJobs);
        expect(state.clearAttempts).toBe(true);
        expect(state.clearLocks).toBe(true);
    });

    it('clears completion and retry state only for an explicit local reset', () => {
        const state = resolveAutoFinishRunState({ clearLocalState: true }, stored);
        expect(state.completedResets).toEqual({});
        expect(state.completedJobs).toEqual({});
        expect(state.clearAttempts).toBe(true);
        expect(state.clearLocks).toBe(true);
    });
});
