export interface ExpeditionGoal {
    readonly id: string;
    readonly name: string;
}

export interface ExpeditionZone {
    readonly id: string;
    readonly name: string;
    readonly goals: readonly ExpeditionGoal[];
}

export interface ExpeditionLocation {
    readonly id: string;
    readonly name: string;
    readonly zones: readonly ExpeditionZone[];
}

export type DecisionPolicy = 'off' | 'veterans' | 'loot' | 'risk';

export interface ExpeditionMercenary {
    readonly id: string;
    readonly name: string;
    readonly level: number;
    readonly rarity: string;
    readonly price: number;
    readonly totalCost: number | null;
    readonly riskScore: number | null;
    readonly status: string;
    readonly faction: string;
    readonly elite: boolean;
}

export interface ExpeditionDecisionOption {
    readonly id: string;
    readonly label: string;
    readonly successChance: number | null;
    readonly risk: number | null;
    readonly lootModifier: number;
    readonly riskModifier: number;
    readonly requiredModuleId: string | null;
}

export interface ExpeditionDecision {
    readonly id: string;
    readonly expeditionId: string;
    readonly message: string;
    readonly options: readonly ExpeditionDecisionOption[];
}

export interface ActiveExpedition {
    readonly id: string;
    readonly status: string;
    readonly locationName: string;
    readonly mercenaryName: string | null;
    readonly totalCost: number | null;
    readonly riskScore: number | null;
    readonly hasInsurance: boolean | null;
    readonly endsAt: string | null;
}

export interface ExpeditionOverview {
    readonly active: readonly ActiveExpedition[];
    readonly archived: readonly ActiveExpedition[];
    readonly mercenaries: readonly ExpeditionMercenary[];
    readonly locations: readonly ExpeditionLocation[];
    readonly decisions: readonly ExpeditionDecision[];
}

export function chooseDecisionOption(
    options: readonly ExpeditionDecisionOption[],
    policy: DecisionPolicy = 'loot',
): ExpeditionDecisionOption | null {
    if (policy === 'off') return null;
    const usable = options.filter((option) => option.requiredModuleId === null);
    const pool = usable.length > 0 ? usable : [...options];
    pool.sort((left, right) => {
        if (policy === 'veterans') {
            return right.riskModifier - left.riskModifier
                || right.lootModifier - left.lootModifier
                || (right.successChance ?? 0) - (left.successChance ?? 0);
        }
        if (policy === 'risk') {
            return left.riskModifier - right.riskModifier
                || right.lootModifier - left.lootModifier
                || (right.successChance ?? 0) - (left.successChance ?? 0);
        }
        // 'loot' and the legacy default
        return right.lootModifier - left.lootModifier
            || left.riskModifier - right.riskModifier
            || (right.successChance ?? 0) - (left.successChance ?? 0);
    });
    return pool[0] ?? null;
}


export function chooseExpeditionMercenary(mercenaries: readonly ExpeditionMercenary[]): ExpeditionMercenary | null {
    const sorted = [...mercenaries].sort((left, right) =>
        right.level - left.level
        || left.price - right.price
        || left.name.localeCompare(right.name),
    );
    return sorted[0] ?? null;
}


export function isExpeditionReady(expedition: ActiveExpedition): boolean {
    const status = expedition.status.toUpperCase();
    return status.includes('COMPLETE')
        || status.includes('READY')
        || status.includes('CLAIM')
        || status.includes('SUCCESS');
}
