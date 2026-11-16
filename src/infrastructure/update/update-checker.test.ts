import { describe, expect, it, vi } from 'vitest';
import { UpdateChecker, compareVersions, versionNameFromPackage } from './update-checker.js';

describe('compareVersions', () => {
    it('compares numeric build suffixes instead of lexicographically', () => {
        expect(compareVersions('2.0.0-salta.211', '2.0.0-salta.210')).toBeGreaterThan(0);
        expect(compareVersions('2.0.0-salta.99', '2.0.0-salta.100')).toBeLessThan(0);
        expect(compareVersions('2.0.0-salta.210', '2.0.0-salta.210')).toBe(0);
    });

    it('compares base versions first', () => {
        expect(compareVersions('2.0.1-salta.1', '2.0.0-salta.999')).toBeGreaterThan(0);
        expect(compareVersions('v1.9.0', '1.10.0')).toBeLessThan(0);
    });
});

describe('versionNameFromPackage', () => {
    it('prefers the release label over the local build counter', () => {
        expect(versionNameFromPackage({
            version: '2.1.0',
            cor3Fork: { label: 'salta', releaseLabel: 'salta', build: 231 },
        })).toBe('2.1.0-salta');
    });

    it('keeps the local label/build fallback for older package metadata', () => {
        expect(versionNameFromPackage({ version: '2.0.0', cor3Fork: { label: 'salta', build: 210 } })).toBe('2.0.0-salta.210');
        expect(versionNameFromPackage({ version: '1.8.6' })).toBe('1.8.6');
    });
});

describe('UpdateChecker', () => {
    it('reports a newer release', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            now: () => 123,
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.1.0',
                cor3Fork: { releaseLabel: 'salta', build: 231 },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updateAvailable).toBe(true);
            expect(result.value.latest).toBe('2.1.0-salta');
            expect(result.value.checkedAt).toBe(123);
        }
    });

    it('does not advertise a local build over the same release', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.0.0',
                cor3Fork: { releaseLabel: 'salta', build: 237 },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta.236');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.updateAvailable).toBe(false);
            expect(result.value.latest).toBe('2.0.0-salta');
        }
    });

    it('reports the current release as up to date', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response(JSON.stringify({
                version: '2.0.0',
                cor3Fork: { releaseLabel: 'salta' },
            }))) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta');
        expect(result.ok && result.value.updateAvailable).toBe(false);
    });

    it('falls back to another mirror when the first endpoint is blocked', async () => {
        const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).includes('raw.githubusercontent.com')) throw new Error('blocked');
            return new Response(JSON.stringify({
                version: '2.1.0',
                cor3Fork: { releaseLabel: 'salta', build: 249 },
            }));
        }) as unknown as typeof fetch;
        const checker = new UpdateChecker({
            urls: ['https://raw.githubusercontent.com/test/package.json', 'https://cdn.example.test/package.json'],
            fetchImpl,
        });
        const result = await checker.check('2.0.1-salta');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.latest).toBe('2.1.0-salta');
            expect(result.value.source).toBe('https://cdn.example.test/package.json');
        }
    });

    it('uses the highest result from package mirrors and the releases API', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/package.json'],
            apiUrls: ['https://api.example.test/releases/latest'],
            fetchImpl: (async (input: RequestInfo | URL) => new Response(JSON.stringify(
                String(input).includes('api.example.test')
                    ? { tag_name: 'v2.0.2-salta', html_url: 'https://example.test/release' }
                    : { version: '2.0.1', cor3Fork: { releaseLabel: 'salta' } },
            ))) as typeof fetch,
        });
        const result = await checker.check('2.0.1-salta');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.latest).toBe('2.0.2-salta');
            expect(result.value.source).toBe('https://api.example.test/releases/latest');
            expect(result.value.releaseUrl).toBe('https://example.test/release');
        }
    });

    it('surfaces a network failure', async () => {
        const checker = new UpdateChecker({
            urls: ['https://example.test/v2/package.json'],
            fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
        });
        const result = await checker.check('2.0.0-salta');
        expect(result.ok).toBe(false);
    });
});
