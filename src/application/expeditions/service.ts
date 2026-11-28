import type { Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import { ok } from '../../kernel/result.js';
import type { ExpeditionOverview } from '../../domains/expeditions/model.js';
import type { ExpeditionLocation, ExpeditionLootItem } from '../../domains/expeditions/model.js';
import { mapExpedition, mapExpeditionOverview, mapLocations, mapMercenaries } from './map.js';
import {
    chooseDecisionOption,
    chooseExpeditionMercenary,
    chooseScoredDecisionOption,
    isExpeditionReady,
    type ActiveExpedition,
    type DecisionMode,
    type DecisionPolicy,
} from '../../domains/expeditions/model.js';
import type { MercenaryCandidate, MercMarketKey } from '../../domains/expeditions/selection.js';

/**
 * Opening these rows can never succeed again, so they must be excluded from
 * the "still waiting for payment" gate instead of retried forever. Without
 * this, an expired archived expedition blocked every later launch for hours.
 */
export function isTerminalPayoutError(message: string): boolean {
    return /loot has expired|already (?:fully )?collected|already (?:been )?opened|container (?:not found|missing|unavailable)|no loot/i.test(message)
        || /\bexpired\b/i.test(message);
}

export interface ExpeditionPort {
    getActive(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getArchived(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getMercenaries(marketId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getConfig(marketId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    respond(expeditionId: string, messageId: string, optionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    configure(config: ExpeditionLaunchConfig): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    launch(config: ExpeditionLaunchConfig): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    openContainer(expeditionId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
}

export interface ExpeditionPayout {
    readonly expeditionId: string;
    readonly riskScore: number | null;
    readonly outcome: string | null;
    readonly completedAt: string | null;
    readonly items: readonly ExpeditionLootItem[];
    readonly opened: boolean;
    /**
     * The row can never be opened again (loot expired, container already
     * consumed). It must not block later expedition launches.
     */
    readonly terminal?: boolean;
    readonly error: string | null;
}

export interface ExpeditionPayoutResult {
    readonly ready: number;
    readonly opened: number;
    /** Claimable rows that can never pay out (expired/consumed loot). */
    readonly terminal: number;
    readonly failed: readonly { readonly expeditionId: string; readonly message: string }[];
    /** Per-expedition payment details, recorded internally but not rendered. */
    readonly payouts: readonly ExpeditionPayout[];
}

export interface ExpeditionLaunchConfig {
    readonly mercenaryId: string;
    readonly marketId?: string;
    readonly locationConfigId: string;
    readonly zoneConfigId: string;
    readonly goalId: string;
    readonly hasInsurance: boolean;
}

function numberFrom(value: unknown, keys: readonly string[]): number | null {    if (!value || typeof value !== 'object') return null;
    const queue: unknown[] = [value];
    const seen = new Set<unknown>();
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        for (const key of keys) {
            const candidate = (current as Record<string, unknown>)[key];
            if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
        }
        for (const nested of Object.values(current)) {
            if (nested && typeof nested === 'object') queue.push(nested);
        }
    }
    return null;
}

function booleanFrom(value: unknown, keys: readonly string[]): boolean | null {
    if (!value || typeof value !== 'object') return null;
    for (const key of keys) {
        const candidate = (value as Record<string, unknown>)[key];
        if (typeof candidate === 'boolean') return candidate;
    }
    return null;
}

/**
 * Reads the configured expedition total. The game response can contain both a
 * root `cost` (the initial hire fee) and a nested `totalCost` (the final
 * expedition cost), so an explicit total must win over `cost`/`price` at any
 * depth.
 */
export function totalCostInfo(value: unknown): { readonly total: number | null; readonly explicit: boolean } {
    const explicit = numberFrom(value, ['totalCost', 'total_cost', 'totalPrice', 'total_price']);
    if (explicit !== null) return { total: explicit, explicit: true };
    const fallback = numberFrom(value, ['cost', 'price']);
    return { total: fallback, explicit: false };
}

export class ExpeditionService {
    constructor(
        private readonly expeditions: ExpeditionPort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly trace?: (message: string, data?: unknown) => void,
    ) {}

    async overview(
        marketId: string,
        options: { readonly includeMercenaries?: boolean; readonly includeConfig?: boolean } = {},
    ): Promise<Result<ExpeditionOverview, { readonly code: string; readonly message: string }>> {
        const active = await this.expeditions.getActive();
        if (!active.ok) return active;
        const archived = await this.expeditions.getArchived();
        const mercenaries = options.includeMercenaries === false
            ? ok({})
            : await this.expeditions.getMercenaries(marketId);
        const config = options.includeConfig === false
            ? ok({})
            : await this.expeditions.getConfig(marketId);
        return ok(mapExpeditionOverview(
            active.value,
            archived.ok ? archived.value : {},
            mercenaries.ok ? mercenaries.value : {},
            config.ok ? config.value : {},
        ));
    }

    async respond(expeditionId: string, messageId: string, optionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.expeditions.respond(expeditionId, messageId, optionId);
    }

    async autoRespond(
        marketId: string,
        policy: DecisionPolicy = 'loot',
        mode: DecisionMode = 'simple',
        weights: { readonly loot: number; readonly risk: number } = { loot: 1, risk: -5 },
    ): Promise<Result<number, { readonly code: string; readonly message: string }>> {
        if (policy === 'off' && mode !== 'score') return ok(0);
        const overview = await this.overview(marketId, { includeMercenaries: false, includeConfig: false });
        if (!overview.ok) return overview;
        let responded = 0;
        this.trace?.(`Expedition decision scan: ${overview.value.decisions.length} decision(s), active=${overview.value.active.length}, policy=${policy}`, {
            decisions: overview.value.decisions.length,
            active: overview.value.active.length,
            policy,
            mode,
            weights,
        });
        for (const decision of overview.value.decisions) {
            const option = mode === 'score'
                ? chooseScoredDecisionOption(decision.options, decision.riskScore, weights)
                : chooseDecisionOption(decision.options, policy);
            const optionSummary = decision.options.length === 0
                ? 'no options'
                : decision.options.map((entry) =>
                    `${entry.id || '?'}[${entry.label}] risk=${entry.riskModifier} loot=${entry.lootModifier} chance=${entry.successChance ?? '-'} module=${entry.requiredModuleId ?? '-'}`,
                ).join(' | ');
            this.trace?.(
                `Expedition decision ${decision.expeditionId || '?'}/${decision.id || '?'}: ${optionSummary} => ${option?.id ?? 'none'} (policy=${policy})`,
                {
                    expeditionId: decision.expeditionId,
                    decisionId: decision.id,
                    message: decision.message,
                    riskScore: decision.riskScore,
                    options: decision.options,
                    chosen: option?.id ?? null,
                    policy,
                    mode,
                    weights,
                },
            );
            this.trace?.('Expedition decision evaluated', {
                expeditionId: decision.expeditionId,
                decisionId: decision.id,
                options: decision.options.map((entry) => ({
                    id: entry.id,
                    label: entry.label,
                    risk: entry.risk,
                    lootModifier: entry.lootModifier,
                    riskModifier: entry.riskModifier,
                    requiredModuleId: entry.requiredModuleId,
                })),
                chosen: option?.id ?? null,
                policy,
            });
            if (!option) continue;
            const result = await this.respond(decision.expeditionId, decision.id, option.id);
            if (!result.ok) return result;
            responded++;
        }
        return ok(responded);
    }

    /**
     * Loads mercenaries for one market and asks the game to configure each one
     * so the UI/automation can compare total cost and risk before launching.
     */
    async locations(marketId: string): Promise<Result<readonly ExpeditionLocation[], { readonly code: string; readonly message: string }>> {
        const config = await this.expeditions.getConfig(marketId);
        return config.ok ? ok(mapLocations(config.value)) : config;
    }

    async candidates(request: {
        readonly marketId: string;
        readonly marketKey: 'core' | 'usol';
        readonly hasInsurance: boolean;
        readonly maxCandidates?: number;
        readonly locations?: readonly ExpeditionLocation[];
        readonly locationConfigId?: string;
        readonly zoneConfigId?: string;
        readonly goalId?: string;
    }): Promise<Result<readonly MercenaryCandidate[], { readonly code: string; readonly message: string }>> {
        const mercenaries = await this.expeditions.getMercenaries(request.marketId);
        if (!mercenaries.ok) return mercenaries;
        let locations = request.locations;
        if (!locations) {
            const config = await this.expeditions.getConfig(request.marketId);
            locations = mapLocations(config.ok ? config.value : {});
        }
        const location = locations.find((entry) => entry.id === request.locationConfigId) ?? locations[0];
        const zone = location?.zones.find((entry) => entry.id === request.zoneConfigId) ?? location?.zones[0];
        const goal = zone?.goals.find((entry) => entry.id === request.goalId) ?? zone?.goals[0];
        const mercs = mapMercenaries(mercenaries.value);
        const limited = request.maxCandidates ? mercs.slice(0, request.maxCandidates) : mercs;
        const candidates: MercenaryCandidate[] = [];
        for (const merc of limited) {
            await this.sleep(150);
            let totalCost = merc.totalCost;
            let costEstimated = false;
            let riskScore = merc.riskScore ?? 0;
            let insuranceCost: number | null = null;
            if (location && zone && goal) {
                const configured = await this.expeditions.configure({
                    mercenaryId: merc.id,
                    marketId: request.marketId,
                    locationConfigId: location.id,
                    zoneConfigId: zone.id,
                    goalId: goal.id,
                    hasInsurance: request.hasInsurance,
                });
                if (configured.ok) {
                    const cost = totalCostInfo(configured.value);
                    if (cost.total !== null) {
                        totalCost = cost.total;
                        costEstimated = !cost.explicit;
                    }
                    riskScore = numberFrom(configured.value, ['riskScore', 'risk']) ?? riskScore;
                    insuranceCost = numberFrom(configured.value, ['insuranceCost', 'insurancePrice', 'insuranceFee']);
                    this.trace?.('Mercenary candidate configured', {
                        mercenaryId: merc.id,
                        requestedInsurance: request.hasInsurance,
                        reportedInsurance: booleanFrom(configured.value, ['hasInsurance', 'insurance']),
                        totalCost: cost.total,
                        totalCostExplicit: cost.explicit,
                        insuranceCost,
                        riskScore,
                    });
                }
            }
            if (totalCost === null) {
                totalCost = merc.price;
                costEstimated = true;
            }
            const marketKey: MercMarketKey = request.marketKey === 'usol' && merc.elite ? 'usol-elite' : request.marketKey;
            candidates.push({ mercenary: merc, marketKey, totalCost, riskScore, insurance: request.hasInsurance, insuranceCost, costEstimated });
        }
        return ok(candidates);
    }

    async payout(marketId: string): Promise<Result<ExpeditionPayoutResult, { readonly code: string; readonly message: string }>> {
        const ready = await this.readyExpeditions(marketId);
        if (!ready.ok) return ready;
        const failed: { expeditionId: string; message: string }[] = [];
        const payouts: ExpeditionPayout[] = [];
        let opened = 0;
        let terminal = 0;
        for (const expedition of ready.value) {
            const result = await this.expeditions.openContainer(expedition.id);
            if (!result.ok) {
                // The game keeps completed/expired rows visible long after they
                // can pay out. Treating them as permanent claimables blocked
                // every later launch (ready > opened) for hours.
                if (isTerminalPayoutError(result.error.message)) {
                    terminal++;
                    payouts.push({
                        expeditionId: expedition.id,
                        riskScore: expedition.riskScore,
                        outcome: expedition.outcome,
                        completedAt: expedition.completedAt,
                        items: [],
                        opened: false,
                        terminal: true,
                        error: result.error.message,
                    });
                    continue;
                }
                failed.push({ expeditionId: expedition.id, message: result.error.message });
                payouts.push({
                    expeditionId: expedition.id,
                    riskScore: expedition.riskScore,
                    outcome: expedition.outcome,
                    completedAt: expedition.completedAt,
                    items: [],
                    opened: false,
                    error: result.error.message,
                });
                continue;
            }
            opened++;
            const response = mapExpedition(result.value);
            payouts.push({
                expeditionId: expedition.id,
                riskScore: response?.riskScore ?? expedition.riskScore,
                outcome: response?.outcome ?? expedition.outcome,
                completedAt: response?.completedAt ?? expedition.completedAt,
                items: response?.loot ?? [],
                opened: true,
                error: null,
            });
        }
        return ok({ ready: ready.value.length, opened, terminal, failed, payouts });
    }

    async readyExpeditions(marketId: string): Promise<Result<readonly ActiveExpedition[], { readonly code: string; readonly message: string }>> {
        const overview = await this.overview(marketId, { includeMercenaries: false, includeConfig: false });
        if (!overview.ok) return overview;
        return ok([...overview.value.active, ...overview.value.archived]
            .filter((entry) => isExpeditionReady(entry) && entry.containerOpenedAt === null));
    }

    async openContainer(expeditionId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>> {
        return this.expeditions.openContainer(expeditionId);
    }

    async configure(config: ExpeditionLaunchConfig): Promise<Result<unknown, { readonly code: string; readonly message: string }>> {
        return this.expeditions.configure(config);
    }

    async launch(config: ExpeditionLaunchConfig): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.expeditions.launch(config);
    }

    async autoLaunch(marketId: string): Promise<Result<ExpeditionLaunchConfig | null, { readonly code: string; readonly message: string }>> {
        const overview = await this.overview(marketId);
        if (!overview.ok) return overview;
        const location = overview.value.locations[0];
        const zone = location?.zones[0];
        const goal = zone?.goals[0];
        const mercenary = chooseExpeditionMercenary(overview.value.mercenaries);
        if (!location || !zone || !goal || !mercenary) {
            return ok(null);
        }
        const config: ExpeditionLaunchConfig = {
            mercenaryId: mercenary.id,
            locationConfigId: location.id,
            zoneConfigId: zone.id,
            goalId: goal.id,
            hasInsurance: false,
        };
        const configured = await this.expeditions.configure(config);
        if (!configured.ok) return configured;
        const launched = await this.expeditions.launch(config);
        return launched.ok ? ok(config) : launched;
    }
}
