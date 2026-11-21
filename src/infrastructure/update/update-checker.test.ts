import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_UPDATE_CHECK_TIMEOUT_MS,
    UpdateChecker,
    compareVersions,
    versionNameFromPackage,
} from './update-checker.js';

const release = (overrides: Record<string, unknown> = {}) => ({
    tag_name: 'v2.1.0-salta',
    html_url: 'https://github.com/SaltApocalypse/cor3-helper/releases/tag/v2.1.0-salta',
    draft: false,
    prerelease: false,
    ...overrides,
});

function checker(overrides: {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
    readonly now?: () => number;
} = {}) {
    return new UpdateChecker({
        url: 'https://example.test/releases/latest',
        now: overrides.now ?? (() => 123),
        ...(overrides.timeoutMs !== undefined ? { timeoutMs: overrides.timeoutMs } : {}),
        fetchImpl: overrides.fetchImpl ?? (async () => new Response(JSON.stringify(release()), { status: 200 })) as typeof fetch,
    });
}

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

    it('treats a release tag without build as older than the same local build', () => {
        expect(compareVersions('2.0.6-salta', '2.0.6-salta.310')).toBeLessThan(0);
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

describe('UpdateChecker single source', () => {
    it('T01 accepts a normal GitHub Release response', async () => {
        const result = await checker().check('2.0.6-salta.310');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value).toEqual({
                status: 'available',
                currentVersion: '2.0.6-salta.310',
                latestVersion: '2.1.0-salta',
                releaseUrl: release().html_url,
                checkedAt: 123,
                source: 'https://example.test/releases/latest',
            });
        }
    });

    it('T02 surfaces HTTP 404', async () => {
        const result = await checker({ fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatchObject({ code: 'HTTP_ERROR', httpStatus: 404 });
    });

    it('T03 surfaces HTTP 403 and 429', async () => {
        for (const status of [403, 429]) {
            const result = await checker({ fetchImpl: (async () => new Response('', { status })) as typeof fetch }).check('2.0.6-salta');
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toMatchObject({ code: 'HTTP_ERROR', httpStatus: status });
        }
    });

    it('T04 surfaces HTTP 500', async () => {
        const result = await checker({ fetchImpl: (async () => new Response('', { status: 500 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toMatchObject({ code: 'HTTP_ERROR', httpStatus: 500 });
    });

    it('T05 classifies a network exception', async () => {
        const result = await checker({ fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
    });

    it('T06 aborts a hanging request and reports TIMEOUT', async () => {
        const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch;
        const result = await checker({ fetchImpl: hanging, timeoutMs: 5 }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('TIMEOUT');
        expect(DEFAULT_UPDATE_CHECK_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('T07 classifies malformed JSON', async () => {
        const result = await checker({ fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('JSON_ERROR');
    });

    it('T08 rejects a missing tag_name', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: undefined })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
    });

    it('T09 rejects a missing html_url', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ html_url: undefined })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
    });

    it('T10 never treats a draft release as an update', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ draft: true })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
    });

    it('T11 rejects a prerelease because this fork publishes stable releases only', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ prerelease: true })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
    });

    it('T12 reports available when the current version is lower', async () => {
        const result = await checker().check('2.0.0-salta');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.status).toBe('available');
    });

    it('T13 reports latest when versions are equal', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: 'v2.0.6-salta' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.status).toBe('latest');
    });

    it('T14 reports latest when the current version is higher', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: 'v2.0.6-salta' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta.310');
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.status).toBe('latest');
    });

    it('T15 preserves SaltA release-label comparison', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: 'v2.0.7-salta' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta.310');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.latestVersion).toBe('2.0.7-salta');
            expect(result.value.status).toBe('available');
        }
    });

    it('T16 does not invent a remote build number', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: 'v2.0.6-salta' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta.310');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.latestVersion).toBe('2.0.6-salta');
            expect(result.value.status).toBe('latest');
        }
    });

    it('rejects an invalid local version', async () => {
        const result = await checker().check('not-a-version');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_VERSION');
    });

    it('rejects an invalid release tag', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ tag_name: 'latest' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_VERSION');
    });

    it('rejects an invalid release URL', async () => {
        const result = await checker({ fetchImpl: (async () => new Response(JSON.stringify(release({ html_url: 'javascript:alert(1)' })), { status: 200 })) as typeof fetch }).check('2.0.6-salta');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
    });
});

describe('UpdateChecker fetch receiver', () => {
    /** Chrome throws this when fetch runs with a non-global `this`. */
    function receiverSensitiveFetch(record: { receiver?: unknown }) {
        return function (this: unknown) {
            record.receiver = this;
            if (this !== globalThis) {
                throw new TypeError(
                    "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
                );
            }
            return Promise.resolve(new Response(JSON.stringify(release()), { status: 200 }));
        } as unknown as typeof fetch;
    }

    it('F01 calls the global fetch with the global receiver', async () => {
        const record: { receiver?: unknown } = {};
        vi.stubGlobal('fetch', receiverSensitiveFetch(record));
        try {
            const result = await new UpdateChecker({
                url: 'https://example.test/releases/latest',
                now: () => 123,
            }).check('2.0.6-salta.310');
            expect(result.ok).toBe(true);
            expect(record.receiver).toBe(globalThis);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('F02 calls an injected fetch with the global receiver', async () => {
        const record: { receiver?: unknown } = {};
        const result = await new UpdateChecker({
            url: 'https://example.test/releases/latest',
            now: () => 123,
            fetchImpl: receiverSensitiveFetch(record),
        }).check('2.0.6-salta.310');
        expect(result.ok).toBe(true);
        expect(record.receiver).toBe(globalThis);
    });
});
