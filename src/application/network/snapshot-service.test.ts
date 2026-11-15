import { describe, expect, it } from 'vitest';
import type { NetworkSnapshot } from '../../domains/network/model.js';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asServerId } from '../../kernel/ids.js';
import { NetworkSnapshotService } from './snapshot-service.js';

function snapshot(at: number): NetworkSnapshot {
    return {
        version: at,
        capturedAt: at,
        homeId: asServerId('home'),
        endpointId: null,
        servers: new Map(),
        edges: [],
        maintenanceFingerprint: '',
    };
}

describe('NetworkSnapshotService', () => {
    it('caches a snapshot until TTL expires', async () => {
        const clock = new FakeClock(0);
        let calls = 0;
        const service = new NetworkSnapshotService({
            getSnapshot: async () => {
                calls++;
                return { ok: true, value: snapshot(calls) };
            },
        }, clock, { ttlMs: 100 });
        expect((await service.get()).ok).toBe(true);
        expect((await service.get()).ok).toBe(true);
        expect(calls).toBe(1);
        clock.advance(101);
        await service.get();
        expect(calls).toBe(2);
    });

    it('keeps the last known snapshot when refresh fails', async () => {
        const clock = new FakeClock(0);
        let fail = false;
        const service = new NetworkSnapshotService({
            getSnapshot: async () => fail
                ? { ok: false, error: { code: 'GAME_MAP_FAILED', message: 'no map' } }
                : { ok: true, value: snapshot(1) },
        }, clock, { ttlMs: 0 });
        await service.get();
        fail = true;
        clock.advance(1);
        expect((await service.get()).ok).toBe(true);
    });

    it('invalidates the cache', async () => {
        const clock = new FakeClock(0);
        let calls = 0;
        const service = new NetworkSnapshotService({
            getSnapshot: async () => {
                calls++;
                return { ok: true, value: snapshot(calls) };
            },
        }, clock, { ttlMs: 1000 });
        await service.get();
        service.invalidate();
        await service.get();
        expect(calls).toBe(2);
    });

    it('stops using a fallback after the maximum age', async () => {
        const clock = new FakeClock(0);
        let fail = false;
        const service = new NetworkSnapshotService({
            getSnapshot: async () => fail
                ? { ok: false, error: { code: 'GAME_MAP_FAILED', message: 'no map' } }
                : { ok: true, value: snapshot(0) },
        }, clock, { ttlMs: 0, fallbackMaxAgeMs: 100 });
        await service.get();
        fail = true;
        clock.advance(50);
        expect((await service.get()).ok).toBe(true);
        clock.advance(100);
        expect((await service.get()).ok).toBe(false);
    });

    it('hydrates a persisted snapshot and persists updates', async () => {
        const clock = new FakeClock(0);
        const updates: NetworkSnapshot[] = [];
        const service = new NetworkSnapshotService({
            getSnapshot: async () => ({ ok: true, value: snapshot(5) }),
        }, clock, { ttlMs: 0, onUpdate: (value) => { updates.push(value); } });
        service.hydrate(snapshot(0));
        expect(service.getCached()?.capturedAt).toBe(0);
        await service.get();
        expect(updates).toHaveLength(1);
        expect(updates[0]?.capturedAt).toBe(5);
    });
});
