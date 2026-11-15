import { describe, expect, it } from 'vitest';
import { isAutoDailyWaiting } from './auto-daily.js';

describe('Auto Daily waiting state', () => {
    it('does not treat an already-claimed daily as an error', () => {
        expect(isAutoDailyWaiting({
            at: 1,
            solved: false,
            puzzle: 'claimed',
            message: 'Already claimed today; waiting for next reset',
        })).toBe(true);
    });

    it('keeps real failures visible', () => {
        expect(isAutoDailyWaiting({
            at: 1,
            solved: false,
            puzzle: 'unknown',
            message: 'Daily hack failed: no game WebSocket is available',
        })).toBe(false);
        expect(isAutoDailyWaiting(null)).toBe(false);
    });
});
