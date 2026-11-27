/**
 * Credit floor for Auto Expedition.
 *
 * The configured threshold is a **post-payment** floor: a run may only start
 * when the credits left after paying for it stay at or above the threshold.
 * The earlier behaviour compared the current balance with the threshold alone,
 * which still let a run drain the account below the floor.
 */
export interface ExpeditionCreditBudget {
    /** Credits observed before the run. */
    readonly credits: number;
    /** Total cost the successful run would deduct. */
    readonly totalCost: number;
    /** Configured post-payment floor. */
    readonly threshold: number;
    /** Credits that would remain after paying for the run. */
    readonly remaining: number;
    /** True when paying would leave less than the threshold. */
    readonly blocked: boolean;
}

export function expeditionCreditBudget(credits: number, totalCost: number, threshold: number): ExpeditionCreditBudget {
    const remaining = credits - totalCost;
    return { credits, totalCost, threshold, remaining, blocked: remaining < threshold };
}
