import { describe, expect, it } from 'vitest';
import type {
    HardwareDefinition,
    InventorySnapshot,
    ItemCatalog,
    SoftwareDefinition,
} from './model.js';
import { calculateLoadout, abilityPower } from './calculator.js';
import { optimizeLoadout } from './optimizer.js';
import { MaxPowerPsuPolicy, MinPowerPsuPolicy } from './psu-policy.js';

const cpu: HardwareDefinition = { id: 'cpu1', name: 'CPU 1', slot: 'cpu', specs: { cpuFrequency: 10, cpuCores: 4, cpuConsuming: 10 } };
const gpu: HardwareDefinition = { id: 'gpu1', name: 'GPU 1', slot: 'gpu', specs: { gpuPower: 10, gpuMemory: 10, gpuConsuming: 20 } };
const ram: HardwareDefinition = { id: 'ram1', name: 'RAM 1', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
const psu100: HardwareDefinition = { id: 'psu100', name: 'PSU 100', slot: 'psu', specs: { psuPower: 100, psuProtection: 1 } };
const psu200: HardwareDefinition = { id: 'psu200', name: 'PSU 200', slot: 'psu', specs: { psuPower: 200, psuProtection: 1 } };
const software: SoftwareDefinition = {
    id: 'sw1',
    name: 'Hack',
    abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['CEDRT'] }],
    consuming: {},
};
const catalog: ItemCatalog = {
    catalogVersion: '1',
    gameVersion: 'test',
    hardware: [cpu, gpu, ram, psu100, psu200],
    software: [software],
};

function inventory(ownedHardware: string[]): InventorySnapshot {
    return {
        ownedHardwareIds: new Set(ownedHardware),
        ownedSoftwareIds: new Set(['sw1']),
        equippedHardware: {},
        equippedSoftwareIds: [],
        capturedAt: 1,
    };
}

describe('Loadout calculator', () => {
    it('calculates bootability and ability power', () => {
        const analysis = calculateLoadout({ cpu, gpu, ram, psu: psu200 }, [software]);
        expect(analysis.canBoot).toBe(true);
        expect(abilityPower(analysis, 'sw1', 'HACK', 'CEDRT')).toBe(20);
    });
});

