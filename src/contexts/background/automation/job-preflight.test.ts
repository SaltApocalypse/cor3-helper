import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../../domains/jobs/model.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import { asEdgeId, asServerId } from '../../../kernel/ids.js';
import { ok } from '../../../kernel/result.js';
import { JobPreflight, type JobPreflightDeps } from './job-preflight.js';

const home = asServerId('home');
const blocked = asServerId('blocked');
const current = asServerId('current');
const relay = asServerId('relay');
const target = asServerId('target');

function server(
    id: ReturnType<typeof asServerId>,
    typeName = 'test',
    options: { readonly maintenance?: boolean; readonly access?: boolean } = {},
): NetworkServer {
    return {
        id,
        name: id,
        ip: null,
        typeName,
        cluster: null,
        faction: null,
        maintenance: { active: options.maintenance === true, endsAt: null, timeUntil: null },
        access: { kind: 'none', active: options.access === true },
        endpointCapable: true,
        reachableNow: true,
    };
}

function snapshot(servers: readonly NetworkServer[], edges: readonly [string, string][]): NetworkSnapshot {
    return {
        version: 1,
        capturedAt: 1,
        homeId: home,
        endpointId: current,
        servers: new Map(servers.map((entry) => [entry.id, entry])),
        edges: edges.map(([a, b], index) => ({
            id: asEdgeId(`e${index}`),
            a: asServerId(a),
            b: asServerId(b),
            hidden: false,
        })),
        maintenanceFingerprint: '',
    };
}

function job(overrides: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job1',
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: 'market',
        marketKey: 'home',
        serverId: target,
        serverName: target,
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
        ...overrides,
    };
}

function preflight(
    snap: NetworkSnapshot,
    canSatisfy: JobPreflightDeps['loadout']['canSatisfy'],
    minigameLock: number | null = null,
): JobPreflight {
    const logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    return new JobPreflight({
        snapshots: { get: async () => ok(snap) },
        loadout: { canSatisfy },
        jobActions: { getMinigameLock: async () => minigameLock },
        logger,
        now: () => 1,
    });
}

describe('JobPreflight', () => {
    it('allows a target reachable from the current endpoint when the home route is blocked', async () => {
        const snap = snapshot(
            [
                server(home, 'Home', { access: true }),
                server(blocked, 'blocked', { maintenance: true, access: true }),
                server(current, 'current', { access: true }),
                server(target, 'target', { access: true }),
            ],
            [['home', 'blocked'], ['blocked', 'target'], ['current', 'target']],
        );
        const result = await preflight(snap, async () => ok({ feasible: true, reason: null }))
            .preflight(job());
        expect(result.ok).toBe(true);
    });

    it('does not require HACK software when the current endpoint reaches the target directly', async () => {
        const snap = snapshot(
            [
                server(home, 'Home', { access: true }),
                server(relay, 'CEDRT'),
                server(current, 'current', { access: true }),
                server(target, 'target', { access: true }),
            ],
            [['home', 'relay'], ['relay', 'target'], ['current', 'target']],
        );
        let hackChecks = 0;
        const result = await preflight(snap, async (request) => {
            if (request.ability === 'HACK') {
                hackChecks += 1;
                return ok({ feasible: false, reason: 'NO_SOFTWARE' });
            }
            return ok({ feasible: true, reason: null });
        }).preflight(job());
        expect(result.ok).toBe(true);
        expect(hackChecks).toBe(0);
    });

    it('takes a decrypt job when only the hardware transition is unavailable', async () => {
        const snap = snapshot([server(home, 'Home', { access: true })], []);
        const result = await preflight(snap, async () => ok({ feasible: false, reason: 'NO_BOOTABLE_COMBINATION' }))
            .preflight(job({
                id: 'decrypt',
                name: 'File Decryption',
                type: 'File Decryption',
                serverId: null,
                serverName: null,
            }));
        expect(result.ok).toBe(true);
    });

    it('lets a decrypt job be taken while the minigame is locked', async () => {
        const snap = snapshot([server(home, 'Home', { access: true })], []);
        const result = await preflight(
            snap,
            async () => ok({ feasible: true, reason: null }),
            2_000,
        ).preflight(job({
            id: 'decrypt',
            name: 'File Decryption',
            type: 'File Decryption',
            serverId: null,
            serverName: null,
        }));
        expect(result.ok).toBe(true);
    });

    it('treats a generic .enc extension as unknown during decrypt preflight', async () => {
        const snap = snapshot([server(home, 'Home', { access: true })], []);
        let fallbackUsed = false;
        const result = await preflight(snap, async (request) => {
            if (request.target === '.enc') return ok({ feasible: false, reason: 'NO_SOFTWARE' });
            if (request.fallbackToAnyAbility) {
                fallbackUsed = true;
                return ok({ feasible: true, reason: null });
            }
            return ok({ feasible: false, reason: 'NO_SOFTWARE' });
        }).preflight(job({
            id: 'decrypt',
            name: 'File Decryption',
            type: 'File Decryption',
            serverId: null,
            serverName: null,
            conditions: [{ type: 'DecryptFile', details: { fileExtension: '.enc' } }],
        }));
        expect(result.ok).toBe(true);
        expect(fallbackUsed).toBe(true);
    });

    it('still blocks a decrypt job when the required software is missing', async () => {
        const snap = snapshot([server(home, 'Home', { access: true })], []);
        const result = await preflight(snap, async () => ok({ feasible: false, reason: 'NO_SOFTWARE' }))
            .preflight(job({
                id: 'decrypt',
                name: 'File Decryption',
                type: 'File Decryption',
                serverId: null,
                serverName: null,
            }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('PREFLIGHT_FAILED');
    });
});
