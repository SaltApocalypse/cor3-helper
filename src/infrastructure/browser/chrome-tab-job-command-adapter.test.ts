import { describe, expect, it } from 'vitest';
import { ChromeTabJobCommandAdapter } from './chrome-tab-job-command-adapter.js';

describe('ChromeTabJobCommandAdapter', () => {
    it('maps take/complete/dismiss to content messages', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabJobCommandAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => { sent.push(message); return { ok: true }; },
        });
        expect(await adapter.take('m', 'j')).toEqual({ ok: true, value: undefined });
        expect(await adapter.complete('m', 'j')).toEqual({ ok: true, value: undefined });
        expect(await adapter.dismiss('m', 'j')).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([
            { type: 'V2_JOB_TAKE', marketId: 'm', jobId: 'j' },
            { type: 'V2_JOB_COMPLETE', marketId: 'm', jobId: 'j' },
            { type: 'V2_JOB_DISMISS', marketId: 'm', jobId: 'j' },
        ]);
    });
});

describe('ChromeTabJobCommandAdapter transport classification', () => {
    it('marks a missing response as unconfirmed', async () => {
        const adapter = new ChromeTabJobCommandAdapter({
            findCor3Tab: async () => 1,
            send: async () => undefined,
        });
        const result = await adapter.complete('m', 'j');
        expect(result).toMatchObject({ ok: false, error: { code: 'JOB_COMMAND_FAILED', unconfirmed: true } });
    });

    it('marks a thrown send as unconfirmed', async () => {
        const adapter = new ChromeTabJobCommandAdapter({
            findCor3Tab: async () => 1,
            send: async () => { throw new Error('message channel closed'); },
        });
        const result = await adapter.complete('m', 'j');
        expect(result).toMatchObject({ ok: false, error: { code: 'JOB_COMMAND_FAILED', unconfirmed: true } });
    });

    it('preserves explicit business error codes', async () => {
        const adapter = new ChromeTabJobCommandAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: false, error: { code: 'GAME_JOB_FAILED', message: 'rejected' } }),
        });
        const result = await adapter.complete('m', 'j');
        expect(result).toMatchObject({ ok: false, error: { code: 'GAME_JOB_FAILED' } });
        if (!result.ok) expect(result.error.unconfirmed).toBeUndefined();
    });
});
