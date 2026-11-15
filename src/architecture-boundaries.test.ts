import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(path));
        else files.push(path);
    }
    return files;
}

const allFiles = walk(SRC);
const relativePath = (file: string): string => relative(SRC, file).replaceAll('\\', '/');
const isTest = (file: string): boolean => file.endsWith('.test.ts') || file.endsWith('.test.tsx');
const sourceFiles = allFiles.filter((file) => /\.(ts|tsx)$/.test(file) && !isTest(file));

function codeOf(file: string): string {
    return readFileSync(file, 'utf8');
}

/** Removes comments and string literals so boundary checks do not match prose. */
function stripped(code: string): string {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function importsOf(code: string): string[] {
    return [...code.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)]
        .map((match) => match[1] ?? '')
        .filter((specifier) => specifier.length > 0);
}

function layeredFiles(layer: 'domains' | 'application' | 'ui'): { file: string; rel: string; code: string }[] {
    return sourceFiles
        .filter((file) => relativePath(file).startsWith(`${layer}/`))
        .map((file) => ({ file, rel: relativePath(file), code: codeOf(file) }));
}

describe('architecture boundaries', () => {
    it('keeps domain and application independent of infrastructure, contexts and UI', () => {
        const violations: string[] = [];
        for (const layer of ['domains', 'application'] as const) {
            for (const entry of layeredFiles(layer)) {
                for (const specifier of importsOf(entry.code)) {
                    if (/(^|\/)(infrastructure|contexts|ui)(\/|$)/.test(specifier)) {
                        violations.push(`${entry.rel} -> ${specifier}`);
                    }
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('keeps domain independent of application, infrastructure, contexts and UI', () => {
        const violations: string[] = [];
        for (const entry of layeredFiles('domains')) {
            for (const specifier of importsOf(entry.code)) {
                if (/(^|\/)(application|infrastructure|contexts|ui)(\/|$)/.test(specifier)) {
                    violations.push(`${entry.rel} -> ${specifier}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('keeps runtime Zod imports out of domain and application code', () => {
        const violations: string[] = [];
        // Type-only helpers such as `import('zod').infer<...>` are allowed; the
        // rule is that domain/application must not parse external data itself.
        const runtimeImport = /import\s+(?!type\b)[\s\S]*?from\s+['"]zod['"]|import\s+['"]zod['"]/;
        for (const layer of ['domains', 'application'] as const) {
            for (const entry of layeredFiles(layer)) {
                if (runtimeImport.test(entry.code)) violations.push(entry.rel);
            }
        }
        expect(violations).toEqual([]);
    });

    it('keeps browser and game globals out of domain and application code', () => {
        const violations: string[] = [];
        const globals = [
            /\bchrome\s*\./,
            /\bwindow\s*\./,
            /\bdocument\s*\./,
            /\bnew\s+WebSocket\b/,
            /\bindexedDB\b/,
            /\blocalStorage\b/,
            /\bsessionStorage\b/,
        ];
        for (const layer of ['domains', 'application'] as const) {
            for (const entry of layeredFiles(layer)) {
                const code = stripped(entry.code);
                for (const pattern of globals) {
                    if (pattern.test(code)) violations.push(`${entry.rel} matches ${pattern}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('keeps UI free of concrete infrastructure and context imports', () => {
        const violations: string[] = [];
        for (const entry of layeredFiles('ui')) {
            for (const specifier of importsOf(entry.code)) {
                if (/(^|\/)(infrastructure|contexts)(\/|$)/.test(specifier)) {
                    violations.push(`${entry.rel} -> ${specifier}`);
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('allows JavaScript source only in the vendored libs directory', () => {
        const violations = allFiles
            .filter((file) => file.endsWith('.js') && !relativePath(file).startsWith('libs/'))
            .map(relativePath);
        expect(violations).toEqual([]);
    });
});
