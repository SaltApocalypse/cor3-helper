import { describe, expect, it } from 'vitest';
import type { HardwareDefinition, InventorySnapshot, ItemCatalog, SoftwareDefinition } from '../../domains/loadout/model.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import { decryptFileType } from '../../domains/jobs/model.js';
import { LoadoutService } from '../loadout/service.js';
import type { LoadoutApplyPort, LoadoutRuntime, LoadoutRuntimePort } from '../loadout/ports.js';
import { err, ok } from '../../kernel/result.js';
import type { GameError } from '../game/ports.js';
import { JobExecutionService } from './execution-service.js';
import type { DownloadFile, FileAnalysis, JobActionPort } from './job-actions.js';
import type { MinigamePort } from './minigame-port.js';

const cpu: HardwareDefinition = { id: 'cpu1', name: 'CPU', slot: 'cpu', specs: { cpuFrequency: 20, cpuCores: 4, cpuConsuming: 20 } };
const gpu: HardwareDefinition = { id: 'gpu1', name: 'GPU', slot: 'gpu', specs: { gpuPower: 20, gpuMemory: 10, gpuConsuming: 20 } };
const ram: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 20, ramMemory: 20 } };
const psu: HardwareDefinition = { id: 'psu1', name: 'PSU', slot: 'psu', specs: { psuPower: 200 } };
const xvct: SoftwareDefinition = {
    id: 'dec-xvct',
    name: 'XVCT decrypt',
    abilities: [{ type: 'DECRYPT', minPower: 20, maxPower: 40, fileTypes: ['.xvct'] }],
    consuming: {},
};
const other: SoftwareDefinition = {
    id: 'dec-other',
    name: 'Other decrypt',
    abilities: [{ type: 'DECRYPT', minPower: 20, maxPower: 40, fileTypes: ['.pdf'] }],
    consuming: {},
};

interface Harness {
    readonly service: JobExecutionService;
    readonly loadout: LoadoutService;
    readonly calls: string[];
    readonly equipped: { software: string[]; hardware: { cpu: string; gpu: string; ram: string; psu: string } };
}

function job(): JobOffer {
    return {
        id: 'job1',
        name: 'Decrypt config',
        type: 'File Decryption',
        marketId: 'market',
        marketKey: 'home',
        serverId: 'server1',
        serverName: 'server',
        rewardCredits: 100,
        rewardReputation: 10,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
        conditions: [{ type: 'DecryptFile', details: { fileExtension: '.xvct' } }],
        fileInfo: { name: 'config.xvct' },
    };
}

