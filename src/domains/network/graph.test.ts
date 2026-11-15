import { describe, expect, it } from 'vitest';
import { asEdgeId, asServerId } from '../../kernel/ids.js';
import { NetworkGraph } from './graph.js';
import type { NetworkServer, NetworkSnapshot } from './model.js';

const home = asServerId('home');
const a = asServerId('a');
const b = asServerId('b');
const c = asServerId('c');
const target = asServerId('target');

function server(id: ReturnType<typeof asServerId>, name: string, maintenance = false): NetworkServer {
    return {
        id,
        name,
        ip: null,
        typeName: 'test',
        cluster: null,
        faction: null,
        maintenance: { active: maintenance, endsAt: maintenance ? '2999-01-01T00:00:00.000Z' : null, timeUntil: null },
        access: { kind: 'none', active: false },
        endpointCapable: true,
        reachableNow: true,
    };
}

function graph(input: {
    servers?: NetworkServer[];
    edges?: Array<[string, string, boolean?]>;
} = {}): NetworkGraph {
    const servers = input.servers ?? [server(home, 'Home'), server(a, 'A'), server(b, 'B'), server(c, 'C'), server(target, 'Target')];
    const edges = (input.edges ?? [
        ['home', 'a'],
        ['a', 'target'],
        ['home', 'b'],
        ['b', 'c'],
        ['c', target],
    ]).map(([from, to, hidden], index) => ({
        id: asEdgeId(`e${index}`),
        a: asServerId(from),
        b: asServerId(to),
        hidden: hidden === true,
    }));
    const snapshot: NetworkSnapshot = {
        version: 1,
        capturedAt: 1,
        homeId: home,
        endpointId: null,
        servers: new Map(servers.map((entry) => [entry.id, entry])),
        edges,
        maintenanceFingerprint: '',
    };
    return new NetworkGraph(snapshot);
}

describe('NetworkGraph', () => {
    it('finds the shortest route through a cycle-safe BFS', () => {
        const result = graph({
            edges: [['home', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'target'], ['home', 'b']],
        }).findRoute(target, 1);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.nodes.map((node) => node.name)).toEqual(['Home', 'B', 'Target']);
    });

    it('routes around a maintenance node', () => {
        const result = graph({
            servers: [server(home, 'Home'), server(a, 'A', true), server(target, 'Target')],
            edges: [['home', 'a'], ['a', 'target'], ['home', 'target']],
        }).findRoute(target, Date.now());
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.nodes.map((node) => node.name)).toEqual(['Home', 'Target']);
    });

    it('reports a maintenance blocker when all intermediate routes are blocked', () => {
        const result = graph({
            servers: [server(home, 'Home'), server(a, 'A', true), server(target, 'Target')],
            edges: [['home', 'a'], ['a', 'target']],
        }).findRoute(target, Date.now());
        expect(result).toEqual({
            ok: false,
            error: { code: 'MAINTENANCE_BLOCKED', message: 'A is in maintenance', blockerName: 'A' },
        });
    });

    it('reports target maintenance separately', () => {
        const result = graph({
            servers: [server(home, 'Home'), server(target, 'Target', true)],
            edges: [['home', 'target']],
        }).findRoute(target, Date.now());
        expect(result).toEqual({
            ok: false,
            error: { code: 'TARGET_IN_MAINTENANCE', message: 'Target is in maintenance', blockerName: 'Target' },
        });
    });

    it('counts hidden edges', () => {
        const result = graph({
            edges: [['home', 'a', true], ['a', 'target', true]],
        }).findRoute(target, 1);
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.hiddenEdgeCount).toBe(2);
    });

    it('returns NO_ROUTE for an unknown target', () => {
        const result = graph().findRoute(asServerId('missing'), 1);
        expect(result).toEqual({ ok: false, error: { code: 'UNKNOWN_TARGET', message: 'Unknown target: missing' } });
    });

    it('plans from an explicit start node', () => {
        const result = graph({
            edges: [['home', 'a'], ['a', 'b'], ['b', target]],
        }).findRoutesFrom(b, target, 2, 1);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value[0]?.nodes.map((node) => node.name)).toEqual(['B', 'Target']);
        }
    });

    it('reports an unknown start node', () => {
        const result = graph().findRoutesFrom(asServerId('missing-start'), target, 2, 1);
        expect(result).toEqual({ ok: false, error: { code: 'UNKNOWN_START', message: 'Unknown start: missing-start' } });
    });

    it('returns bounded alternatives when the best route has alternatives', () => {
        const result = graph({
            edges: [['home', 'a'], ['a', target], ['home', 'b'], ['b', target]],
        }).findRoutes(target, 2, 1);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toHaveLength(2);
            expect(result.value.map((route) => route.edgeIds.length)).toEqual([2, 2]);
        }
    });
});
