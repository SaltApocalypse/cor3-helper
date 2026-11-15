import { describe, expect, it } from 'vitest';
import { asEdgeId, asServerId, type ServerId } from '../../kernel/ids.js';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { NetworkSnapshotStore } from './network-snapshot-store.js';
import { MemoryStorageArea } from './storage-area.js';

function snapshot(): NetworkSnapshot {
    return {
        version: 12,
        capturedAt: 34,
        homeId: asServerId('home'),
        endpointId: asServerId('home'),
        servers: new Map<ServerId, NetworkServer>([
            [asServerId('home'), {
                id: asServerId('home'),
                name: 'Home',
                ip: '10.0.0.1',
                typeName: 'Home',
                cluster: null,
                faction: null,
                maintenance: { active: false, endsAt: null, timeUntil: null },
                access: { kind: 'admin', active: true },
                endpointCapable: true,
                reachableNow: true,
            }],
            [asServerId('target'), {
                id: asServerId('target'),
                name: 'Target',
                ip: '10.0.0.2',
                typeName: 'Core',
                cluster: 'c1',
                faction: 'f1',
                maintenance: { active: true, endsAt: '2030-01-01T00:00:00.000Z', timeUntil: '5m' },
                access: { kind: 'regular', active: false },
                endpointCapable: true,
                reachableNow: true,
            }],
        ]),
        edges: [{ id: asEdgeId('e1'), a: asServerId('home'), b: asServerId('target'), hidden: true }],
        maintenanceFingerprint: 'target:2030-01-01T00:00:00.000Z',
    };
}

describe('NetworkSnapshotStore', () => {
    it('round-trips the last known network snapshot', async () => {
        const area = new MemoryStorageArea();
        const store = new NetworkSnapshotStore(area);
        await store.set(snapshot());
        const restored = await store.get();
        expect(restored?.capturedAt).toBe(34);
        expect(restored?.servers.get(asServerId('target'))?.typeName).toBe('Core');
        expect(restored?.servers.get(asServerId('target'))?.maintenance.active).toBe(true);
        expect(restored?.edges[0]?.hidden).toBe(true);
    });

    it('ignores malformed snapshots', async () => {
        const area = new MemoryStorageArea();
        await area.set({ 'v2.network.snapshot': { nope: true } });
        expect(await new NetworkSnapshotStore(area).get()).toBeNull();
    });
});
