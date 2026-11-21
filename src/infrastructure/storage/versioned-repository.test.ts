import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { VersionedRepository } from './versioned-repository.js';
import { MemoryStorageArea, type StorageArea, type StorageKey } from './storage-area.js';

const schema = z.object({ value: z.number() });

class RejectingStorageArea implements StorageArea {
    private readonly area = new MemoryStorageArea();

    async get(_keys: StorageKey): Promise<Record<string, unknown>> {
        throw new Error('storage unavailable');
    }

    set(items: Record<string, unknown>): Promise<void> {
        return this.area.set(items);
    }

    remove(keys: StorageKey): Promise<void> {
        return this.area.remove(keys);
    }
}

describe('VersionedRepository.read health', () => {
    it('T01 reports a genuinely absent key as missing', async () => {
        const repo = new VersionedRepository({ area: new MemoryStorageArea(), key: 'test', schema, schemaVersion: 1 });
        expect(await repo.read()).toEqual({ status: 'missing' });
        expect(await repo.get()).toBeNull();
    });

    it('T02 reports a valid envelope as ok', async () => {
        const area = new MemoryStorageArea();
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1, clock: { now: () => 42 } });
        await repo.set({ value: 7 });
        expect(await repo.read()).toEqual({ status: 'ok', value: { value: 7 } });
    });

    it('T03 reports a damaged envelope as corrupt without echoing the payload', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { secret: 'do-not-log', value: 7 } });
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        const result = await repo.read();
        expect(result.status).toBe('corrupt');
        expect(JSON.stringify(result)).not.toContain('do-not-log');
    });

    it('T04 reports a schema-invalid payload as corrupt', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { schemaVersion: 1, writtenAt: 1, data: { value: 'not-a-number' } } });
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        expect(await repo.read()).toMatchObject({ status: 'corrupt' });
    });

    it('T05 reports an incompatible schema version without a migration as corrupt', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { schemaVersion: 99, writtenAt: 1, data: { value: 7 } } });
        const repo = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        expect(await repo.read()).toMatchObject({ status: 'corrupt', error: 'Incompatible storage schema version' });
    });

    it('T06 reports a storage API rejection as unavailable', async () => {
        const repo = new VersionedRepository({ area: new RejectingStorageArea(), key: 'test', schema, schemaVersion: 1 });
        expect(await repo.read()).toMatchObject({ status: 'unavailable' });
        await expect(repo.get()).rejects.toThrow('storage unavailable');
    });

    it('T07 reports a successful legacy migration as ok', async () => {
        const area = new MemoryStorageArea();
        await area.set({ test: { value: 3 } });
        const repo = new VersionedRepository({
            area,
            key: 'test',
            schema,
            schemaVersion: 1,
            migrate: (data, fromVersion) => fromVersion === 0 ? schema.parse(data) : null,
        });
        expect(await repo.read()).toEqual({ status: 'ok', value: { value: 3 } });
        expect(await repo.get()).toEqual({ value: 3 });
    });

    it('T08 preserves the legacy get() null semantics', async () => {
        const area = new MemoryStorageArea();
        const missing = new VersionedRepository({ area, key: 'missing', schema, schemaVersion: 1 });
        expect(await missing.get()).toBeNull();

        const corrupt = new VersionedRepository({ area, key: 'test', schema, schemaVersion: 1 });
        await area.set({ test: { nope: true } });
        expect(await corrupt.get()).toBeNull();

        const incompatible = new VersionedRepository({ area, key: 'future', schema, schemaVersion: 1 });
        await area.set({ future: { schemaVersion: 99, writtenAt: 1, data: { value: 7 } } });
        expect(await incompatible.get()).toBeNull();
    });
});
