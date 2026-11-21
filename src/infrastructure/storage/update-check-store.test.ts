import { describe, expect, it } from 'vitest';
import type { UpdateCheckResult } from '../../contracts/update-check.js';
import { UpdateCheckStore } from './update-check-store.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from './storage-area.js';

class RejectingArea implements StorageArea {
    constructor(
        private readonly base: StorageArea,
        private readonly failRead = false,
        private readonly failWrite = false,
    ) {}

    async get(keys: StorageKey): Promise<Record<string, unknown>> {
        if (this.failRead) throw new Error('read failed');
        return this.base.get(keys);
    }

    async set(items: Record<string, unknown>): Promise<void> {
        if (this.failWrite) throw new Error('write failed');
        return this.base.set(items);
    }

    async remove(keys: StorageKey): Promise<void> {
        if (this.failWrite) throw new Error('remove failed');
        return this.base.remove(keys);
    }
}

const result = (overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult => ({
    status: 'available',
    currentVersion: '2.0.6-salta.310',
    latestVersion: '2.0.7-salta',
    releaseUrl: 'https://github.com/SaltApocalypse/cor3-helper/releases/tag/v2.0.7-salta',
    checkedAt: 123,
    lastSuccess: {
        status: 'available',
        currentVersion: '2.0.6-salta.310',
        latestVersion: '2.0.7-salta',
        releaseUrl: 'https://github.com/SaltApocalypse/cor3-helper/releases/tag/v2.0.7-salta',
        checkedAt: 123,
        source: 'test',
    },
    ...overrides,
});

describe('UpdateCheckStore', () => {
    it('S01 returns missing for the first read', async () => {
        const store = new UpdateCheckStore(new MemoryStorageArea());
        expect(await store.read()).toEqual({ status: 'missing' });
    });

    it('S02/S03 writes and reads a result', async () => {
        const area = new MemoryStorageArea();
        const store = new UpdateCheckStore(area, { now: () => 1 });
        await store.save(result());
        expect(await store.read()).toEqual({ status: 'ok', value: result() });
    });

    it('S04 treats corrupt cache data as corrupt, not empty', async () => {
        const area = new MemoryStorageArea();
        await area.set({ 'v2.updateCheck': { nope: true } });
        const store = new UpdateCheckStore(area);
        expect(await store.read()).toMatchObject({ status: 'corrupt' });
    });

    it('S05 reports a storage read failure as unavailable', async () => {
        const store = new UpdateCheckStore(new RejectingArea(new MemoryStorageArea(), true, false));
        expect(await store.read()).toMatchObject({ status: 'unavailable' });
    });

    it('S06 propagates a storage write failure', async () => {
        const store = new UpdateCheckStore(new RejectingArea(new MemoryStorageArea(), false, true));
        await expect(store.save(result())).rejects.toThrow('write failed');
    });

    it('S07 reads a previously persisted success', async () => {
        const area = new MemoryStorageArea();
        await new UpdateCheckStore(area).save(result());
        const store = new UpdateCheckStore(area);
        const read = await store.read();
        expect(read.status).toBe('ok');
        if (read.status === 'ok') expect(read.value.lastSuccess?.latestVersion).toBe('2.0.7-salta');
    });

    it('S08 stores a failed result while preserving lastSuccess', async () => {
        const area = new MemoryStorageArea();
        const store = new UpdateCheckStore(area);
        await store.save(result({
            status: 'failed',
            latestVersion: undefined,
            releaseUrl: undefined,
            error: { code: 'NETWORK_ERROR', message: 'offline' },
        }));
        const read = await store.read();
        expect(read.status).toBe('ok');
        if (read.status === 'ok') {
            expect(read.value.status).toBe('failed');
            expect(read.value.lastSuccess?.latestVersion).toBe('2.0.7-salta');
        }
    });
});
