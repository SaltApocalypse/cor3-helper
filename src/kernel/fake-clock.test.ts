import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from './fake-clock.js';

describe('FakeClock', () => {
    it('runs timers in order at deterministic times', () => {
        const clock = new FakeClock(100);
        const calls: string[] = [];
        clock.setTimeout(() => calls.push('late'), 20);
        clock.setTimeout(() => calls.push('early'), 5);
        expect(clock.now()).toBe(100);
        clock.advance(10);
        expect(clock.now()).toBe(110);
        expect(calls).toEqual(['early']);
        clock.advance(10);
        expect(clock.now()).toBe(120);
        expect(calls).toEqual(['early', 'late']);
    });

    it('can cancel a timer', () => {
        const clock = new FakeClock();
        const fn = vi.fn();
        const handle = clock.setTimeout(fn, 10);
        clock.clearTimeout(handle);
        clock.advance(20);
        expect(fn).not.toHaveBeenCalled();
    });
});
