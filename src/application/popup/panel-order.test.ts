import { describe, expect, it } from 'vitest';
import { isSamePanelOrder, mergePanelOrder } from './panel-order.js';

describe('mergePanelOrder', () => {
    it('keeps the default order when nothing is saved', () => {
        expect(mergePanelOrder(['a', 'b', 'c'], undefined, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    it('applies the saved order for visible panels', () => {
        expect(mergePanelOrder(['a', 'b', 'c'], ['c', 'a', 'b'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    });

    it('appends new panels in default order and ignores removed ones', () => {
        expect(mergePanelOrder(['a', 'b', 'c', 'd'], ['b', 'gone', 'a'], ['a', 'b', 'c', 'd'])).toEqual([
            'b',
            'a',
            'c',
            'd',
        ]);
    });

    it('skips saved panels that are currently hidden', () => {
        expect(mergePanelOrder(['a', 'b', 'c'], ['c', 'b', 'a'], ['a', 'c'])).toEqual(['c', 'a']);
    });

    it('restores a hidden panel at its default position when it returns', () => {
        expect(mergePanelOrder(['a', 'b', 'c'], ['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b']);
    });

    it('deduplicates repeated saved ids', () => {
        expect(mergePanelOrder(['a', 'b'], ['b', 'b', 'a'], ['a', 'b'])).toEqual(['b', 'a']);
    });
});

describe('isSamePanelOrder', () => {
    it('compares ids and positions', () => {
        expect(isSamePanelOrder(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(isSamePanelOrder(['a', 'b'], ['b', 'a'])).toBe(false);
        expect(isSamePanelOrder(['a'], ['a', 'b'])).toBe(false);
    });
});