function makeHarness(includeXvct: boolean): Harness {
    const calls: string[] = [];
    const equipped = {
        software: [includeXvct ? other.id : other.id],
        hardware: { cpu: cpu.id, gpu: gpu.id, ram: ram.id, psu: psu.id },
    };
    let decrypted = false;

    const catalog: ItemCatalog = {
        catalogVersion: 'runtime',
        gameVersion: 'test',
        hardware: [cpu, gpu, ram, psu],
        software: includeXvct ? [xvct, other] : [other],
    };

    const runtime: LoadoutRuntimePort = {
        get: async (): Promise<{ ok: true; value: LoadoutRuntime }> => ({
            ok: true,
            value: {
                catalog,
                inventory: {
                    ownedHardwareIds: new Set([cpu.id, gpu.id, ram.id, psu.id]),
                    ownedSoftwareIds: new Set(catalog.software.map((item) => item.id)),
                    equippedHardware: { ...equipped.hardware },
                    equippedSoftwareIds: [...equipped.software],
                    capturedAt: 1,
                } satisfies InventorySnapshot,
            },
        }),
    };

    const applier: LoadoutApplyPort = {
        equipHardware: async (id) => {
            const item = catalog.hardware.find((candidate) => candidate.id === id);
            if (!item) return err({ code: 'APPLY_FAILED', message: `unknown ${id}` });
            if (item.slot === 'psu') equipped.hardware.psu = id;
            else equipped.hardware[item.slot] = id;
            calls.push(`equip-${item.slot}`);
            return ok(undefined);
        },
        equipSoftware: async (id) => {
            equipped.software = [id];
            calls.push('equip-software');
            return ok(undefined);
        },
        unequipSoftware: async (id) => {
            equipped.software = equipped.software.filter((entry) => entry !== id);
            calls.push('unequip-software');
            return ok(undefined);
        },
    };

    const loadout = new LoadoutService(runtime, applier, async () => undefined);

    const analysis = (): FileAnalysis => {
        const canDecrypt = includeXvct && equipped.software.includes(xvct.id);
        return { canDecrypt, decryptPower: canDecrypt ? 40 : 0, tags: [], source: null };
    };

    const actions: JobActionPort = {
        take: async () => {
            calls.push('take');
            if (includeXvct && !equipped.software.includes(xvct.id)) {
                return err({ code: 'TAKE_FAILED', message: 'loadout not applied before take' });
            }
            return ok(undefined);
        },
        complete: async () => {
            calls.push('complete');
            return ok({ credits: 100, reputation: 10, renown: 1 });
        },
        getServerFiles: async () => ok([]),
        deleteFile: async () => ok(undefined),
        getServerLogs: async () => ok([]),
        deleteLog: async () => ok(undefined),
        downloadLog: async () => ok(undefined),
        downloadFile: async () => ok(undefined),
        getTransit: async () => ok([]),
        addTransit: async () => ok(undefined),
        removeTransit: async () => ok(undefined),
        uploadFile: async () => ok(undefined),
        getDownloadsFolder: async () => ok({ id: 'downloads' }),
        openFolder: async () => ok([
            { id: 'file1', name: 'config.xvct', isEncrypted: !decrypted },
        ]),
        getFileAnalysis: async () => ok(analysis()),
        decryptFile: async () => {
            calls.push('decrypt');
            decrypted = true;
            return ok(undefined);
        },
        getMinigameLock: async () => null,
    };

    const minigames: MinigamePort = {
        solve: async () => ok({ kind: 'config-hack', solved: true }),
        cancel: async () => ok(undefined),
    };

    const beforeDecrypt = async (
        current: JobOffer,
        file: DownloadFile,
        requiredPower = 0,
    ): Promise<{ ok: true; value: void } | { ok: false; error: GameError }> => {
        const target = decryptFileType(current, file.name);
        if (!target) return ok(undefined);
        const result = await loadout.ensure({ ability: 'DECRYPT', target, requiredPower, strategy: 'best' });
        if (result.ok) return ok(undefined);
        const insufficient = result.error.code === 'NO_PLAN' || result.error.code === 'INFEASIBLE';
        return err({
            code: insufficient ? 'DECRYPT_POWER_INSUFFICIENT' : 'ACTION_FAILED',
            message: result.error.message,
            ...(insufficient ? {} : { retryable: true }),
        });
    };

    const service = new JobExecutionService(
        actions,
        undefined,
        beforeDecrypt,
        minigames,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        async () => undefined,
        undefined,
        async () => undefined,
    );

    return { service, loadout, calls, equipped };
}

describe('File Decryption pipeline', () => {
    it('applies the exact-target loadout before take and completes the job', async () => {
        const harness = makeHarness(true);
        const result = await harness.service.executeDetailed(job());
        expect(result.ok).toBe(true);
        expect(harness.equipped.software).toEqual([xvct.id]);
        expect(harness.calls.indexOf('take')).toBeGreaterThan(harness.calls.indexOf('equip-software'));
        expect(harness.calls).toContain('decrypt');
        expect(harness.calls).toContain('complete');
    });

    it('does not take the job when no owned module supports the file type', async () => {
        const harness = makeHarness(false);
        const result = await harness.service.executeDetailed(job());
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('DECRYPT_POWER_INSUFFICIENT');
        expect(harness.calls).not.toContain('take');
    });
});
