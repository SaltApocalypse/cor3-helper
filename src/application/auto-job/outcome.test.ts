import { describe, expect, it } from 'vitest';
import { classifyJobFailure } from './outcome.js';

describe('classifyJobFailure', () => {
    it('treats missing capabilities and type selection as skipped', () => {
        expect(classifyJobFailure({ code: 'PREFLIGHT_FAILED', message: 'Missing required software: HACK Core' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'DECRYPT_POWER_INSUFFICIENT', message: 'Insufficient decrypt power (12)' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'TYPE_DISABLED', message: 'Job type disabled' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'NO_SERVER', message: 'No target server' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'LOADOUT_NO_PLAN', message: 'NO_SOFTWARE' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'LOADOUT_NO_PLAN', message: 'NO_SOFTWARE' }).status).toBe('skipped');
    });

    it('retries conditions-not-met and server-state failures', () => {
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'job-conditions-not-met' }).status).toBe('retry');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'FILE_NOT_FOUND', message: 'No file found in the Downloads folder' }).status).toBe('retry');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'MINIGAME_FAILED', message: 'ice-wall minigame was not solved' }).status).toBe('retry');
    });

    it('keeps minigame lock retryAt', () => {
        const outcome = classifyJobFailure({ code: 'PREFLIGHT_FAILED', message: 'Minigame locked (~12m remaining)', lockExpiresAt: 1234 });
        expect(outcome).toEqual({ status: 'retry', reason: 'minigame-lock', retryAt: 1234 });
    });

    it('marks game-reported expiry as expired', () => {
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'job-not-found' }).status).toBe('expired');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'job is no longer available' }).status).toBe('expired');
    });

    it('marks network failures as retry', () => {
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'No game WebSocket is available' }).status).toBe('retry');
        expect(classifyJobFailure({ code: 'ROUTE_FAILED', message: 'All route attempts failed' }).status).toBe('retry');
    });

    it('retries completion when the market endpoint is unreachable', () => {
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'market-not-reachable' }).status).toBe('retry');
    });

    it('reserves failed for unknown non-retryable errors', () => {
        expect(classifyJobFailure({ code: 'UNSUPPORTED_JOB_TYPE', message: 'Unsupported job type: Foo' }).status).toBe('skipped');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'unexpected invariant', retryable: false }).status).toBe('failed');
        expect(classifyJobFailure({ code: 'JOB_FAILED', detailCode: 'COMPLETE_FAILED', message: 'unexpected invariant' }).status).toBe('failed');
        expect(classifyJobFailure({ code: 'SOMETHING_NEW', message: 'boom' }).status).toBe('failed');
    });

    it('does not retry an unconfirmed completion even for retryable text', () => {
        expect(classifyJobFailure({
            code: 'JOB_FAILED',
            detailCode: 'COMPLETE_FAILED',
            message: 'Timed out waiting for desktop:complete',
            unconfirmed: true,
        })).toEqual({ status: 'failed', reason: 'unknown' });
        expect(classifyJobFailure({
            code: 'JOB_FAILED',
            detailCode: 'COMPLETE_FAILED',
            message: 'job-conditions-not-met',
            unconfirmed: true,
        })).toEqual({ status: 'failed', reason: 'unknown' });
    });

    it('keeps cancelled jobs out of failed', () => {
        expect(classifyJobFailure({ code: 'JOB_CANCELLED', message: 'Job run cancelled', stage: 'cancelled' }).status).toBe('skipped');
    });
});
