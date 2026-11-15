import { describe, expect, it } from 'vitest';
import { ChromeStorageDiscoveryProgressStore } from './discovery-progress-store.js';
import { MemoryStorageArea } from './storage-area.js';

describe('ChromeStorageDiscoveryProgressStore', () => {
    it('round-trips progress and clears it', async () => {
        const area = new MemoryStorageArea();
        const store = new ChromeStorageDiscoveryProgressStore(area);
        await store.set({ fingerprint: 'a|b', scannedIps: ['1.1.1.1'], startedAt: 12 });
        expect(await store.get()).toEqual({ fingerprint: 'a|b', scannedIps: ['1.1.1.1'], startedAt: 12 });
        await store.clear();
        expect(await store.get()).toBeNull();
    });

    it('ignores malformed progress', async () => {
        const area = new MemoryStorageArea();
        await area.set({ 'v2.discovery.progress': { nope: true } });
        expect(await new ChromeStorageDiscoveryProgressStore(area).get()).toBeNull();
    });
});
