export interface MarketReputation {
    readonly level: number;
    readonly progress: number;
    readonly required: number;
    readonly levelLocked: boolean;
    readonly maxLevel: boolean;
}

export interface MarketLot {
    readonly id: string;
    readonly category: string;
    readonly name: string;
    readonly description: string;
    readonly price: number;
    readonly priceModifier: number;
    readonly accessLevel: number | null;
    readonly availableCount: number | null;
    readonly manufacturer: string | null;
    readonly tier: string | null;
    readonly lockedByQuest: string | null;
    readonly unavailableReason: string | null;
    readonly specs: readonly string[];
}

export interface MarketJobSummary {
    readonly id: string;
    readonly name: string;
    readonly rewardCredits: number;
    readonly rewardReputation: number;
    readonly completed: boolean;
    readonly expired: boolean;
    readonly taken: boolean;
}

export interface MarketView {
    readonly marketId: string;
    readonly marketName: string;
    readonly credits: number;
    readonly reputation: MarketReputation | null;
    readonly lots: readonly MarketLot[];
    readonly jobs: readonly MarketJobSummary[];
    readonly recentJobs: readonly MarketJobSummary[];
    readonly nextJobsResetAt: string | null;
}
