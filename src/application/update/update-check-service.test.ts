import { describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../kernel/result.js';
import type { StorageReadResult } from '../../contracts/storage-health.js';
import { updateCheckResultSchema, type UpdateCheckResult, type UpdateCheckSuccess } from '../../contracts/update-check.js';
import { UpdateCheckService, type UpdateCheckCachePort, type UpdateCheckPort } from './update-check-service.js';

const success = (overrides: Partial<UpdateCheckSuccess> = {}): UpdateCheckSuccess => ({
    status: 'available',
    currentVersion: '2.0.6-salta.310',
    latestVersion: '2.0.7-salta',
    releaseUrl: 'https://github.com/SaltApocalypse/cor3-helper/releases/tag/v2.0.7-salta',
    checkedAt: 100,
    source: 'test',
    ...overrides,
});

class MemoryCache implements UpdateCheckCachePort {
    value: UpdateCheckResult | null = null;
    readStatus: 'ok' | 'missing' | 'corrupt' | 'unavailable' = 'missing';
    failWrite = false;
    async read(): Promise<StorageReadResult<UpdateCheckResult>> {
        if (this.readStatus === 'ok' && this.value) return { status: 'ok', value: this.value };
        if (this.readStatus === 'corrupt') return { status: 'corrupt' };
        if (this.readStatus === 'unavailable') return { status: 'unavailable' };
        return { status: 'missing' };
    }
    async save(result: UpdateCheckResult): Promise<void> {
        if (this.failWrite) throw new Error('write failed');
        this.value = result;
        this.readStatus = 'ok';
    }
}

function service(checker: UpdateCheckPort, store = new MemoryCache(), now: () => number = () => 123) {
    return {
        service: new UpdateCheckService({
            checker,
            store,
            currentVersion: () => '2.0.6-salta.310',
            now,
        }),
        store,
    };
}

function cached(checkedAt: number, status: 'available' | 'latest' | 'failed' = 'latest'): UpdateCheckResult {
    return {
        status,
        currentVersion: '2.0.6-salta.310',
        ...(status === 'failed' ? {} : { latestVersion: '2.0.6-salta', releaseUrl: 'https://example.test/release' }),
        checkedAt,
        ...(status === 'failed' ? { error: { code: 'NETWORK_ERROR' as const, message: 'offline' } } : {}),
        lastSuccess: status === 'failed' ? success({ status: 'latest', latestVersion: '2.0.6-salta' }) : success({ status, latestVersion: '2.0.6-salta' }),
    };
}

describe('UpdateCheckService', () => {
    it('C01 persists an available result', async () => {
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker);
        const result = await made.service.check();
        expect(result).toMatchObject({ status: 'available', latestVersion: '2.0.7-salta' });
        expect(result.lastSuccess?.latestVersion).toBe('2.0.7-salta');
        expect(made.store.value?.status).toBe('available');
    });

    it('C02 persists a latest result', async () => {
        const checker = { check: vi.fn(async () => ok(success({ status: 'latest', latestVersion: '2.0.6-salta' }))) };
        const made = service(checker);
        const result = await made.service.check();
        expect(result.status).toBe('latest');
    });

    it('C03 persists a failed result with no history', async () => {
        const checker = { check: vi.fn(async () => err({ code: 'NETWORK_ERROR' as const, message: 'offline' })) };
        const made = service(checker);
        const result = await made.service.check();
        expect(result).toMatchObject({ status: 'failed', lastSuccess: null, error: { code: 'NETWORK_ERROR' } });
    });

    it('C04 preserves lastSuccess after a later failure', async () => {
        let fail = false;
        const checker = {
            check: vi.fn(async () => fail
                ? err({ code: 'TIMEOUT' as const, message: 'timeout' })
                : ok(success())),
        };
        const made = service(checker);
        await made.service.check();
        fail = true;
        const failed = await made.service.check({ force: true });
        expect(failed.status).toBe('failed');
        expect(failed.lastSuccess?.latestVersion).toBe('2.0.7-salta');
    });

    it('C05 deduplicates concurrent requests', async () => {
        let release!: () => void;
        const checker = {
            check: vi.fn(async () => {
                await new Promise<void>((done) => { release = done; });
                return ok(success());
            }),
        };
        const made = service(checker);
        const first = made.service.check();
        const second = made.service.check();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(checker.check).toHaveBeenCalledTimes(1);
        release();
        await Promise.all([first, second]);
    });

    it('C06 force does not bypass inFlight dedupe', async () => {
        let release!: () => void;
        const checker = {
            check: vi.fn(async () => {
                await new Promise<void>((done) => { release = done; });
                return ok(success());
            }),
        };
        const made = service(checker);
        const first = made.service.check({ force: true });
        const second = made.service.check({ force: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(checker.check).toHaveBeenCalledTimes(1);
        release();
        await Promise.all([first, second]);
    });

    it('C07 getStatus reads only the cache', async () => {
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker);
        made.store.value = { ...success(), lastSuccess: success() };
        made.store.readStatus = 'ok';
        const result = await made.service.getStatus();
        expect(result?.status).toBe('available');
        expect(checker.check).not.toHaveBeenCalled();
    });

    it('C08 reports failed with null lastSuccess when no history exists', async () => {
        const checker = { check: vi.fn(async () => err({ code: 'HTTP_ERROR' as const, message: 'HTTP 500', httpStatus: 500 })) };
        const made = service(checker);
        const result = await made.service.check();
        expect(result.lastSuccess).toBeNull();
    });

    it('C09 reports storage write failure without throwing', async () => {
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker);
        made.store.failWrite = true;
        const result = await made.service.check();
        expect(result.status).toBe('failed');
        expect(result.error?.code).toBe('STORAGE_WRITE_FAILED');
    });

    it('C10 clears inFlight after completion', async () => {
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker);
        await made.service.check();
        await made.service.check();
        expect(checker.check).toHaveBeenCalledTimes(2);
    });

    it('C11 produces a result that satisfies the persisted contract', async () => {
        const made = service({ check: vi.fn(async () => ok(success())) });
        const result = await made.service.check();
        expect(result.status).toBe('available');
        expect(updateCheckResultSchema.safeParse(result).success).toBe(true);
        expect(updateCheckResultSchema.safeParse(made.store.value).success).toBe(true);
    });

    it('C12 keeps the previous cache when persistence fails', async () => {
        const store = new MemoryCache();
        const previous = cached(50, 'latest');
        store.value = previous;
        store.readStatus = 'ok';
        store.failWrite = true;
        const made = service({ check: vi.fn(async () => ok(success())) }, store, () => 123);
        const result = await made.service.check({ force: true });
        expect(result.error?.code).toBe('STORAGE_WRITE_FAILED');
        expect(result.lastSuccess?.latestVersion).toBe('2.0.7-salta');
        expect(await made.service.getStatus()).toEqual(previous);
    });

    it('C13 reports an unreadable cache instead of pretending it is empty', async () => {
        const store = new MemoryCache();
        store.readStatus = 'unavailable';
        const made = service({ check: vi.fn(async () => ok(success())) }, store);
        const status = await made.service.getStatus();
        expect(status).toMatchObject({
            status: 'failed',
            checkedAt: 0,
            lastSuccess: null,
            error: { code: 'STORAGE_READ_FAILED' },
        });
    });

    it('C14 keeps corrupt data out of the status projection', async () => {
        const store = new MemoryCache();
        store.readStatus = 'corrupt';
        const made = service({ check: vi.fn(async () => ok(success())) }, store);
        expect(await made.service.getStatus()).toBeNull();
    });
});


