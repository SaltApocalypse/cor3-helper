import { describe, expect, it } from 'vitest';
import { parseItemCatalog } from './catalog.js';

const valid = {
    catalogVersion: '1',
    gameVersion: '3.05',
    hardware: [{ id: 'cpu1', name: 'CPU', slot: 'cpu', specs: { cpuFrequency: 10 } }],
    software: [{ id: 'sw1', name: 'Hack', abilities: [{ type: 'HACK', minPower: 1, maxPower: 2 }], consuming: {} }],
};

describe('itemCatalogSchema', () => {
    it('accepts a valid catalog', () => {
        expect(parseItemCatalog(valid).catalogVersion).toBe('1');
    });

    it('rejects player ownership fields', () => {
        expect(() => parseItemCatalog({ ...valid, owned: ['cpu1'] })).toThrow();
        expect(() => parseItemCatalog({ ...valid, hardware: [{ ...valid.hardware[0], owned: true }] })).toThrow();
    });

    it('rejects duplicate ids', () => {
        expect(() => parseItemCatalog({ ...valid, hardware: [valid.hardware[0], valid.hardware[0]] })).toThrow();
    });
});
