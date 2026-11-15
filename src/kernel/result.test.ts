import { describe, expect, it } from 'vitest';
import { err, isOk, ok } from './result.js';

describe('Result', () => {
    it('wraps a success value', () => {
        const result = ok(42);
        expect(result).toEqual({ ok: true, value: 42 });
        expect(isOk(result)).toBe(true);
    });

    it('wraps a domain error', () => {
        const result = err({ code: 'NO_ROUTE' });
        expect(result).toEqual({ ok: false, error: { code: 'NO_ROUTE' } });
        expect(isOk(result)).toBe(false);
    });
});
