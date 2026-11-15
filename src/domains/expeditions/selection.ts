import type { ExpeditionMercenary } from './model.js';

export type MercMarketKey = 'core' | 'usol' | 'usol-elite';
export type MercSelectionMode = 'market' | 'global';

export interface MercenaryCandidate {
    readonly mercenary: ExpeditionMercenary;
    readonly marketKey: MercMarketKey;
    readonly totalCost: number;
    readonly riskScore: number;
}

export interface MercenarySelectionOptions {
    readonly mode: MercSelectionMode;
    readonly marketOrder: readonly MercMarketKey[];
    readonly maxPrice: number | null;
}

function sortByCost(left: MercenaryCandidate, right: MercenaryCandidate): number {
    return left.totalCost - right.totalCost
        || left.riskScore - right.riskScore
        || right.mercenary.level - left.mercenary.level
        || left.mercenary.name.localeCompare(right.mercenary.name);
}

/**
 * Selects the cheapest available mercenary under the configured policy.
 * `market` walks the user's market order and picks the cheapest mercenary in
 * the first market that has one. `global` ignores the market order.
 */
export function selectMercenary(
    candidates: readonly MercenaryCandidate[],
    options: MercenarySelectionOptions,
): MercenaryCandidate | null {
    const available = candidates.filter((candidate) => {
        const status = candidate.mercenary.status.toUpperCase();
        if (status !== 'AVAILABLE' && status !== 'UNKNOWN') return false;
        if (options.maxPrice !== null && candidate.totalCost > options.maxPrice) return false;
        return true;
    });
    if (available.length === 0) return null;
    if (options.mode === 'global') return [...available].sort(sortByCost)[0] ?? null;

    const hasEliteBucket = options.marketOrder.includes('usol-elite');
    for (const key of options.marketOrder) {
        const bucket = available.filter((candidate) => {
            if (key === 'core') return candidate.marketKey === 'core';
            if (key === 'usol-elite') return candidate.marketKey === 'usol-elite';
            // When the user removes the elite bucket, USOL also includes elite slots.
            return candidate.marketKey === 'usol' || (!hasEliteBucket && candidate.marketKey === 'usol-elite');
        });
        if (bucket.length > 0) return [...bucket].sort(sortByCost)[0] ?? null;
    }
    return null;
}
