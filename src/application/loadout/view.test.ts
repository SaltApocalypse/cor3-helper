import { describe, expect, it } from 'vitest';
import type { HardwareDefinition, ItemCatalog, SoftwareDefinition } from '../../domains/loadout/model.js';
import type { LoadoutRuntime } from './ports.js';
import { buildLoadoutView } from './view.js';

const cpu: HardwareDefinition = { id: 'cpu1', name: 'CPU 1', slot: 'cpu', specs: { cpuFrequency: 10, cpuCores: 4, cpuConsuming: 10 } };
const gpu: HardwareDefinition = { id: 'gpu1', name: 'GPU 1', slot: 'gpu', specs: { gpuPower: 10, gpuMemory: 10, gpuConsuming: 20 } };
const ram: HardwareDefinition = { id: 'ram1', name: 'RAM 1', slot: 'ram', specs: { ramFrequency: 10, ramMemory: 10 } };
const psu: HardwareDefinition = { id: 'psu1', name: 'PSU 1', slot: 'psu', specs: { psuPower: 200 } };
const hack: SoftwareDefinition = {
    id: 'hack1',
    name: 'Hack 1',
    abilities: [{ type: 'HACK', minPower: 10, maxPower: 20, serverTypes: ['CEDRT'] }],
    consuming: {},
};
const search: SoftwareDefinition = {
    id: 'search1',
    name: 'Search 1',
    abilities: [{ type: 'SEARCH', minPower: 5, maxPower: 10, serverTypes: ['CEDRT'] }],
    consuming: {},
};
const catalog: ItemCatalog = { catalogVersion: '1', gameVersion: 'test', hardware: [cpu, gpu, ram, psu], software: [hack, search] };

function runtime(equippedSoftwareIds: string[]): LoadoutRuntime {
    return {
        catalog,
        inventory: {
            ownedHardwareIds: new Set(['cpu1', 'gpu1', 'ram1', 'psu1']),
            ownedSoftwareIds: new Set(['hack1', 'search1']),
            equippedHardware: { cpu: 'cpu1', gpu: 'gpu1', ram: 'ram1', psu: 'psu1' },
            equippedSoftwareIds,
            capturedAt: 123,
        },
    };
}

describe('buildLoadoutView', () => {
    it('marks equipped items and computes installed software performance', () => {
        const view = buildLoadoutView(runtime(['hack1']));
        expect(view.equippedSoftwareIds).toEqual(['hack1']);
        expect(view.hardware.filter((item) => item.equipped)).toHaveLength(4);
        expect(view.software[0]?.id).toBe('hack1');
        expect(view.software[0]?.equipped).toBe(true);
        expect(view.software[0]?.abilities[0]?.computedPower).toBe(20);
        expect(view.analysis.canBoot).toBe(true);
        expect(view.analysis.supply.psu_power).toBe(200);
        expect(view.capturedAt).toBe(123);
    });

    it('keeps a bootable analysis when no software is installed', () => {
        const view = buildLoadoutView(runtime([]));
        expect(view.software.every((item) => !item.equipped)).toBe(true);
        expect(view.analysis.demand.psu_total).toBe(30);
    });
});
