import type { ExpeditionLootItem } from '../../domains/expeditions/model.js';

/** Items that make the hidden mercenary-expedition easter egg possible. */
export const MYSTERY_EGG_ITEMS: readonly string[] = [
    'Artificial milk',
    'CCS "Kaloshi" Utility boots',
    'Old Abibas beanie',
];

export interface MysteryEggPayoutInput {
    readonly riskScore: number | null;
    readonly outcome: string | null;
    readonly items: readonly Pick<ExpeditionLootItem, 'name'>[];
}

const EXPLICIT_FULL_OUTCOMES = new Set(['FULL_SUCCESS', 'FULL', 'SUCCESS', 'COMPLETED']);
const EXPLICIT_NON_FULL_PATTERN = /PARTIAL|FAIL|DEATH/;

/**
 * A full success always pays out exactly two items from {@link MYSTERY_EGG_ITEMS},
 * so the item pattern is the main check. A known non-full outcome always wins
 * over the item pattern; an unknown outcome fails closed.
 */
export function isMysteryEggPayout(input: MysteryEggPayoutInput): boolean {
    if (input.riskScore === null || input.riskScore < 95) return false;
    if (input.items.length !== 2) return false;

    const outcome = (input.outcome ?? '').trim().toUpperCase();
    if (EXPLICIT_NON_FULL_PATTERN.test(outcome)) return false;
    if (outcome.length > 0 && !EXPLICIT_FULL_OUTCOMES.has(outcome)) return false;

    const pool = new Set(MYSTERY_EGG_ITEMS);
    return input.items.every((item) => pool.has(item.name.trim()));
}
