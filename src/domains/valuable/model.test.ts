import { describe, expect, it } from 'vitest';
import { filterValuableFiles, filterValuableLogs, isValuable, tagLabel } from './model.js';

describe('valuable model', () => {
    it('requires a positive base price and at least one tag', () => {
        expect(isValuable({ basePrice: 10, tags: ['data'] })).toBe(true);
        expect(isValuable({ basePrice: 0, tags: ['data'] })).toBe(false);
        expect(isValuable({ basePrice: 10, tags: [] })).toBe(false);
    });

    it('filters files and logs', () => {
        expect(filterValuableFiles([
            { fileId: 'a', name: 'a', basePrice: 5, tags: ['x'] },
            { fileId: 'b', name: 'b', basePrice: 0, tags: ['x'] },
        ]).map((file) => file.fileId)).toEqual(['a']);
        expect(filterValuableLogs([
            { seq: 1, message: 'a', basePrice: 5, tags: [{ label: 'x' }] },
        ])).toHaveLength(1);
    });

    it('normalises tag labels', () => {
        expect(tagLabel('data')).toBe('data');
        expect(tagLabel({ key: 'k' })).toBe('k');
        expect(tagLabel({ label: 'L' })).toBe('L');
    });
});
