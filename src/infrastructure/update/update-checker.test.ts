import { describe, expect, it } from 'vitest';
import { UpdateChecker, compareVersions, versionNameFromPackage } from './update-checker.js';

describe('compareVersions', () => {
    it('compares numeric build suffixes instead of lexicographically', () => {
        expect(compareVersions('2.0.0-salta-dev.211', '2.0.0-salta-dev.210')).toBeGreaterThan(0);
        expect(compareVersions('2.0.0-salta-dev.99', '2.0.0-salta-dev.100')).toBeLessThan(0);
        expect(compareVersions('2.0.0-salta-dev.210', '2.0.0-salta-dev.210')).toBe(0);
    });

    it('compares base versions first', () => {
        expect(compareVersions('2.0.1-salta-dev.1', '2.0.0-salta-dev.999')).toBeGreaterThan(0);
        expect(compareVersions('v1.9.0', '1.10.0')).toBeLessThan(0);
    });
});

describe('versionNameFromPackage', () => {
    it('builds the fork version name from package metadata', () => {
        expect(versionNameFromPackage({ version: '2.0.0', cor3Fork: { label: 'salta-dev', build: 210 } })).toBe('2.0.0-salta-dev.210');
        expect(versionNameFromPackage({ version: '1.8.6' })).toBe('1.8.6');
    });

    it('prefers the release label over the dev build counter', () => {
        expect(versionNameFromPackage({
            version: '2.1.0',
            cor3Fork: { label: 'salta-dev', releaseLabel: 'salta', build: 231 },
        })).toBe('2.1.0-salta');
    });
});

describe('UpdateChecker', () => {
    it('reports a newer build', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            now: () => 123,
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.0.0',
                cor3Fork: { label: 'salta-dev', build: 211 },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta-dev.210');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updateAvailable).toBe(true);
            expect(result.value.latest).toBe('2.0.0-salta-dev.211');
            expect(result.value.checkedAt).toBe(123);
        }
    });

    it('reports the current build as up to date', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.0.0',
                cor3Fork: { label: 'salta-dev', build: 210 },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta-dev.210');
        expect(result.ok && result.value.updateAvailable).toBe(false);
    });

    it('reports a release update without advertising the dev build counter', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.1.0',
                cor3Fork: { label: 'salta-dev', releaseLabel: 'salta', build: 231 },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updateAvailable).toBe(true);
            expect(result.value.latest).toBe('2.1.0-salta');
        }
    });

    it('surfaces a network failure', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta-dev.210');
        expect(result.ok).toBe(false);
    });
});
