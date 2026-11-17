import { describe, expect, it } from 'vitest';
import { buildDebugLogStatusLine } from './useDebugLogs.js';

describe('buildDebugLogStatusLine', () => {
    it('shows the displayed version and refresh reason', () => {
        const line = buildDebugLogStatusLine(
            { version: '2.0.3', versionName: '2.0.3-salta', build: '263' },
            42,
            'auto-finish-1',
            true,
        );
        expect(line.level).toBe('info');
        expect(line.scope).toBe('system');
        expect(line.message).toContain('COR3 Helper 2.0.3-salta.263');
        expect(line.message).toContain('logs refreshed');
        expect(line.message).toContain('42 line(s)');
        expect(line.data).toMatchObject({
            version: '2.0.3',
            versionName: '2.0.3-salta',
            build: '263',
            runId: 'auto-finish-1',
            lines: 42,
            reason: 'refresh',
        });
    });

    it('marks the initial load separately from a refresh', () => {
        const line = buildDebugLogStatusLine(
            { version: '2.0.3', versionName: '2.0.3-salta', build: null },
            0,
            null,
            false,
        );
        expect(line.message).toContain('logs loaded');
        expect(line.message).toContain('0 line(s)');
        expect(line.data).toMatchObject({ reason: 'load', runId: null });
    });
});
