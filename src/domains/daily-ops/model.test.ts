import { describe, expect, it } from 'vitest';
import { streakBonus } from './model.js';

describe('streakBonus', () => {
    it('returns the game reward amount without dividing it', () => {
        expect(streakBonus(3, [{ day: 3, amount: 300 }])).toBe(300);
    });

    it('falls back to the closest reached day', () => {
        expect(streakBonus(5, [{ day: 2, amount: 100 }, { day: 4, amount: 250 }])).toBe(250);
    });

    it('returns null when no reward matches', () => {
        expect(streakBonus(1, [])).toBeNull();
    });
});
