import { describe, expect, it } from 'vitest';
import { lifecycleStatusForFailure } from './lifecycle.js';

describe('lifecycleStatusForFailure', () => {
    it('does not turn an unconfirmed complete into failure or success', () => {
        expect(lifecycleStatusForFailure({ code: 'COMPLETE_FAILED', message: 'Timed out waiting for desktop:complete' }))
            .toBe('unknown');
        expect(lifecycleStatusForFailure({ code: 'GAME_TIMEOUT', message: 'No response' })).toBe('unknown');
        expect(lifecycleStatusForFailure({ code: 'TAKE_FAILED', message: 'socket disconnected' })).toBe('unknown');
    });

    it('keeps a minigame lock or failure in waiting-minigame', () => {
        expect(lifecycleStatusForFailure({ code: 'PREFLIGHT_FAILED', message: 'Minigame locked (~5m remaining)' }))
            .toBe('waiting-minigame');
        expect(lifecycleStatusForFailure({ code: 'MINIGAME_FAILED', message: 'ice-wall was not solved' }))
            .toBe('waiting-minigame');
        expect(lifecycleStatusForFailure({ code: 'ACTION_FAILED', message: 'blocked', lockExpiresAt: 10 }))
            .toBe('waiting-minigame');
    });

    it('keeps retryable completion conditions as ready-to-claim', () => {
        expect(lifecycleStatusForFailure({ code: 'COMPLETE_FAILED', message: 'job conditions not met' }))
            .toBe('ready-to-claim');
    });

    it('uses blocked for preflight, no-server, unsupported and route blockers', () => {
        expect(lifecycleStatusForFailure({ code: 'PREFLIGHT_FAILED', message: 'Missing required software: HACK' }))
            .toBe('blocked');
        expect(lifecycleStatusForFailure({ code: 'NO_SERVER', message: 'Job has no server id' })).toBe('blocked');
        expect(lifecycleStatusForFailure({ code: 'UNSUPPORTED_JOB_TYPE', message: 'unsupported' })).toBe('blocked');
        expect(lifecycleStatusForFailure({ code: 'MINIGAME_REQUIRED', message: 'No minigame adapter is configured' }))
            .toBe('blocked');
        expect(lifecycleStatusForFailure({ code: 'ACTION_FAILED', message: 'route blocked', stage: 'route' }))
            .toBe('blocked');
    });

    it('uses expired for terminal game expiry and failed for an explicit action failure', () => {
        expect(lifecycleStatusForFailure({ code: 'TAKE_FAILED', message: 'job-not-found' })).toBe('expired');
        expect(lifecycleStatusForFailure({ code: 'ACTION_FAILED', message: 'could not delete file' })).toBe('failed');
        expect(lifecycleStatusForFailure({ code: 'COMPLETE_FAILED', message: 'complete rejected' })).toBe('failed');
    });
});
