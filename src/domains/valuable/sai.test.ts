import { describe, expect, it } from 'vitest';
import type { SaiFileEntry } from '../../contracts/sai.js';
import { hasSaiFileBadge, saiFileHighlight } from './sai.js';

function file(overrides: Partial<SaiFileEntry> = {}): SaiFileEntry {
    return {
        fileId: 'file-1',
        name: 'file.dat',
        source: 'generated',
        isValuableMarked: false,
        basePrice: 0,
        detectRate: 0,
        tags: [],
        ...overrides,
    };
}

describe('SAI file highlighting', () => {
    it('uses the original userscript palette order', () => {
        expect(saiFileHighlight(file({ source: 'user' }))).toBe('user');
        expect(saiFileHighlight(file({ source: 'system' }))).toBe('system');
        expect(saiFileHighlight(file({ source: 'job' }))).toBe('job');
        expect(saiFileHighlight(file({ source: 'generated', isValuableMarked: true }))).toBe('valuable');
        expect(saiFileHighlight(file({ source: 'generated', basePrice: 10 }))).toBe('priced');
        expect(saiFileHighlight(file({ source: 'generated', tags: ['data'] }))).toBe('priced');
        expect(saiFileHighlight(file({ source: 'remote' }))).toBe('other');
    });

    it('keeps the source colour ahead of value metadata, matching the original script', () => {
        expect(saiFileHighlight(file({ source: 'user', basePrice: 10 }))).toBe('user');
        expect(saiFileHighlight(file({ source: 'system', tags: ['data'] }))).toBe('system');
        expect(saiFileHighlight(file({ source: 'job', isValuableMarked: true }))).toBe('job');
    });

    it('leaves ordinary generated files untouched', () => {
        expect(saiFileHighlight(file())).toBe('none');
    });

    it('only creates a value badge when there is value metadata', () => {
        expect(hasSaiFileBadge(file())).toBe(false);
        expect(hasSaiFileBadge(file({ source: 'job' }))).toBe(false);
        expect(hasSaiFileBadge(file({ basePrice: 1 }))).toBe(true);
        expect(hasSaiFileBadge(file({ detectRate: 5 }))).toBe(true);
        expect(hasSaiFileBadge(file({ tags: ['data'] }))).toBe(true);
    });
});