describe('UpdateCheckService TTL', () => {
    const hour = 60 * 60_000;
    const ttl = 6 * hour;

    function withCache(checkedAt: number, now: number, status: 'available' | 'latest' | 'failed' = 'latest') {
        const store = new MemoryCache();
        store.value = cached(checkedAt, status);
        store.readStatus = 'ok';
        const checker = { check: vi.fn(async () => ok(success())) };
        return { ...service(checker, store, () => now), checker };
    }

    it('T01 checks when there is no cache', async () => {
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker);
        await made.service.check({ maxAgeMs: ttl });
        expect(checker.check).toHaveBeenCalledTimes(1);
    });

    it('T02/T03 skips a fresh successful cache', async () => {
        for (const age of [hour, 5 * hour + 59 * 60_000]) {
            const made = withCache(10 * hour - age, 10 * hour);
            await made.service.check({ maxAgeMs: ttl });
            expect(made.checker.check).not.toHaveBeenCalled();
        }
    });

    it('T04 checks an expired cache', async () => {
        const made = withCache(0, ttl + 1);
        await made.service.check({ maxAgeMs: ttl });
        expect(made.checker.check).toHaveBeenCalledTimes(1);
    });

    it('T05 checks when the previous result failed', async () => {
        const made = withCache(10 * hour, 10 * hour, 'failed');
        await made.service.check({ maxAgeMs: ttl });
        expect(made.checker.check).toHaveBeenCalledTimes(1);
    });

    it('T06 force skips TTL protection', async () => {
        const made = withCache(10 * hour, 10 * hour);
        await made.service.check({ force: true, maxAgeMs: ttl });
        expect(made.checker.check).toHaveBeenCalledTimes(1);
    });

    it('T08 a new service instance still reads the persistent TTL cache', async () => {
        const store = new MemoryCache();
        store.value = cached(10 * hour);
        store.readStatus = 'ok';
        const first = { check: vi.fn(async () => ok(success())) };
        const second = { check: vi.fn(async () => ok(success())) };
        service(first, store, () => 10 * hour).service.check({ maxAgeMs: ttl });
        await service(second, store, () => 10 * hour).service.check({ maxAgeMs: ttl });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(first.check).not.toHaveBeenCalled();
        expect(second.check).not.toHaveBeenCalled();
    });

    it('T09 checks when cache read is unavailable', async () => {
        const store = new MemoryCache();
        store.readStatus = 'unavailable';
        const checker = { check: vi.fn(async () => ok(success())) };
        const made = service(checker, store);
        await made.service.check({ maxAgeMs: ttl });
        expect(checker.check).toHaveBeenCalledTimes(1);
    });

    it('T10 treats the exact TTL boundary as expired', async () => {
        const made = withCache(0, ttl);
        await made.service.check({ maxAgeMs: ttl });
        expect(made.checker.check).toHaveBeenCalledTimes(1);
    });
});
