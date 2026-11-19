import { describe, expect, it } from 'vitest';
import { isCompletedForReset, UNKNOWN_RESET } from './completion.js';

describe('isCompletedForReset', () => {
    const completed = { 'job-1': 'reset-a' };

    it('returns false when the job has no completion record', () => {
        expect(isCompletedForReset('job-2', completed, 'reset-a')).toBe(false);
    });

    it('suppresses a job completed for the current reset', () => {
        expect(isCompletedForReset('job-1', completed, 'reset-a')).toBe(true);
    });

    it('allows a job completed for an older, different reset', () => {
        expect(isCompletedForReset('job-1', completed, 'reset-b')).toBe(false);
    });

    it('keeps a completed job suppressed when the current reset is unknown', () => {
        expect(isCompletedForReset('job-1', completed, null)).toBe(true);
    });

    it('does not apply an unknown-reset completion to a later known reset', () => {
        const unknown = { 'job-1': UNKNOWN_RESET };
        expect(isCompletedForReset('job-1', unknown, 'reset-b')).toBe(false);
        expect(isCompletedForReset('job-1', unknown, null)).toBe(true);
    });
});
