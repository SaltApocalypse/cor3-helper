import { describe, expect, it } from 'vitest';
import { analyzeLogLine } from './daily-solver.js';

describe('daily log analysis', () => {
    it('accepts a valid log line', () => {
        expect(analyzeLogLine('[12:34:56] AUTH /sector=12 /status=OK')).toEqual([]);
    });

    it('detects malformed time, type, sector and status', () => {
        expect(analyzeLogLine('[99:99:99] NOPE /sector=0 /status=BAD').sort()).toEqual([
            'SECTOR_BAD',
            'STATUS_BAD',
            'TIME',
            'TYPE',
        ]);
    });

    it('detects missing parameters', () => {
        expect(analyzeLogLine('[01:02:03] PING').sort()).toEqual(['MISSING_SECTOR', 'MISSING_STATUS']);
    });
});
