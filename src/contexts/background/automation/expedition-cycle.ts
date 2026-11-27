import { jobMarketByKey, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { selectMercenary } from '../../../domains/expeditions/selection.js';
import { MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket, mercProfileMatchesLocations } from '../../../domains/expeditions/profiles.js';
import {
    chooseDecisionOption,
    chooseScoredDecisionOption,
    isExpeditionReady,
    type ExpeditionDecision,
    type DecisionPolicy,
} from '../../../domains/expeditions/model.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import { isMysteryEggPayout } from '../../../application/expeditions/mystery-egg.js';
import { AUTO_EXPEDITION_ALARM, AUTO_EXPEDITION_RETRY_ALARM } from './alarm-ids.js';
import { readWithRetry } from './delay.js';
import { launchExpedition } from './expedition-launch.js';
import { EXPEDITION_PAYOUT_STATE_KEY, MYSTERY_EGG_STATE_KEY } from './expedition-types.js';
import type { AutoExpeditionDeps, ExpeditionDecisionState, ExpeditionRunState } from './expedition-types.js';

const AUTO_EXPEDITION_CONNECTION_RETRY_MS = 30_000;
const AUTO_EXPEDITION_ACTIVE_RETRY_MS = 60_000;

export function expeditionConnectionError(message: string | null | undefined): boolean {
    return !!message && /Could not establish connection|Receiving end does not exist|NO_COR3_TAB|No game WebSocket|GAME_NO_SOCKET|AUTH_REQUIRED|AUTH_EXPIRED/i.test(message);
}

/** One Auto Expedition cycle. State is owned by the coordinator and mutated here. */
export class ExpeditionCycle {
    constructor(
        private readonly deps: AutoExpeditionDeps,
        private readonly state: ExpeditionRunState,
    ) {}

    async run(): Promise<void> {
        if (this.state.running) return;
        this.state.running = true;
        const owner = `auto-expedition:${crypto.randomUUID()}`;
        const lease = await this.deps.state.acquireLease('auto-expedition', owner, 10 * 60_000);
        if (!lease) {
            this.state.running = false;
            this.deps.logger.info('auto-expedition', 'Auto Expedition skipped: lease held by another worker');
            return;
        }
        try {
            const current = await this.deps.settings.get();
            if (!current.autoExpeditionEnabled || current.helperMode) return;
            const storedExpedition = await this.deps.state.get('auto-expedition');
            if (storedExpedition.phase === 'preparing' && storedExpedition.nextActionAt !== null) {
                if (storedExpedition.nextActionAt > this.deps.clock.now()) {
                    this.deps.logger.info('auto-expedition', 'Resuming persisted preparation countdown', {
                        until: storedExpedition.nextActionAt,
                    });
                    this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: storedExpedition.nextActionAt });
                    return;
                }
                this.deps.logger.info('auto-expedition', 'Persisted preparation countdown expired; reconciling active expeditions');
                this.state.preparation = null;
                await this.deps.state.set('auto-expedition', {
                    phase: 'idle',
                    runId: null,
                    nextActionAt: null,
                    lastError: null,
                });
                this.deps.events.publish('expeditions.auto.preparing', null);
            }
            this.deps.logger.info('auto-expedition', 'Auto Expedition run started', {
                autoSelect: true,
                mode: current.mercSelectionMode,
                maxPrice: current.mercMaxPriceEnabled ? current.mercMaxPrice : null,
                insurance: current.mercInsuranceEnabled,
                decisionPolicy: current.mercDecisionPolicy,
            });
            const home = jobMarketByKey('home');
            const usol = jobMarketByKey('usol');
            if (!home) {
                this.state.last = { at: this.deps.clock.now(), decisions: 0, launched: false, error: 'Home market is not configured' };
                return;
            }

            let decisions = 0;

            // Check the credit floor before payout/active gates. Otherwise a
            // stuck "already collected" payout or a long-running expedition can
            // keep Auto Expedition enabled well below the configured threshold.
            if (current.mercMinCreditsEnabled) {
                const credits = await this.readHomeCredits(home.marketId);
                if (credits !== null) {
                    this.deps.logger.info('auto-expedition', 'Credits checked at cycle start', {
                        credits,
                        threshold: current.mercMinCredits,
                        enabled: true,
                    });
                    if (credits < current.mercMinCredits) {
                        this.state.last = {
                            at: this.deps.clock.now(),
                            decisions,
                            launched: false,
                            error: `Credits ${credits.toLocaleString()} below threshold ${current.mercMinCredits.toLocaleString()}`,
                            paid: 0,
                            message: 'Auto Expedition disabled: credits below threshold',
                        };
                        await this.disable('credits below threshold');
                        this.deps.events.publish('expeditions.auto.done', this.state.last);
                        return;
                    }
                }
            }

            let paid = 0;
            if (current.mercAutoPayEnabled) {
                const routed = await this.deps.routing.routeToServer(home.routeServerId, 'auto-expedition', 'merc:pay');
                if (!routed.ok) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: routed.error.message,
                        paid,
                        message: 'Could not reach the home market to pay completed expeditions',
                    };
                    await this.deps.state.set('auto-expedition', {
                        phase: 'waiting',
                        nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS,
                        lastError: routed.error.message,
                        payload: { last: this.state.last },
                    });
                    this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
                    return;
                }
                const payout = await this.deps.service.payout(home.marketId);
                if (!payout.ok) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: payout.error.message,
                        paid,
                        message: 'Could not verify completed expeditions; waiting before launching',
                    };
                    this.deps.logger.warn('auto-expedition', 'Expedition payout check failed', {
                        code: payout.error.code,
                        message: payout.error.message,
                    });
                    await this.deps.state.set('auto-expedition', {
                        phase: 'waiting',
                        nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS,
                        lastError: payout.error.message,
                        payload: { last: this.state.last },
                    });
                    this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
                    return;
                }
                paid = payout.value.opened;
                if (payout.value.ready > 0) void this.deps.runAutoMail();
                this.deps.logger.info('auto-expedition', 'Completed expedition payout checked', {
                    ready: payout.value.ready,
                    opened: payout.value.opened,
                    failed: payout.value.failed.length,
                });
                for (const failure of payout.value.failed) {
                    this.deps.logger.warn('auto-expedition', 'Expedition payout failed', { expeditionId: failure.expeditionId, message: failure.message });
                }
                // Payment details are recorded for diagnostics and the hidden
                // easter egg, but never rendered as a loot list.
                const payoutSummary = payout.value.payouts.map((entry) => ({
                    expeditionId: entry.expeditionId,
                    opened: entry.opened,
                    riskScore: entry.riskScore,
                    outcome: entry.outcome,
                    completedAt: entry.completedAt,
                    items: entry.items.map((item) => ({ name: item.name, quantity: item.quantity })),
                    error: entry.error,
                }));
                if (payoutSummary.length > 0) {
                    await this.deps.state.set(EXPEDITION_PAYOUT_STATE_KEY, {
                        phase: 'done',
                        payload: { at: this.deps.clock.now(), payouts: payoutSummary },
                    });
                    this.deps.logger.debug('auto-expedition', 'Expedition payout recorded', { payouts: payoutSummary });
                }
                if (current.mysteryEggEnabled) {
                    const eggPayout = payout.value.payouts.find(isMysteryEggPayout);
                    if (eggPayout) {
                        this.state.last = {
                            at: this.deps.clock.now(),
                            decisions,
                            launched: false,
                            error: null,
                            paid,
                            message: 'Mystery egg triggered',
                        };
                        await this.deps.state.set(MYSTERY_EGG_STATE_KEY, {
                            phase: 'done',
                            payload: {
                                egg: {
                                    expeditionId: eggPayout.expeditionId,
                                    triggeredAt: this.deps.clock.now(),
                                    riskScore: eggPayout.riskScore,
                                },
                            },
                        });
                        await this.deps.state.set('auto-expedition', {
                            phase: 'idle',
                            runId: null,
                            nextActionAt: null,
                            lastError: null,
                            payload: { last: this.state.last },
                        });
                        this.deps.logger.info('auto-expedition', 'Mystery egg triggered', {
                            expeditionId: eggPayout.expeditionId,
                            riskScore: eggPayout.riskScore,
                            outcome: eggPayout.outcome,
                            items: eggPayout.items.map((item) => item.name),
                        });
                        await this.disable('mystery egg triggered');
                        this.deps.events.publish('expeditions.auto.done', this.state.last);
                        return;
                    }
                }
                const creditFailure = payout.value.failed.find((entry) => /insufficient|credit|not-enough/i.test(entry.message));
                if (creditFailure) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: creditFailure.message,
                        paid,
                        message: 'Payment failed: insufficient credits',
                    };
                    await this.disable('reward payment failed with insufficient credits');
                    return;
                }
                if (payout.value.ready > payout.value.opened) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: payout.value.failed[0]?.message ?? 'Completed expedition could not be paid',
                        paid,
                        message: 'Completed expedition is still waiting for payment; launch postponed',
                    };
                    await this.deps.state.set('auto-expedition', {
                        phase: 'waiting',
                        nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS,
                        lastError: this.state.last.error,
                        payload: { last: this.state.last },
                    });
                    this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS });
                    return;
                }
            }

            const overview = await readWithRetry(() => this.deps.service.overview(home.marketId, { includeMercenaries: false, includeConfig: false }), 3);
            if (!overview.ok) {
                this.state.last = {
                    at: this.deps.clock.now(),
                    decisions,
                    launched: false,
                    error: overview.error.message,
                    paid,
                    message: 'Could not verify active expeditions; waiting before launching',
                };
                await this.deps.state.set('auto-expedition', {
                    phase: 'waiting',
                    nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS,
                    lastError: overview.error.message,
                });
                this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
                return;
            }
            this.state.lastViewAt = this.deps.clock.now();
            const decisionHandling = await this.handleDecisionState(home.marketId, overview.value.decisions, current);
            if (decisionHandling.waiting) return;
            decisions = decisionHandling.responded;
            const active = [...overview.value.active, ...overview.value.archived].filter((entry) => {
                const status = entry.status.toUpperCase();
                return !isExpeditionReady(entry) && !status.includes('FAILED') && !status.includes('EXPIRED');
            });
            // A pending decision always belongs to an in-progress expedition. If the
            // active list is temporarily empty or an entry was dropped by schema
            // validation, this still prevents a duplicate launch.
            const decisionActiveIds = overview.value.decisions
                .map((decision) => decision.expeditionId)
                .filter((id): id is string => id.length > 0);
            if (active.length === 0 && decisionActiveIds.length === 0) this.state.lastDecision = null;
            if (active.length > 0 || decisionActiveIds.length > 0) {
                this.state.last = {
                    at: this.deps.clock.now(),
                    decisions,
                    launched: false,
                    error: null,
                    paid,
                    message: active.length > 0
                        ? `${active.length} expedition(s) still active`
                        : 'An expedition is waiting for a decision',
                };
                await this.deps.state.set('auto-expedition', {
                    phase: 'running',
                    nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS,
                    payload: {
                        activeIds: [...new Set([...active.map((entry) => entry.id), ...decisionActiveIds])],
                        last: this.state.last,
                        ...(this.state.lastDecision ? { decision: this.state.lastDecision } : {}),
                    },
                });
                this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS });
                return;
            }

            if (current.mercMinCreditsEnabled) {
                const credits = await this.readHomeCredits(home.marketId);
                if (credits === null) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: 'Could not read current credits',
                        paid,
                        message: 'Could not read credits; launch postponed',
                    };
                    await this.deps.state.set('auto-expedition', {
                        phase: 'waiting',
                        nextActionAt: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS,
                        lastError: this.state.last.error,
                        payload: { last: this.state.last },
                    });
                    this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
                    return;
                }
                this.deps.logger.info('auto-expedition', 'Credits checked before launch', {
                    credits,
                    threshold: current.mercMinCredits,
                    enabled: true,
                });
                if (credits < current.mercMinCredits) {
                    this.state.last = {
                        at: this.deps.clock.now(),
                        decisions,
                        launched: false,
                        error: `Credits ${credits.toLocaleString()} below threshold ${current.mercMinCredits.toLocaleString()}`,
                        paid,
                        message: 'Auto Expedition disabled: credits below threshold',
                    };
                    await this.disable('credits below threshold');
                    this.deps.events.publish('expeditions.auto.done', this.state.last);
                    return;
                }
            }

            const candidates = [];
            const candidateMarkets = [home, usol].filter((market): market is JobMarketDefinition => Boolean(market));
            for (const market of candidateMarkets) {
                const profile = MERC_EXPEDITION_PROFILES[mercProfileKeyForMarket(market.key)];
                const routed = await this.deps.routing.routeToServer(market.routeServerId, 'auto-expedition', `merc:candidates:${market.key}`);
                if (!routed.ok) {
                    this.deps.logger.warn('auto-expedition', `Could not route to ${market.label} for mercenaries`, { message: routed.error.message });
                    continue;
                }
                const locationsResult = await this.deps.service.locations(market.marketId);
                let marketLocations = locationsResult.ok ? locationsResult.value : [];
                if (marketLocations.length === 0) marketLocations = await this.deps.configCache.get(market.key) ?? [];
                if (!mercProfileMatchesLocations(profile, marketLocations)) {
                    this.deps.logger.warn('auto-expedition', `Static expedition profile does not match ${market.label} config; skipping market`, {
                        profile: profile.key,
                        locationConfigId: profile.locationConfigId,
                        zoneConfigId: profile.zoneConfigId,
                        goalId: profile.goalId,
                    });
                    continue;
                }
                try { await this.deps.configCache.set(market.key, marketLocations); } catch { /* cache is best effort */ }
                const result = await this.deps.service.candidates({
                    marketId: market.marketId,
                    marketKey: market.key === 'usol' ? 'usol' : 'core',
                    hasInsurance: current.mercInsuranceEnabled,
                    locations: marketLocations,
                    locationConfigId: profile.locationConfigId,
                    zoneConfigId: profile.zoneConfigId,
                    goalId: profile.goalId,
                });
                if (result.ok) candidates.push(...result.value);
                else this.deps.logger.warn('auto-expedition', `Mercenary fetch failed for ${market.label}`, { message: result.error.message });
            }

            const selected = selectMercenary(candidates, {
                mode: current.mercSelectionMode,
                marketOrder: current.mercMarketOrder,
                maxPrice: current.mercMaxPriceEnabled ? current.mercMaxPrice : null,
            });
            if (!selected) {
                this.state.last = {
                    at: this.deps.clock.now(),
                    decisions,
                    launched: false,
                    error: 'No available mercenary matches the selection rules',
                    paid,
                    message: 'No available mercenary matches the selection rules',
                };
                this.deps.logger.warn('auto-expedition', 'No available mercenary matches the selection rules', {
                    candidates: candidates.length,
                    maxPrice: current.mercMaxPriceEnabled ? current.mercMaxPrice : null,
                    mode: current.mercSelectionMode,
                    marketOrder: current.mercMarketOrder,
                    rejected: candidates.slice(0, 20).map((candidate) => ({
                        name: candidate.mercenary.name,
                        marketKey: candidate.marketKey,
                        status: candidate.mercenary.status,
                        totalCost: candidate.totalCost,
                        costEstimated: candidate.costEstimated === true,
                        riskScore: candidate.riskScore,
                        insurance: candidate.insurance,
                    })),
                });
                const restReadyAt = candidates
                    .map((candidate) => candidate.mercenary.restUntil)
                    .filter((value): value is string => typeof value === 'string')
                    .map((value) => Date.parse(value))
                    .filter((value) => Number.isFinite(value) && value > this.deps.clock.now())
                    .sort((left, right) => left - right)[0];
                if (restReadyAt === undefined) {
                    await this.disable('no available mercenary');
                    this.deps.events.publish('expeditions.auto.done', this.state.last);
                    return;
                }
                const retryAt = Math.max(this.deps.clock.now() + 5_000, restReadyAt + 5_000);
                await this.deps.state.set('auto-expedition', {
                    phase: 'waiting',
                    nextActionAt: retryAt,
                    lastError: this.state.last.error,
                    payload: { last: this.state.last },
                });
                this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: retryAt });
                return;
            }

            await launchExpedition({
                deps: this.deps,
                state: this.state,
                home,
                usol,
                current,
                decisions,
                paid,
                selected,
                scheduleMaintenanceRetry: (alarm) => this.scheduleMaintenanceRetry(alarm),
                disable: (reason) => this.disable(reason),
            });
        } finally {
            this.state.running = false;
            await this.deps.state.releaseLease('auto-expedition', owner);
            if (expeditionConnectionError(this.state.last?.error)) {
                this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
            }
        }
    }

    private async handleDecisionState(
        _marketId: string,
        decisions: readonly ExpeditionDecision[],
        current: SettingsV1,
    ): Promise<{ readonly waiting: boolean; readonly responded: number }> {
        const decision = decisions[0];
        if (!decision) return { waiting: false, responded: 0 };
        const now = this.deps.clock.now();
        const existing = this.state.lastDecision;
        const sameDecision = existing?.id === decision.id && existing.expeditionId === decision.expeditionId;
        const firstSeenAt = sameDecision ? existing!.firstSeenAt : now;
        const deadlineMs = decision.deadline ? Date.parse(decision.deadline) : Number.NaN;
        const autoEnabled = current.mercDecisionMode === 'score' || current.mercDecisionPolicy !== 'off';
        const autoRespondAt = autoEnabled
            ? Math.max(now, Number.isFinite(deadlineMs) ? Math.min(deadlineMs - 30_000, firstSeenAt + 30_000) : firstSeenAt + 30_000)
            : null;
        const next: ExpeditionDecisionState = {
            id: decision.id,
            expeditionId: decision.expeditionId,
            message: decision.message,
            riskScore: decision.riskScore,
            lootScore: decision.lootScore,
            deadline: decision.deadline,
            firstSeenAt,
            autoRespondAt,
            options: decision.options,
            mode: current.mercDecisionMode,
            policy: current.mercDecisionPolicy,
            lootWeight: current.mercDecisionScoreLoot,
            riskWeight: current.mercDecisionScoreRisk,
            chosenOptionId: sameDecision ? existing!.chosenOptionId : null,
            resolvedAt: sameDecision ? existing!.resolvedAt : null,
            resolvedBy: sameDecision ? existing!.resolvedBy : null,
        };
        this.state.lastDecision = next;
        if (!autoEnabled || next.chosenOptionId !== null) return { waiting: false, responded: 0 };
        if (now < (autoRespondAt ?? now)) {
            this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: autoRespondAt ?? now });
            await this.deps.state.set('auto-expedition', {
                phase: 'running',
                nextActionAt: autoRespondAt ?? now,
                payload: { last: this.state.last, decision: next },
            });
            this.deps.logger.info('auto-expedition', 'Decision waiting for manual window', {
                decisionId: decision.id,
                autoRespondAt,
                remainingMs: (autoRespondAt ?? now) - now,
            });
            return { waiting: true, responded: 0 };
        }
        const option = next.mode === 'score'
            ? chooseScoredDecisionOption(decision.options, decision.riskScore, { loot: next.lootWeight, risk: next.riskWeight })
            : chooseDecisionOption(decision.options, next.policy as DecisionPolicy);
        if (!option) return { waiting: false, responded: 0 };
        const result = await this.deps.service.respond(decision.expeditionId, decision.id, option.id);
        if (!result.ok) {
            this.deps.logger.warn('auto-expedition', 'Automatic decision response failed', {
                decisionId: decision.id,
                optionId: option.id,
                message: result.error.message,
            });
            this.deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: now + 30_000 });
            return { waiting: true, responded: 0 };
        }
        this.state.lastDecision = {
            ...next,
            chosenOptionId: option.id,
            resolvedAt: now,
            resolvedBy: 'auto',
            autoRespondAt: null,
        };
        await this.deps.state.set('auto-expedition', {
            phase: 'running',
            nextActionAt: null,
            payload: { last: this.state.last, decision: this.state.lastDecision },
        });
        this.deps.logger.info('auto-expedition', 'Expedition decision auto-resolved', {
            decisionId: decision.id,
            optionId: option.id,
            mode: next.mode,
        });
        return { waiting: false, responded: 1 };
    }

    private async readHomeCredits(marketId: string): Promise<number | null> {
        const cached = await this.deps.marketCache.get(marketId);
        if (cached) return cached.view.credits;
        const fresh = await this.deps.marketSync.fetchOptionsView(marketId);
        return fresh.ok ? fresh.value.credits : null;
    }

    private async scheduleMaintenanceRetry(alarmName: string): Promise<void> {
        const current = await this.deps.settings.get();
        if (!current.autoFinishEnabled) return;
        const snapshot = await this.deps.snapshots.get();
        if (!snapshot.ok) return;
        let earliest: number | null = null;
        for (const server of snapshot.value.servers.values()) {
            if (!server.maintenance.active || !server.maintenance.endsAt) continue;
            const endsAt = new Date(server.maintenance.endsAt).getTime();
            if (Number.isFinite(endsAt) && endsAt > this.deps.clock.now() && (earliest === null || endsAt < earliest)) earliest = endsAt;
        }
        if (earliest !== null) this.deps.scheduler.create(alarmName, { when: earliest + 30_000 });
    }

    private async disable(reason: string): Promise<void> {
        await this.deps.settings.update({ autoExpeditionEnabled: false });
        await this.deps.scheduler.clear(AUTO_EXPEDITION_ALARM);
        await this.deps.scheduler.clear(AUTO_EXPEDITION_RETRY_ALARM);
        this.deps.logger.warn('auto-expedition', `Auto Expedition disabled: ${reason}`);
    }
}
