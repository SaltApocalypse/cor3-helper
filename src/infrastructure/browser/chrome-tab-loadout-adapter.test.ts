import { describe, expect, it } from 'vitest';
import { ChromeTabLoadoutAdapter } from './chrome-tab-loadout-adapter.js';

const rawLoadout = {
    ownedHardware: [
        { id: 'cpu1', name: 'CPU', category: 'CPU', specs: { cpuFrequency: 10, cpuConsuming: 10 } },
        { id: 'gpu1', name: 'GPU', category: 'GPU', specs: { gpuPower: 10, gpuConsuming: 20 } },
        { id: 'ram1', name: 'RAM', category: 'RAM', specs: { ramFrequency: 10 } },
        { id: 'psu1', name: 'PSU', category: 'PSU', specs: { psuPower: 100 } },
    ],
    ownedSoftware: [{ id: 'sw1', name: 'Hack', specs: [{ type: 'HACK', power: [10, 20] }], consuming: {} }],
    equippedHardware: { cpu: { id: 'cpu1' }, gpu: { id: 'gpu1' }, ram: { id: 'ram1' }, psu: { id: 'psu1' } },
    equippedSoftware: [{ id: 'sw1' }],
};

describe('ChromeTabLoadoutAdapter', () => {
    it('maps raw game loadout to catalog and inventory', async () => {
        const adapter = new ChromeTabLoadoutAdapter({
            findCor3Tab: async () => 1,
            send: async () => ({ ok: true, value: rawLoadout }),
        }, { now: () => 7 });
        const result = await adapter.get();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.catalog.hardware).toHaveLength(4);
            expect(result.value.catalog.software[0]?.abilities[0]?.type).toBe('HACK');
            expect(result.value.inventory.equippedHardware.psu).toBe('psu1');
            expect(result.value.inventory.capturedAt).toBe(7);
        }
    });

    it('sends equip commands through the tab', async () => {
        const sent: unknown[] = [];
        const adapter = new ChromeTabLoadoutAdapter({
            findCor3Tab: async () => 1,
            send: async (_tab, message) => { sent.push(message); return { ok: true }; },
        });
        expect(await adapter.equipSoftware('sw1')).toEqual({ ok: true, value: undefined });
        expect(sent).toEqual([{ type: 'V2_EQUIP_SOFTWARE', moduleConfigId: 'sw1' }]);
    });
});
