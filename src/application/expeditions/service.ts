import type { Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import { ok } from '../../kernel/result.js';
import type { ExpeditionOverview } from '../../domains/expeditions/model.js';
import { mapExpeditionOverview, mapLocations, mapMercenaries } from './map.js';
import type { ExpeditionLocation } from '../../domains/expeditions/model.js';
import {
    chooseDecisionOption,
    chooseExpeditionMercenary,
    isExpeditionReady,
    type ActiveExpedition,
    type DecisionPolicy,
} from '../../domains/expeditions/model.js';
import type { MercenaryCandidate, MercMarketKey } from '../../domains/expeditions/selection.js';

export interface ExpeditionPort {
    getActive(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getArchived(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getMercenaries(marketId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getConfig(marketId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    respond(expeditionId: string, messageId: string, optionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    configure(config: ExpeditionLaunchConfig): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    launch(config: ExpeditionLaunchConfig): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    openContainer(expeditionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
}

export interface ExpeditionLaunchConfig {
    readonly mercenaryId: string;
    readonly marketId?: string;
    readonly locationConfigId: string;
    readonly zoneConfigId: string;
    readonly goalId: string;
    readonly hasInsurance: boolean;
}

function numberFrom(value: unknown, keys: readonly string[]): number | null {
    if (!value || typeof value !== 'object') return null;
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

    async autoRespond(marketId: string, policy: DecisionPolicy = 'loot'): Promise<Result<number, { readonly code: string; readonly message: string }>> {
        if (policy === 'off') return ok(0);
        const overview = await this.overview(marketId, { includeMercenaries: false, includeConfig: false });
        if (!overview.ok) return overview;
        let responded = 0;
        this.trace?.(`Expedition decision scan: ${overview.value.decisions.length} decision(s), active=${overview.value.active.length}, policy=${policy}`, {
            decisions: overview.value.decisions.length,
            active: overview.value.active.length,
            policy,
        });
        for (const decision of overview.value.decisions) {
            const option = chooseDecisionOption(decision.options, policy);
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
                    options: decision.options,
                    chosen: option?.id ?? null,
                    policy,
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
            let totalCost = merc.totalCost ?? merc.price;
            let riskScore = merc.riskScore ?? 0;
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
                    totalCost = numberFrom(configured.value, ['totalCost', 'cost', 'price']) ?? totalCost;
                    riskScore = numberFrom(configured.value, ['riskScore', 'risk']) ?? riskScore;
                }
            }
            const marketKey: MercMarketKey = request.marketKey === 'usol' && merc.elite ? 'usol-elite' : request.marketKey;
            candidates.push({ mercenary: merc, marketKey, totalCost, riskScore });
        }
        return ok(candidates);
    }

    async payout(marketId: string): Promise<Result<{ readonly ready: number; readonly opened: number; readonly failed: readonly { readonly expeditionId: string; readonly message: string }[] }, { readonly code: string; readonly message: string }>> {
        const ready = await this.readyExpeditions(marketId);
        if (!ready.ok) return ready;
        const failed: { expeditionId: string; message: string }[] = [];
        let opened = 0;
        for (const expedition of ready.value) {
            const result = await this.expeditions.openContainer(expedition.id);
            if (result.ok) opened++;
            else failed.push({ expeditionId: expedition.id, message: result.error.message });
        }
        return ok({ ready: ready.value.length, opened, failed });
    }

    async readyExpeditions(marketId: string): Promise<Result<readonly ActiveExpedition[], { readonly code: string; readonly message: string }>> {
        const overview = await this.overview(marketId, { includeMercenaries: false, includeConfig: false });
        if (!overview.ok) return overview;
        return ok([...overview.value.active, ...overview.value.archived].filter(isExpeditionReady));
    }

    async openContainer(expeditionId: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.expeditions.openContainer(expeditionId);
    }

    async configure(config: ExpeditionLaunchConfig): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        const result = await this.expeditions.configure(config);
        return result.ok ? ok(undefined) : result;
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
