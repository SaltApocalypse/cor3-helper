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
    it('keeps the current sufficient hardware and equips the target software', async () => {
        let inventory = initialInventory();
        const calls: string[] = [];
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory } }),
        }, {
            equipHardware: async (id) => {
                calls.push(`equip-hardware:${id}`);
                if (id.startsWith('psu')) inventory = { ...inventory, equippedHardware: { ...inventory.equippedHardware, psu: id } };
                return { ok: true, value: undefined };
            },
            equipSoftware: async (id) => {
                calls.push(`equip-software:${id}`);
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async (id) => {
                calls.push(`unequip-software:${id}`);
                inventory = { ...inventory, equippedSoftwareIds: [] };
                return { ok: true, value: undefined };
            },
        }, async () => undefined);
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 20 });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.hardware.psu.id).toBe('psu100');
        expect(inventory.equippedHardware.psu).toBe('psu100');
        expect(inventory.equippedSoftwareIds).toEqual(['sw1']);
        expect(calls).toEqual(['equip-software:sw1']);
    });


    it('re-equips the target software and uses the max PSU when a hardware swap is required', async () => {
        const lowCpu: HardwareDefinition = { id: 'cpu-low', name: 'Low CPU', slot: 'cpu', specs: { cpuFrequency: 1, cpuConsuming: 5 } };
        const highCpu: HardwareDefinition = { id: 'cpu-high', name: 'High CPU', slot: 'cpu', specs: { cpuFrequency: 20, cpuConsuming: 5 } };
        const lowGpu: HardwareDefinition = { id: 'gpu-low', name: 'Low GPU', slot: 'gpu', specs: { gpuPower: 1, gpuConsuming: 5 } };
        const highGpu: HardwareDefinition = { id: 'gpu-high', name: 'High GPU', slot: 'gpu', specs: { gpuPower: 50, gpuConsuming: 5 } };
        const ram: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
        const psu100: HardwareDefinition = { id: 'psu100', name: 'PSU100', slot: 'psu', specs: { psuPower: 100 } };
        const psu200: HardwareDefinition = { id: 'psu200', name: 'PSU200', slot: 'psu', specs: { psuPower: 200 } };
        const hack: SoftwareDefinition = {
            id: 'sw1',
            name: 'Hack',
            abilities: [{ type: 'HACK', minPower: 10, maxPower: 50, serverTypes: ['CEDRT'] }],
            consuming: { cpu_frequency: [1, 20], gpu_power: [1, 50] },
        };
        const upgradeCatalog: ItemCatalog = {
            catalogVersion: '1',
            gameVersion: 'test',
            hardware: [lowCpu, highCpu, lowGpu, highGpu, ram, psu100, psu200],
            software: [hack],
        };
        const calls: string[] = [];
        let inventory: InventorySnapshot = {
            ownedHardwareIds: new Set(upgradeCatalog.hardware.map((item) => item.id)),
            ownedSoftwareIds: new Set(['sw1']),
            equippedHardware: { cpu: 'cpu-low', gpu: 'gpu-low', ram: 'ram1', psu: 'psu100' },
            equippedSoftwareIds: ['sw1'],
            capturedAt: 1,
        };
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog: upgradeCatalog, inventory } }),
        }, {
            equipHardware: async (id) => {
                calls.push(`equip-hardware:${id}`);
                const item = upgradeCatalog.hardware.find((candidate) => candidate.id === id)!;
                inventory = {
                    ...inventory,
                    equippedHardware: { ...inventory.equippedHardware, [item.slot]: id },
                };
                return { ok: true, value: undefined };
            },
            equipSoftware: async (id) => {
                calls.push(`equip-software:${id}`);
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async (id) => {
                calls.push(`unequip-software:${id}`);
                inventory = { ...inventory, equippedSoftwareIds: [] };
                return { ok: true, value: undefined };
            },
        }, async () => undefined);
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 40 });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.hardware.cpu.id).toBe('cpu-high');
            expect(result.value.hardware.gpu.id).toBe('gpu-high');
            expect(result.value.hardware.psu.id).toBe('psu200');
        }
        expect(calls).toContain('unequip-software:sw1');
        expect(calls).toContain('equip-software:sw1');
        expect(inventory.equippedSoftwareIds).toEqual(['sw1']);
    });

    it('serializes concurrent loadout mutations', async () => {
        const otherSoftware: SoftwareDefinition = {
            id: 'sw2',
            name: 'Other Hack',
            abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['OTHER'] }],
            consuming: {},
        };
        const concurrentCatalog: ItemCatalog = { ...catalog, software: [software, otherSoftware] };
        let inventory: InventorySnapshot = {
            ...initialInventory(),
            ownedSoftwareIds: new Set(['sw1', 'sw2']),
            equippedSoftwareIds: [],
        };
        let inFlight = 0;
        let maxInFlight = 0;
        const command = async (): Promise<{ ok: true; value: undefined }> => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight -= 1;
            return { ok: true, value: undefined };
        };
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog: concurrentCatalog, inventory } }),
        }, {
            equipHardware: async () => ({ ok: true, value: undefined }),
            equipSoftware: async (id) => {
                const result = await command();
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return result;
            },
            unequipSoftware: async (id) => {
                const result = await command();
                inventory = { ...inventory, equippedSoftwareIds: inventory.equippedSoftwareIds.filter((entry) => entry !== id) };
                return result;
            },
        }, async () => undefined);
        const [first, second] = await Promise.all([
            service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 10 }),
            service.ensure({ ability: 'HACK', target: 'OTHER', requiredPower: 10 }),
        ]);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(maxInFlight).toBe(1);
    });

    it('backs off and retries a rate-limited command', async () => {
        let inventory = initialInventory();
        let equipCalls = 0;
        const delays: number[] = [];
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory } }),
        }, {
            equipHardware: async () => ({ ok: true, value: undefined }),
            equipSoftware: async (id) => {
                equipCalls += 1;
                if (equipCalls === 1) {
                    return { ok: false, error: { code: 'APPLY_FAILED', message: 'Too many requests' } };
                }
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async () => ({ ok: true, value: undefined }),
        }, async (ms) => { delays.push(ms); }, undefined, { commandGapMs: 0, rateLimitBackoffMs: 1_234 });
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 10 });
        expect(result.ok).toBe(true);
        expect(equipCalls).toBe(2);
        expect(delays).toContain(1_234);
    });

    it('rejects fallback software when a positive power requirement is present', async () => {
        const service = new LoadoutService({
            get: async () => ({ ok: true, value: { catalog, inventory: initialInventory() } }),
        }, {
            equipHardware: async () => ({ ok: true, value: undefined }),
            equipSoftware: async () => ({ ok: true, value: undefined }),
            unequipSoftware: async () => ({ ok: true, value: undefined }),
        }, async () => undefined);
        const capability = await service.canSatisfy({
            ability: 'HACK',
            target: 'UNKNOWN',
            requiredPower: 10,
            fallbackToAnyAbility: true,
        });
        expect(capability.ok).toBe(true);
        if (capability.ok) {
            expect(capability.value.feasible).toBe(false);
            expect(capability.value.reason).toBe('NO_SOFTWARE');
        }
        const result = await service.ensure({
            ability: 'HACK',
            target: 'UNKNOWN',
            requiredPower: 10,
            fallbackToAnyAbility: true,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INFEASIBLE');
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

    it('invalidates capability state and marks partial apply after a later step fails', async () => {
        const oldSoftware: SoftwareDefinition = {
            id: 'sw-old',
            name: 'Old Hack',
            abilities: [{ type: 'HACK', minPower: 20, maxPower: 20, serverTypes: ['OTHER'] }],
            consuming: {},
        };
        const catalogWithOld: ItemCatalog = { ...catalog, software: [software, oldSoftware] };
        let inventory: InventorySnapshot = {
            ...initialInventory(),
            ownedSoftwareIds: new Set(['sw1', 'sw-old']),
            equippedSoftwareIds: ['sw-old'],
        };
        let getCalls = 0;
        const calls: string[] = [];
        const service = new LoadoutService({
            get: async () => {
                getCalls += 1;
                return { ok: true, value: { catalog: catalogWithOld, inventory } };
            },
        }, {
            equipHardware: async (id) => {
                calls.push(`equip:${id}`);
                return { ok: true, value: undefined };
            },
            equipSoftware: async () => {
                calls.push('equip-software');
                return { ok: false, error: { code: 'APPLY_FAILED', message: 'not-enough-resources' } };
            },
            unequipSoftware: async (id) => {
                calls.push(`unequip:${id}`);
                inventory = { ...inventory, equippedSoftwareIds: [] };
                return { ok: true, value: undefined };
            },
        });
        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 20 });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('APPLY_FAILED');
            expect(result.error.partial).toBe(true);
        }
        expect(calls).toContain('unequip:sw-old');
        const before = getCalls;
        await service.canSatisfy({ ability: 'HACK', target: 'CEDRT', requiredPower: 20 });
        expect(getCalls).toBeGreaterThan(before);
    });

    it('re-optimizes when the software definition changes under the same id', async () => {
        const weakCpu: HardwareDefinition = { id: 'cpu1', name: 'CPU', slot: 'cpu', specs: { cpuFrequency: 10, cpuConsuming: 10 } };
        const baseGpu: HardwareDefinition = { id: 'gpu1', name: 'GPU', slot: 'gpu', specs: { gpuPower: 10, gpuConsuming: 20 } };
        const baseRam: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
        const basePsu: HardwareDefinition = { id: 'psu100', name: 'PSU100', slot: 'psu', specs: { psuPower: 100 } };
        const makeSoftware = (maxPower: number): SoftwareDefinition => ({
            id: 'sw1',
            name: 'Hack',
            abilities: [{ type: 'HACK', minPower: 10, maxPower, serverTypes: ['CEDRT'] }],
            consuming: { cpu_frequency: [0, 5, 25] },
        });
        let softwareDef = makeSoftware(20);
        let inventory: InventorySnapshot = {
            ownedHardwareIds: new Set(['cpu1', 'gpu1', 'ram1', 'psu100']),
            ownedSoftwareIds: new Set(['sw1']),
            equippedHardware: { cpu: 'cpu1', gpu: 'gpu1', ram: 'ram1', psu: 'psu100' },
            equippedSoftwareIds: ['sw1'],
            capturedAt: 1,
        };
        const service = new LoadoutService({
            get: async () => ({
                ok: true,
                value: {
                    catalog: { catalogVersion: '1', gameVersion: 'test', hardware: [weakCpu, baseGpu, baseRam, basePsu], software: [softwareDef] },
                    inventory,
                },
            }),
        }, {
            equipHardware: async () => ({ ok: true, value: undefined }),
            equipSoftware: async (id) => {
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async () => ({ ok: true, value: undefined }),
        }, async () => undefined);

        const first = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 10 });
        if (!first.ok) throw new Error(first.error.message);
        expect(first.value.power).toBe(12);

        // Same ids, different definition: the cached plan must not be reused.
        softwareDef = makeSoftware(40);
        const second = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 10 });
        if (!second.ok) throw new Error(second.error.message);
        expect(second.value.power).toBe(17);
    });

    it('honors maximize by switching to the strongest hardware even when the current setup satisfies the request', async () => {
        const weakCpu: HardwareDefinition = { id: 'cpu-weak', name: 'CPU Weak', slot: 'cpu', specs: { cpuFrequency: 10, cpuConsuming: 10 } };
        const strongCpu: HardwareDefinition = { id: 'cpu-strong', name: 'CPU Strong', slot: 'cpu', specs: { cpuFrequency: 30, cpuConsuming: 10 } };
        const gpu: HardwareDefinition = { id: 'gpu1', name: 'GPU', slot: 'gpu', specs: { gpuPower: 10, gpuConsuming: 20 } };
        const ram: HardwareDefinition = { id: 'ram1', name: 'RAM', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
        const psu: HardwareDefinition = { id: 'psu100', name: 'PSU100', slot: 'psu', specs: { psuPower: 100 } };
        const scaling: SoftwareDefinition = {
            id: 'sw1',
            name: 'Hack',
            abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['CEDRT'] }],
            consuming: { cpu_frequency: [0, 5, 25] },
        };
        let inventory: InventorySnapshot = {
            ownedHardwareIds: new Set(['cpu-weak', 'cpu-strong', 'gpu1', 'ram1', 'psu100']),
            ownedSoftwareIds: new Set(['sw1']),
            equippedHardware: { cpu: 'cpu-weak', gpu: 'gpu1', ram: 'ram1', psu: 'psu100' },
            equippedSoftwareIds: ['sw1'],
            capturedAt: 1,
        };
        const calls: string[] = [];
        const service = new LoadoutService({
            get: async () => ({
                ok: true,
                value: {
                    catalog: { catalogVersion: '1', gameVersion: 'test', hardware: [weakCpu, strongCpu, gpu, ram, psu], software: [scaling] },
                    inventory,
                },
            }),
        }, {
            equipHardware: async (id) => {
                calls.push(`equip-hardware:${id}`);
                if (id.startsWith('cpu')) inventory = { ...inventory, equippedHardware: { ...inventory.equippedHardware, cpu: id } };
                return { ok: true, value: undefined };
            },
            equipSoftware: async (id) => {
                inventory = { ...inventory, equippedSoftwareIds: [id] };
                return { ok: true, value: undefined };
            },
            unequipSoftware: async () => {
                inventory = { ...inventory, equippedSoftwareIds: [] };
                return { ok: true, value: undefined };
            },
        }, async () => undefined);

        const result = await service.ensure({ ability: 'HACK', target: 'CEDRT', requiredPower: 1, maximize: true });
        if (!result.ok) throw new Error(result.error.message);
        expect(result.value.hardware.cpu.id).toBe('cpu-strong');
        expect(result.value.power).toBe(20);
        expect(inventory.equippedHardware.cpu).toBe('cpu-strong');
        expect(calls).toContain('equip-hardware:cpu-strong');
    });
});
