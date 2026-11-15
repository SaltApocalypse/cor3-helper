import { describe, expect, it } from 'vitest';
import { normalizeSaiFile, normalizeSaiFiles } from './sai.js';

describe('SAI file normalization', () => {
    it('normalizes file fields and tag objects', () => {
        expect(normalizeSaiFile({
            fileId: 'file-1',
            name: 'mission.dat',
            source: 'job',
            isValuableMarked: true,
            basePrice: '1250',
            detectRate: 12,
            tags: ['data', { label: 'intel' }, { key: 'encrypted' }],
        })).toEqual({
            fileId: 'file-1',
            name: 'mission.dat',
            source: 'job',
            isValuableMarked: true,
            basePrice: 1250,
            detectRate: 12,
            tags: ['data', 'intel', 'encrypted'],
        });
    });

    it('falls back to id and generated source', () => {
        expect(normalizeSaiFile({ id: 'file-2' })).toEqual({
            fileId: 'file-2',
            name: 'file-2',
            source: 'generated',
            isValuableMarked: false,
            basePrice: 0,
            detectRate: 0,
            tags: [],
        });
    });

    it('drops malformed entries and preserves valid ones', () => {
        expect(normalizeSaiFiles({
            files: [
                { fileId: 'a', name: 'a', basePrice: 10 },
                { name: 'no id' },
                null,
                { fileId: 'b', name: 'b', tags: [{ label: 'data' }] },
            ],
        }).map((file) => file.fileId)).toEqual(['a', 'b']);
    });

    it('returns an empty list for an unexpected payload', () => {
        expect(normalizeSaiFiles(null)).toEqual([]);
        expect(normalizeSaiFiles({ files: 'nope' })).toEqual([]);
    });
});
