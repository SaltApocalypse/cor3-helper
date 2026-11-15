import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZH_MESSAGES } from './i18n-messages.js';

function walk(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory()
            ? walk(path)
            : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('i18n source catalog', () => {
    it('has a Chinese translation for every literal tr()/tt() source string', () => {
        const uiRoot = join(process.cwd(), 'src/ui');
        const missing = new Set<string>();
        for (const file of walk(uiRoot)) {
            if (file.endsWith('i18n.ts') || file.endsWith('i18n-messages.ts') || file.endsWith('i18n-context.tsx')) continue;
            const source = readFileSync(file, 'utf8');
            for (const match of source.matchAll(/\b(?:tr|tt)\(\s*'((?:[^'\\]|\\.)*)'/g)) {
                const key = match[1] ?? '';
                if (key && !(key in ZH_MESSAGES)) missing.add(`${key} (${file})`);
            }
        }
        expect([...missing]).toEqual([]);
    });
});
