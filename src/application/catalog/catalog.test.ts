import { describe, expect, it } from 'vitest';
import { catalogSourceSchema } from '../../contracts/catalog-source.js';
import { buildCatalog, catalogSourceFromLoadout, diffCatalogs, mergeCatalogs } from './catalog.js';
import type { ItemCatalog } from '../../domains/loadout/model.js';
import { buildCatalogManifest, catalogChecksum } from '../../tools/catalog/manifest.js';

const source = catalogSourceSchema.parse({
    catalogVersion: '2026.11.1',
    gameVersion: 'test-game',
    source: 'max-account-module-dump',
    hardware: [
        { id: 'cpu-1', name: 'CPU 1', category: 'CPU', specs: { cpuFrequency: 100, cpuCores: 4 } },
        { id: 'psu-1', name: 'PSU 1', category: 'PSU', specs: { psuPower: 500 } },
    ],
    software: [
        { id: 'sw-1', name: 'Hack 1', specs: [{ type: 'HACK', power: [1, 10], serverTypes: ['CEDRT'] }], consuming: { CEDRT: [1, 0] } },
    ],
});

describe('catalog builder', () => {
    it('maps raw modules into a validated static catalog', () => {
        const catalog = buildCatalog(source);
        expect(catalog.catalogVersion).toBe('2026.11.1');
        expect(catalog.hardware[0]?.slot).toBe('cpu');
        expect(catalog.software[0]?.abilities[0]?.maxPower).toBe(10);
    });

    it('rejects duplicate ids', () => {
        expect(() => buildCatalog({ ...source, hardware: [source.hardware[0]!, source.hardware[0]!] })).toThrow(/Duplicate hardware id/);
    });

    it('produces a stable checksum and manifest', async () => {
        const catalog = buildCatalog(source);
        const first = await catalogChecksum(catalog);
        const second = await catalogChecksum(catalog);
        expect(first).toBe(second);
        expect(first).toHaveLength(64);
        const manifest = await buildCatalogManifest(catalog, source, '2026-11-08T00:00:00.000Z');
        expect(manifest.checksum).toBe(first);
        expect(manifest.hardwareCount).toBe(2);
        expect(manifest.softwareCount).toBe(1);
    });

    it('diffs added, removed, and changed records', () => {
        const before = buildCatalog(source);
        const after = buildCatalog({
            ...source,
            hardware: [
                { ...source.hardware[0]!, specs: { cpuFrequency: 120, cpuCores: 4 } },
                { id: 'gpu-1', name: 'GPU 1', category: 'GPU', specs: { gpuPower: 20 } },
            ],
        });
        const diff = diffCatalogs(before, after);
        expect(diff.changedHardware).toEqual(['cpu-1']);
        expect(diff.removedHardware).toEqual(['psu-1']);
        expect(diff.addedHardware).toEqual(['gpu-1']);
    });
});

describe('catalog merge', () => {
    it('keeps runtime definitions and adds static-only items', () => {
        const staticCatalog = buildCatalog(source);
        const runtime: ItemCatalog = {
            catalogVersion: 'runtime',
            gameVersion: 'unknown',
            hardware: [
                { id: 'cpu-1', name: 'CPU 1 live', slot: 'cpu', specs: { cpuFrequency: 100, cpuCores: 4 } },
                { id: 'cpu-event', name: 'Event CPU', slot: 'cpu', specs: { cpuFrequency: 1 } },
            ],
            software: [],
        };
        const merged = mergeCatalogs(runtime, staticCatalog);
        expect(merged.catalogVersion).toBe('2026.11.1');
        expect(merged.hardware.find((item) => item.id === 'cpu-1')?.name).toBe('CPU 1 live');
        expect(merged.hardware.some((item) => item.id === 'psu-1')).toBe(true);
        expect(merged.hardware.some((item) => item.id === 'cpu-event')).toBe(true);
        expect(merged.software.some((item) => item.id === 'sw-1')).toBe(true);
    });

    it('returns the runtime catalog when no static artifact is present', () => {
        const runtime: ItemCatalog = {
            catalogVersion: 'runtime',
            gameVersion: 'unknown',
            hardware: [],
            software: [],
        };
        expect(mergeCatalogs(runtime, null)).toBe(runtime);
    });
});

describe('catalog source from loadout', () => {
    it('wraps owned modules with provenance metadata', () => {
        const result = catalogSourceFromLoadout(
            {
                ownedHardware: [{ id: 'psu-1', category: 'PSU', specs: { psuPower: 500 } }],
                ownedSoftware: [{ id: 'sw-1', specs: [{ type: 'HACK', power: [1, 10] }] }],
            },
            { catalogVersion: 'capture-1', gameVersion: 'test-game', capturedAt: '2026-11-15T00:00:00.000Z' },
        );
        expect(result.catalogVersion).toBe('capture-1');
        expect(result.source).toBe('raw-loadout-capture');
        expect(result.hardware).toHaveLength(1);
        expect(result.software).toHaveLength(1);
        expect(buildCatalog(result).hardware[0]?.slot).toBe('psu');
    });
});