describe('Loadout optimizer', () => {
    it('selects a max-power PSU on equal power', () => {
        const result = optimizeLoadout({
            catalog,
            inventory: inventory(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']),
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
        });
        expect(result.feasible).toBe(true);
        expect(result.plan?.hardware.psu.id).toBe('psu200');
        expect(result.plan?.policyId).toBe(new MaxPowerPsuPolicy().id);
    });

    it('selects the weakest feasible plan with the weakest strategy', () => {
        const weakCpu: HardwareDefinition = { id: 'cpu-weak', name: 'CPU Weak', slot: 'cpu', specs: { cpuFrequency: 10, cpuCores: 2, cpuConsuming: 10 } };
        const strongCpu: HardwareDefinition = { id: 'cpu-strong', name: 'CPU Strong', slot: 'cpu', specs: { cpuFrequency: 20, cpuCores: 8, cpuConsuming: 10 } };
        const weakGpu: HardwareDefinition = { id: 'gpu-weak', name: 'GPU Weak', slot: 'gpu', specs: { gpuPower: 10, gpuMemory: 10, gpuConsuming: 20 } };
        const strongGpu: HardwareDefinition = { id: 'gpu-strong', name: 'GPU Strong', slot: 'gpu', specs: { gpuPower: 20, gpuMemory: 20, gpuConsuming: 20 } };
        const consuming: SoftwareDefinition = {
            id: 'sw-consuming',
            name: 'Hack consuming',
            abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['CEDRT'] }],
            consuming: { cpu_frequency: [0, 5, 15], gpu_power: [0, 5, 15] },
        };
        const testCatalog: ItemCatalog = {
            catalogVersion: '1',
            gameVersion: 'test',
            hardware: [weakCpu, strongCpu, weakGpu, strongGpu, ram, psu100],
            software: [consuming],
        };
        const testInventory: InventorySnapshot = {
            ownedHardwareIds: new Set([weakCpu.id, strongCpu.id, weakGpu.id, strongGpu.id, ram.id, psu100.id]),
            ownedSoftwareIds: new Set([consuming.id]),
            equippedHardware: {},
            equippedSoftwareIds: [],
            capturedAt: 1,
        };
        const best = optimizeLoadout({
            catalog: testCatalog,
            inventory: testInventory,
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
            strategy: 'best',
        });
        const weakest = optimizeLoadout({
            catalog: testCatalog,
            inventory: testInventory,
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
            strategy: 'weakest',
        });
        expect(weakest.feasible).toBe(true);
        expect(best.feasible).toBe(true);
        expect(best.plan?.power).toBeGreaterThan(weakest.plan?.power ?? 0);
        expect(weakest.plan?.power).toBeGreaterThanOrEqual(10);
    });

    it('picks the globally lowest feasible power across software choices', () => {
        const low: SoftwareDefinition = {
            id: 'sw-low',
            name: 'Hack low',
            abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['CEDRT'] }],
            consuming: {},
        };
        const high: SoftwareDefinition = {
            id: 'sw-high',
            name: 'Hack high',
            abilities: [{ type: 'HACK', minPower: 20, maxPower: 40, serverTypes: ['CEDRT'] }],
            consuming: {},
        };
        const multiCatalog: ItemCatalog = { ...catalog, software: [high, low] };
        const multiInventory: InventorySnapshot = {
            ...inventory(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']),
            ownedSoftwareIds: new Set([low.id, high.id]),
        };
        const weakest = optimizeLoadout({
            catalog: multiCatalog,
            inventory: multiInventory,
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 15,
            strategy: 'weakest',
        });
        expect(weakest.feasible).toBe(true);
        expect(weakest.plan?.software.id).toBe('sw-low');
        expect(weakest.plan?.power).toBe(20);
    });

    it('selects the smallest PSU for the weakest strategy', () => {
        const best = optimizeLoadout({
            catalog,
            inventory: inventory(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']),
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
            strategy: 'best',
        });
        const weakest = optimizeLoadout({
            catalog,
            inventory: inventory(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']),
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
            strategy: 'weakest',
        });
        expect(best.plan?.hardware.psu.id).toBe('psu200');
        expect(best.plan?.policyId).toBe(new MaxPowerPsuPolicy().id);
        expect(weakest.plan?.hardware.psu.id).toBe('psu100');
        expect(weakest.plan?.policyId).toBe(new MinPowerPsuPolicy().id);
    });

    it('does not keep a larger current PSU in weakest mode', () => {
        const current = inventory(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']);
        const result = optimizeLoadout({
            catalog,
            inventory: {
                ...current,
                equippedHardware: { cpu: 'cpu1', gpu: 'gpu1', ram: 'ram1', psu: 'psu200' },
            },
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 10,
            strategy: 'weakest',
        });
        expect(result.plan?.hardware.psu.id).toBe('psu100');
    });

    it('returns NO_HARDWARE for a non-max account', () => {
        const result = optimizeLoadout({
            catalog,
            inventory: inventory(['gpu1', 'ram1', 'psu200']),
            ability: 'HACK',
            target: 'CEDRT',
        });
        expect(result.feasible).toBe(false);
        expect(result.reason).toBe('NO_HARDWARE');
    });

    it('marks an insufficient plan as infeasible', () => {
        const result = optimizeLoadout({
            catalog,
            inventory: inventory(['cpu1', 'gpu1', 'ram1', 'psu200']),
            ability: 'HACK',
            target: 'CEDRT',
            requiredPower: 100,
        });
        expect(result.feasible).toBe(false);
        expect(result.plan?.feasible).toBe(false);
    });
});

describe('Loadout target matching', () => {
    const decrypt: SoftwareDefinition = {
        id: 'decrypt1',
        name: 'Decrypt',
        abilities: [{ type: 'DECRYPT', minPower: 10, maxPower: 20, fileTypes: ['doc'] }],
        consuming: {},
    };
    const decryptCatalog: ItemCatalog = { ...catalog, software: [decrypt] };
    const decryptInventory: InventorySnapshot = {
        ...inventory(['cpu1', 'gpu1', 'ram1', 'psu200']),
        ownedSoftwareIds: new Set(['decrypt1']),
    };

    it('matches file types regardless of leading dot or case', () => {
        const result = optimizeLoadout({
            catalog: decryptCatalog,
            inventory: decryptInventory,
            ability: 'DECRYPT',
            target: '.DOC',
        });
        expect(result.plan?.software.id).toBe('decrypt1');
    });

    it('can fall back to any owned software with the requested ability', () => {
        const result = optimizeLoadout({
            catalog: decryptCatalog,
            inventory: decryptInventory,
            ability: 'DECRYPT',
            target: '.pdf',
            fallbackToAnyAbility: true,
        });
        expect(result.plan?.software.id).toBe('decrypt1');
    });
});
