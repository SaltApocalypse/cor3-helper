import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../kernel/fake-clock.js';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { NetworkDiscoveryService, MemoryDiscoveryProgressStore } from './discovery.js';
import type { NetworkSnapshot, NetworkServer } from '../../domains/network/model.js';

function server(id: string, ip: string): NetworkServer {
    return {
        id: asServerId(id), name: id, ip, typeName: 'test', cluster: null, faction: null,
        maintenance: { active: false, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: false }, endpointCapable: true, reachableNow: true,
    };
}

function snapshot(version: number, withNewEdge = false): NetworkSnapshot {
    const servers = [server('home', '1.1.1.1'), server('a', '2.2.2.2'), server('b', '3.3.3.3')];
    const edges = [
        { id: asEdgeId('e1'), a: asServerId('home'), b: asServerId('a'), hidden: false },
        { id: asEdgeId('e2'), a: asServerId('a'), b: asServerId('b'), hidden: false },
        ...(withNewEdge ? [{ id: asEdgeId('e3'), a: asServerId('home'), b: asServerId('b'), hidden: true }] : []),
    ];
    return { version, capturedAt: version, homeId: asServerId('home'), endpointId: null, servers: new Map(servers.map((s) => [s.id, s])), edges, maintenanceFingerprint: '' };
}

describe('NetworkDiscoveryService', () => {
    it('resumes from saved progress and reports new edges', async () => {
        const clock = new FakeClock(0);
        const progress = new MemoryDiscoveryProgressStore();
        let calls = 0;
        const snapshots = {
            get: async () => {
                calls++;
                return { ok: true, value: snapshot(calls, calls > 2) } as const;
            },
        };
        const commands: string[] = [];
        const service = new NetworkDiscoveryService(snapshots, {
            connectIp: async (ip) => { commands.push(ip); return { ok: true, value: undefined }; },
        }, progress, clock, async () => {});
        const first = await service.discover();
        expect(first.partial).toBeUndefined();
        expect(first.scanned).toBe(3);
        expect(commands).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3']);
        expect(await progress.get()).toBeNull();
    });

    it('resumes after a maxIps-limited run', async () => {
        const clock = new FakeClock(0);
        const progress = new MemoryDiscoveryProgressStore();
        const snapshots = { get: async () => ({ ok: true, value: snapshot(1) }) as const };
        const commands: string[] = [];
        const service = new NetworkDiscoveryService(snapshots, {
            connectIp: async (ip) => { commands.push(ip); return { ok: true, value: undefined }; },
        }, progress, clock, async () => {});
        const first = await service.discover({ maxIps: 1 });
        expect(first).toMatchObject({ ok: false, partial: true, reason: 'max-ips', scanned: 1, total: 3 });
        expect((await progress.get())?.scannedIps).toEqual(['1.1.1.1']);
        const second = await service.discover();
        expect(second).toMatchObject({ ok: true, scanned: 3, total: 3 });
        expect(commands).toEqual(['1.1.1.1', '2.2.2.2', '3.3.3.3']);
    });

    it('persists partial progress when the budget is exhausted', async () => {
        const clock = new FakeClock(0);
        const progress = new MemoryDiscoveryProgressStore();
        const snapshots = { get: async () => ({ ok: true, value: snapshot(1) }) as const };
        const service = new NetworkDiscoveryService(snapshots, {
            connectIp: async () => { clock.advance(10); return { ok: true, value: undefined }; },
        }, progress, clock, async () => {});
        const result = await service.discover({ maxDurationMs: 15 });
        expect(result).toMatchObject({ ok: false, partial: true, reason: 'timeout', scanned: 2, total: 3 });
        expect((await progress.get())?.scannedIps).toHaveLength(2);
    });

    it('rejects concurrent discovery runs', async () => {
        const clock = new FakeClock(0);
        const progress = new MemoryDiscoveryProgressStore();
        let release = (): void => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const snapshots = { get: async () => ({ ok: true, value: snapshot(1) }) as const };
        const service = new NetworkDiscoveryService(snapshots, {
            connectIp: async () => { await gate; return { ok: true, value: undefined }; },
        }, progress, clock, async () => {});
        const first = service.discover();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const second = await service.discover();
        expect(second).toMatchObject({ skipped: true, reason: 'locked' });
        release();
        await first;
    });
});
