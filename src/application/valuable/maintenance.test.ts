import { describe, expect, it } from 'vitest';
import type { NetworkServer, NetworkSnapshot } from '../../domains/network/model.js';
import { asServerId } from '../../kernel/ids.js';
import { isUpcomingMaintenance, listMaintenanceServers } from './maintenance.js';

const home = asServerId('home');
const upcoming = asServerId('upcoming');
const active = asServerId('active');
const clear = asServerId('clear');

function server(id: ReturnType<typeof asServerId>, maintenance: NetworkServer['maintenance']): NetworkServer {
    return {
        id, name: String(id), ip: null, typeName: 'test', cluster: null, faction: null,
        maintenance, access: { kind: 'none', active: false }, endpointCapable: true, reachableNow: true,
    };
}

const snapshot: NetworkSnapshot = {
    version: 1, capturedAt: 1, homeId: home, endpointId: null,
    servers: new Map([
        [home, server(home, { active: false, endsAt: null, timeUntil: null })],
        [upcoming, server(upcoming, { active: false, endsAt: null, timeUntil: '2026-11-26T12:00:00.000Z' })],
        [active, server(active, { active: true, endsAt: '2026-11-26T12:00:00.000Z', timeUntil: null })],
        [clear, server(clear, { active: false, endsAt: null, timeUntil: '' })],
    ]),
    edges: [],
    maintenanceFingerprint: '',
};

describe('valuable maintenance helpers', () => {
    it('lists active and upcoming servers only', () => {
        const list = listMaintenanceServers(snapshot);
        expect(list.map((entry) => entry.id)).toEqual([active, upcoming]);
    });

    it('does not treat an empty timeUntil as upcoming', () => {
        expect(isUpcomingMaintenance(snapshot.servers.get(clear)!)).toBe(false);
        expect(isUpcomingMaintenance(snapshot.servers.get(upcoming)!)).toBe(true);
    });
});
