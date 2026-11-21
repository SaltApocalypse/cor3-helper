import { describe, expect, it, vi } from 'vitest';
import { ok } from '../../kernel/result.js';
import type { StorageReadResult } from '../../contracts/storage-health.js';
import type { UpdateCheckResult } from '../../contracts/update-check.js';
import { UpdateCheckService, type UpdateCheckCachePort } from '../../application/update/update-check-service.js';
import { registerUpdateCheckLifecycle, UPDATE_CHECK_STARTUP_TTL_MS, type UpdateCheckLifecycleRuntime } from './update-check-lifecycle.js';

function runtime() {
    const installed: Array<(details: { readonly reason: string }) => void> = [];
    const startup: Array<() => void> = [];
    const value: UpdateCheckLifecycleRuntime = {
        onInstalled: {
            addListener: (listener) => { installed.push(listener); },
            removeListener: (listener) => {
                const index = installed.indexOf(listener);
                if (index >= 0) installed.splice(index, 1);
            },
        },
        onStartup: {
            addListener: (listener) => { startup.push(listener); },
            removeListener: (listener) => {
                const index = startup.indexOf(listener);
                if (index >= 0) startup.splice(index, 1);
            },
        },
    };
    return { value, installed, startup };
}

const result = () => ({ status: 'latest' as const, currentVersion: '2.0.6-salta.310', latestVersion: '2.0.6-salta', releaseUrl: 'https://example.test/release', checkedAt: 1, lastSuccess: null });

const logger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('update check lifecycle', () => {
    it('L01/L02 triggers a forced check for install and update', async () => {
        const rt = runtime();
        const check = vi.fn(async () => result());
        registerUpdateCheckLifecycle({ runtime: rt.value, service: { check }, logger: logger() });
        rt.installed[0]?.({ reason: 'install' });
        rt.installed[0]?.({ reason: 'update' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(check).toHaveBeenNthCalledWith(1, { force: true });
        expect(check).toHaveBeenNthCalledWith(2, { force: true });
    });

    it('L03 uses persistent TTL for startup', async () => {
        const rt = runtime();
        const check = vi.fn(async () => result());
        registerUpdateCheckLifecycle({ runtime: rt.value, service: { check }, logger: logger() });
        rt.startup[0]?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(check).toHaveBeenCalledWith({ force: false, maxAgeMs: UPDATE_CHECK_STARTUP_TTL_MS });
    });

    it('L04 reuses the service inFlight for consecutive lifecycle events', async () => {
        const rt = runtime();
        let release!: () => void;
        const check = vi.fn(async () => {
            await new Promise<void>((done) => { release = done; });
            return ok({
                status: 'latest' as const,
                currentVersion: '2.0.6-salta.310',
                latestVersion: '2.0.6-salta',
                releaseUrl: 'https://example.test/release',
                checkedAt: 1,
                source: 'test',
            });
        });
        const store: UpdateCheckCachePort = {
            read: async (): Promise<StorageReadResult<UpdateCheckResult>> => ({ status: 'missing' }),
            save: async () => undefined,
        };
        const service = new UpdateCheckService({
            checker: { check },
            store,
            currentVersion: () => '2.0.6-salta.310',
            now: () => 1,
        });
        registerUpdateCheckLifecycle({ runtime: rt.value, service, logger: logger() });
        rt.installed[0]?.({ reason: 'install' });
        rt.startup[0]?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(check).toHaveBeenCalledTimes(1);
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('L05/L06 catches lifecycle rejection and logs it', async () => {
        const rt = runtime();
        const log = logger();
        const check = vi.fn(async () => { throw new Error('network down'); });
        registerUpdateCheckLifecycle({ runtime: rt.value, service: { check }, logger: log });
        rt.installed[0]?.({ reason: 'install' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(log.warn).toHaveBeenCalledWith('update-check', 'Background update check failed', expect.objectContaining({ reason: 'install' }));
    });

    it('L07 does not register duplicate listeners for the same runtime', () => {
        const rt = runtime();
        const deps = { runtime: rt.value, service: { check: vi.fn(async () => result()) }, logger: logger() };
        const cleanup = registerUpdateCheckLifecycle(deps);
        registerUpdateCheckLifecycle(deps);
        expect(rt.installed).toHaveLength(1);
        expect(rt.startup).toHaveLength(1);
        cleanup();
        expect(rt.installed).toHaveLength(0);
        expect(rt.startup).toHaveLength(0);
    });
});
