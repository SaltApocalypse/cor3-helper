import { describe, expect, it } from 'vitest';
import type { AutoFinishFailure } from '../../../contracts/auto-finish.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import { ok } from '../../../kernel/result.js';
import { computeAutoFinishRetry } from './auto-finish-retry.js';

const SETTINGS = { autoFinishEnabled: true } as SettingsV1;

function settings(value: Partial<SettingsV1> = SETTINGS) {
    return {
        get: async () => value as SettingsV1,
        update: async () => value as SettingsV1,
    };
}

function snapshots(maintenanceEndsAt?: string) {
    return {
        get: async () => ok({
            servers: new Map(maintenanceEndsAt ? [['s1', {
                id: 's1',
                maintenance: { active: true, endsAt: maintenanceEndsAt },
            }]] : []),
        } as never),
    };
}

function failure(patch: Partial<AutoFinishFailure>): AutoFinishFailure {
    return {
        jobId: 'job-1',
        name: 'Job',
        serverName: null,
        code: 'MINIGAME_FAILED',
        message: 'locked',
        ...patch,
    };
}

describe('Auto Finish retry scheduling', () => {
    it('does not schedule when Auto Finish is disabled', async () => {
        const decision = await computeAutoFinishRetry(
            settings({ autoFinishEnabled: false } as SettingsV1),
            snapshots(),
            1_000,
            [failure({ lockExpiresAt: 10_000 })],
            false,
        );
        expect(decision).toBeNull();
    });

    it('retries shortly after a minigame lock expires', async () => {
        const decision = await computeAutoFinishRetry(
            settings(),
            snapshots(),
            1_000,
            [failure({ lockExpiresAt: 10_000 })],
            false,
        );
        expect(decision).toEqual({ at: 25_000, reason: 'minigame lock' });
    });

    it('uses the maintenance window when no job retry is sooner', async () => {
        const decision = await computeAutoFinishRetry(
            settings(),
            snapshots('1970-01-01T00:01:00.000Z'),
            1_000,
            [],
            true,
        );
        expect(decision).toEqual({ at: 75_000, reason: 'maintenance' });
    });

    it('falls back to a ten minute retry when failures carry no timing', async () => {
        const decision = await computeAutoFinishRetry(settings(), snapshots(), 1_000, [failure({})], false);
        expect(decision).toEqual({ at: 616_000, reason: 'retry' });
    });
});
