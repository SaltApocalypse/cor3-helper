import { describe, expect, it } from 'vitest';
import { ChromeTabJobActionAdapter } from './chrome-tab-job-action-adapter.js';

describe('ChromeTabJobActionAdapter', () => {
    it('maps server files and logs', async () => {
        const adapter = new ChromeTabJobActionAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const kind = (message as { kind?: string }).kind;
                if (kind === 'getFiles') return { ok: true, value: { files: [{ fileId: 'f1', name: 'a', jobId: 'j' }] } };
                return { ok: true, value: { logs: [{ seq: 3, message: 'm', jobId: 'j' }] } };
            },
        });
        expect((await adapter.getServerFiles('s')).ok).toBe(true);
        expect((await adapter.getServerLogs('s')).ok).toBe(true);
    });

    it('maps desktop folders, files, and analysis', async () => {
        const adapter = new ChromeTabJobActionAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => {
                const kind = (message as { kind?: string }).kind;
                if (kind === 'getDesktopOptions') return { ok: true, value: { folders: [{ id: 'd', name: 'Downloads' }] } };
                if (kind === 'openFolder') return { ok: true, value: { files: [{ id: 'f', name: 'a.dat', isEncrypted: true }] } };
                return { ok: true, value: { canDecrypt: false, decryptPower: 12 } };
            },
        });
        const folder = await adapter.getDownloadsFolder();
        expect(folder).toEqual({ ok: true, value: { id: 'd' } });
        const files = await adapter.openFolder('d');
        expect(files.ok).toBe(true);
        if (files.ok) expect(files.value[0]?.isEncrypted).toBe(true);
        const analysis = await adapter.getFileAnalysis('f');
        expect(analysis).toEqual({ ok: true, value: { canDecrypt: false, decryptPower: 12, tags: [], source: null } });
    });

    it('returns the job reward on complete', async () => {
        const adapter = new ChromeTabJobActionAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true }),
        });
        const job = {
            id: 'j', name: 'IP Injection', type: 'IP Injection' as const, marketId: 'm', marketKey: 'home',
            serverId: 's', serverName: 's', rewardCredits: 100, rewardReputation: 10, deposit: 0,
            alreadyTaken: false, canComplete: false,
        };
        expect(await adapter.complete(job)).toEqual({ ok: true, value: { credits: 100, reputation: 10, renown: 0 } });
    });
});
