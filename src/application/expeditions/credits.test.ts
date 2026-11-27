import { describe, expect, it } from 'vitest';
import { expeditionCreditBudget } from './credits.js';

describe('expeditionCreditBudget', () => {
    it('allows a run that keeps the account at the threshold', () => {
        const budget = expeditionCreditBudget(60_000, 10_000, 50_000);
        expect(budget.remaining).toBe(50_000);
        expect(budget.blocked).toBe(false);
    });

    it('blocks a run that would drop the account below the threshold', () => {
        const budget = expeditionCreditBudget(60_000, 20_000, 50_000);
        expect(budget.remaining).toBe(40_000);
        expect(budget.blocked).toBe(true);
    });

    it('blocks when the balance is already at the threshold and the run costs credits', () => {
        expect(expeditionCreditBudget(50_000, 1_000, 50_000).blocked).toBe(true);
    });

    it('does not block a free run sitting exactly on the threshold', () => {
        expect(expeditionCreditBudget(50_000, 0, 50_000).blocked).toBe(false);
    });

    it('keeps a zero threshold permissive', () => {
        expect(expeditionCreditBudget(5_000, 5_000, 0).blocked).toBe(false);
        expect(expeditionCreditBudget(5_000, 5_001, 0).blocked).toBe(true);
    });
});
