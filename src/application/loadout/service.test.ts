import { describe, expect, it } from 'vitest';
import type {
    HardwareDefinition,
    InventorySnapshot,
    ItemCatalog,
    SoftwareDefinition,
} from '../../domains/loadout/model.js';
import { LoadoutService } from './service.js';

const cpu: HardwareDefinition = { id: 'cpu1', name: 'CPU', slot: 'cpu', specs: { cpuFrequency: 10, cpuConsuming: 10 } };
const gpu: HardwareDefinition = { id: 'gpu1', name: 'GPU', slot: 'gpu', specs: { gpuPower: 10, gpuConsuming: 20 } };
const ram: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
const psu100: HardwareDefinition = { id: 'psu100', name: 'PSU100', slot: 'psu', specs: { psuPower: 100 } };
const psu200: HardwareDefinition = { id: 'psu200', name: 'PSU200', slot: 'psu', specs: { psuPower: 200 } };
const software: SoftwareDefinition = {
    id: 'sw1',
    name: 'Hack',
    abilities: [{ type: 'HACK', minPower: 20, maxPower: 20, serverTypes: ['CEDRT'] }],
    consuming: {},
};
const catalog: ItemCatalog = { catalogVersion: '1', gameVersion: 'test', hardware: [cpu, gpu, ram, psu100, psu200], software: [software] };

function initialInventory(): InventorySnapshot {
    return {
        ownedHardwareIds: new Set(['cpu1', 'gpu1', 'ram1', 'psu100', 'psu200']),
        ownedSoftwareIds: new Set(['sw1']),
        equippedHardware: { cpu: 'cpu1', gpu: 'gpu1', ram: 'ram1', psu: 'psu100' },
        equippedSoftwareIds: [],
        capturedAt: 1,
    };
}

describe('LoadoutService', () => {
    it('applies and verifies the optimized plan', async () => {
        let inventory = initialInventory();
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory } }),
        }, {
            equipHardware: async (id) => {
                if (id.startsWith('psu')) inventory = { ...inventory, equippedHardware: { ...inventory.equippedHardware, psu: id } };
                return { ok: true, value: undefined };
            },
            equipSoftware: async (id) => {
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async () => ({ ok: true, value: undefined }),
        });
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 20 });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.hardware.psu.id).toBe('psu200');
        expect(inventory.equippedHardware.psu).toBe('psu200');
        expect(inventory.equippedSoftwareIds).toEqual(['sw1']);
    });


    it('reports missing software without equipping anything', async () => {
        let applyCalls = 0;
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory: initialInventory() } }),
        }, {
            equipHardware: async () => { applyCalls++; return { ok: true, value: undefined }; },
            equipSoftware: async () => { applyCalls++; return { ok: true, value: undefined }; },
            unequipSoftware: async () => { applyCalls++; return { ok: true, value: undefined }; },
        });
        const result = await service.canSatisfy({ ability: 'HACK', target: 'UNKNOWN', requiredPower: 0 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.feasible).toBe(false);
            expect(result.value.reason).toBe('NO_SOFTWARE');
        }
        expect(applyCalls).toBe(0);
    });

    it('does not apply when the current plan is already equipped', async () => {
        let calls = 0;
        const inventory = initialInventory();
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory: { ...inventory, equippedHardware: { ...inventory.equippedHardware, psu: 'psu200' }, equippedSoftwareIds: ['sw1'] } } }),
        }, {
            equipHardware: async () => { calls++; return { ok: true, value: undefined }; },
            equipSoftware: async () => { calls++; return { ok: true, value: undefined }; },
            unequipSoftware: async () => { calls++; return { ok: true, value: undefined }; },
        });
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 20 });
        expect(result.ok).toBe(true);
        expect(calls).toBe(0);
    });

    it('installs CPU/GPU before a weaker PSU that cannot power the old pair', async () => {
        const oldCpu: HardwareDefinition = { id: 'cpu-old', name: 'Old CPU', slot: 'cpu', specs: { cpuFrequency: 10, cpuConsuming: 20 } };
        const newCpu: HardwareDefinition = { id: 'cpu-new', name: 'New CPU', slot: 'cpu', specs: { cpuFrequency: 10, cpuConsuming: 5 } };
        const oldGpu: HardwareDefinition = { id: 'gpu-old', name: 'Old GPU', slot: 'gpu', specs: { gpuPower: 10, gpuConsuming: 20 } };
        const newGpu: HardwareDefinition = { id: 'gpu-new', name: 'New GPU', slot: 'gpu', specs: { gpuPower: 10, gpuConsuming: 5 } };
        const ram: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
        const psu20: HardwareDefinition = { id: 'psu20', name: 'PSU20', slot: 'psu', specs: { psuPower: 20 } };
        const psu100: HardwareDefinition = { id: 'psu100', name: 'PSU100', slot: 'psu', specs: { psuPower: 100 } };
        const catalog: ItemCatalog = { catalogVersion: '1', gameVersion: 'test', hardware: [oldCpu, newCpu, oldGpu, newGpu, ram, psu20, psu100], software: [software] };
        const watts = (id: string): number => catalog.hardware.find((item) => item.id === id)?.specs.cpuConsuming
            ?? catalog.hardware.find((item) => item.id === id)?.specs.gpuConsuming
            ?? 0;
        let equipped: { cpu: string; gpu: string; ram: string; psu: string } = { cpu: 'cpu-old', gpu: 'gpu-old', ram: 'ram1', psu: 'psu100' };
        let equippedSoftware: string[] = [];
        const calls: string[] = [];
        const service = new LoadoutService({
            get: async () => ({
                ok: true,
                value: {
                    catalog,
                    inventory: {
                        ownedHardwareIds: new Set(catalog.hardware.map((item) => item.id)),
                        ownedSoftwareIds: new Set(['sw1']),
                        equippedHardware: { ...equipped },
                        equippedSoftwareIds: [...equippedSoftware],
                        capturedAt: 1,
                    },
                },
            }),
        }, {
            equipHardware: async (id) => {
                const item = catalog.hardware.find((candidate) => candidate.id === id)!;
                const next = { ...equipped };
                if (item.slot === 'psu') {
                    if ((item.specs.psuPower ?? 0) < watts(equipped.cpu) + watts(equipped.gpu)) {
                        return { ok: false as const, error: { code: 'APPLY_FAILED', message: 'not-enough-resources' } };
                    }
                    next.psu = id;
                } else {
                    if (item.slot === 'cpu') next.cpu = id;
                    if (item.slot === 'gpu') next.gpu = id;
                    if (item.slot === 'ram') next.ram = id;
                }
                equipped = next;
                calls.push(`equip-${item.slot}:${id}`);
                return { ok: true as const, value: undefined };
            },
            equipSoftware: async (id) => { equippedSoftware = [id]; return { ok: true as const, value: undefined }; },
            unequipSoftware: async () => { equippedSoftware = []; return { ok: true as const, value: undefined }; },
        });
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 10, strategy: 'weakest' });
        expect(result.ok).toBe(true);
        expect(calls).toEqual(['equip-cpu:cpu-new', 'equip-gpu:gpu-new', 'equip-psu:psu20']);
    });
});
