import { describe, expect, it } from 'vitest';
import { DismissFailedJobsService, type FailedJobRef } from './dismiss.js';

const job = (id: string, marketKey = 'home'): FailedJobRef => ({
    id,
    name: 'File Decryption',
    marketId: `market-${marketKey}`,
    marketKey,
});

describe('DismissFailedJobsService', () => {
    it('dismisses every job and records failures', async () => {
        const seen: string[] = [];
        const service = new DismissFailedJobsService({
            dismiss: async (entry) => {
                seen.push(entry.id);
                return entry.id === 'bad'
                    ? { ok: false, error: { code: 'GAME_FAILED', message: 'no' } }
                    : { ok: true, value: undefined };
            },
        });
        const result = await service.run([job('ok'), job('bad'), job('ok-2')]);
        expect(seen).toEqual(['ok', 'bad', 'ok-2']);
        expect(result.dismissed.map((entry) => entry.id)).toEqual(['ok', 'ok-2']);
        expect(result.failed.map((entry) => entry.job.id)).toEqual(['bad']);
        expect(result.stopped).toBe(false);
    });

    it('stops before the next job when requested', async () => {
        const seen: string[] = [];
        const service = new DismissFailedJobsService({
            dismiss: async (entry) => {
                seen.push(entry.id);
                return { ok: true, value: undefined };
            },
        });
        const result = await service.run([job('1'), job('2')], {
            shouldStop: () => seen.length > 0,
        });
        expect(seen).toEqual(['1']);
        expect(result.stopped).toBe(true);
        expect(result.dismissed.map((entry) => entry.id)).toEqual(['1']);
    });
});
