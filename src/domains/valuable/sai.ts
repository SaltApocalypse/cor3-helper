import type { SaiFileEntry } from '../../contracts/sai.js';

/**
 * Original userscript palette:
 * user = blue, system = red, job = yellow, marked valuable = teal,
 * price/tags = orange, other non-generated sources = magenta.
 */
export type SaiFileHighlight = 'none' | 'user' | 'system' | 'job' | 'valuable' | 'priced' | 'other';

export function saiFileHighlight(entry: SaiFileEntry): SaiFileHighlight {
    if (entry.source === 'user') return 'user';
    if (entry.source === 'system') return 'system';
    if (entry.source === 'job') return 'job';
    if (entry.isValuableMarked) return 'valuable';
    if (entry.basePrice > 0 || entry.tags.length > 0) return 'priced';
    if (entry.source !== 'generated' && entry.source.length > 0) return 'other';
    return 'none';
}

export function hasSaiFileBadge(entry: SaiFileEntry): boolean {
    return entry.basePrice > 0 || entry.detectRate > 0 || entry.tags.length > 0;
}
