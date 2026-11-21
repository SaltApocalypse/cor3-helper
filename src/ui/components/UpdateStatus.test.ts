import { describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from '../../contracts/update-check.js';
import { UpdateStatus } from './UpdateStatus.js';

function textOf(node: unknown): string {
    if (node === null || node === undefined || node === false || node === true) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (typeof node === 'object' && 'props' in node) {
        return textOf((node as { props: { children?: unknown } }).props.children);
    }
    return '';
}

function result(overrides: Partial<UpdateCheckResult> = {}): UpdateCheckResult {
    return {
        status: 'available',
        currentVersion: '2.0.6-salta.310',
        latestVersion: '2.0.7-salta',
        releaseUrl: 'https://example.test/release',
        checkedAt: 1_700_000_000_000,
        lastSuccess: {
            status: 'available',
            currentVersion: '2.0.6-salta.310',
            latestVersion: '2.0.7-salta',
            releaseUrl: 'https://example.test/release',
            checkedAt: 1_700_000_000_000,
            source: 'test',
        },
        ...overrides,
    };
}

function render(value: UpdateCheckResult | null, statusError: string | null = null): string {
    return textOf(UpdateStatus({
        language: 'en',
        result: value,
        statusError,
        checking: false,
        onCheck: vi.fn(),
    }));
}

describe('UpdateStatus', () => {
    it('S03 renders an available update', () => {
        const text = render(result());
        expect(text).toContain('Update available: 2.0.7-salta');
        expect(text).toContain('Current version: 2.0.6-salta.310');
        expect(text).toContain('Last checked:');
    });

    it('S04 renders the latest state', () => {
        const text = render(result({
            status: 'latest',
            latestVersion: '2.0.6-salta',
            lastSuccess: {
                status: 'latest',
                currentVersion: '2.0.6-salta.310',
                latestVersion: '2.0.6-salta',
                releaseUrl: 'https://example.test/release',
                checkedAt: 1_700_000_000_000,
                source: 'test',
            },
        }));
        expect(text).toContain('You are up to date.');
        expect(text).toContain('Current version: 2.0.6-salta.310');
    });

    it('S05 renders not checked when no cache exists', () => {
        expect(render(null)).toContain('Not checked yet.');
    });

    it('S06 renders a concrete error without a previous success', () => {
        const text = render(result({
            status: 'failed',
            latestVersion: undefined,
            releaseUrl: undefined,
            error: { code: 'TIMEOUT', message: 'timeout' },
            lastSuccess: null,
        }));
        expect(text).toContain('The update check timed out.');
        expect(text).not.toContain('You are up to date.');
    });

    it('S07 keeps lastSuccess visible after a failure', () => {
        const text = render(result({
            status: 'failed',
            latestVersion: undefined,
            releaseUrl: undefined,
            error: { code: 'NETWORK_ERROR', message: 'offline' },
        }));
        expect(text).toContain('Network unavailable.');
        expect(text).toContain('Last successful check: update 2.0.7-salta available');
        expect(text).not.toContain('Current version: 2.0.6-salta.310');
    });

    it('S11 uses checkedAt rather than the current time', () => {
        const text = render(result());
        expect(text).toContain('Last checked:');
        expect(text).not.toContain('Not checked yet.');
    });

    it('S11 falls back to not checked when checkedAt is missing or zero', () => {
        const text = render(result({ checkedAt: 0 }));
        expect(text).toContain('Not checked yet.');
        expect(text).not.toContain('You are up to date.');
    });

    it('S09 renders the loading state', () => {
        const text = textOf(UpdateStatus({
            language: 'en',
            result: null,
            statusError: null,
            checking: true,
            onCheck: vi.fn(),
        }));
        expect(text).toContain('Checking...');
        expect(text).toContain('Not checked yet.');
    });

    it('renders a bridge status error as a failure', () => {
        const text = render(null, 'bridge unavailable');
        expect(text).toContain('Could not check for updates.');
        expect(text).toContain('bridge unavailable');
    });

    it('S06 maps STORAGE_WRITE_FAILED to the save-failure message', () => {
        const text = render(result({
            status: 'failed',
            latestVersion: undefined,
            releaseUrl: undefined,
            error: { code: 'STORAGE_WRITE_FAILED', message: 'Unrecognized key: "source"' },
        }));
        expect(text).toContain('Could not save the update status.');
        expect(text).toContain('Last successful check: update 2.0.7-salta available');
    });

    it('S06 maps STORAGE_READ_FAILED to the read-failure message', () => {
        const text = render(result({
            status: 'failed',
            checkedAt: 0,
            latestVersion: undefined,
            releaseUrl: undefined,
            error: { code: 'STORAGE_READ_FAILED', message: 'Storage read failed' },
            lastSuccess: null,
        }));
        expect(text).toContain('Could not read the saved update status.');
        expect(text).toContain('Not checked yet.');
    });
});
