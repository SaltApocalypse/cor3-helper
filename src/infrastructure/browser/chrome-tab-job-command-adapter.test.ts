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
