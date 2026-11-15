import { jobMarketByKey, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { selectMercenary } from '../../../domains/expeditions/selection.js';
import { MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket, mercProfileMatchesLocations } from '../../../domains/expeditions/profiles.js';
import { isExpeditionReady } from '../../../domains/expeditions/model.js';
import { AUTO_EXPEDITION_ALARM, AUTO_EXPEDITION_RETRY_ALARM } from './alarm-ids.js';
import { readWithRetry } from './delay.js';
import { launchExpedition } from './expedition-launch.js';
import type { AutoExpeditionDeps, ExpeditionRunState } from './expedition-types.js';

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
            if (!current.mercAutoSelectEnabled) {
                this.state.last = {
                    at: this.deps.clock.now(),
                    decisions: 0,
                    launched: false,
                    error: 'Auto select mercenary is disabled',
                    message: 'Enable automatic mercenary selection before starting Auto Expedition.',
                };
                await this.disable('automatic mercenary selection is disabled');
                return;
            }
            this.deps.logger.info('auto-expedition', 'Auto Expedition run started', {
                autoSelect: current.mercAutoSelectEnabled,
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
            if (current.mercDecisionPolicy !== 'off') {
                const responded = await this.deps.service.autoRespond(home.marketId, current.mercDecisionPolicy);
                if (!responded.ok) {
                    this.state.last = { at: this.deps.clock.now(), decisions: 0, launched: false, error: responded.error.message };
                    if (/maintenance|unreachable|no route|ROUTE_FAILED/i.test(responded.error.message)) {
                        await this.scheduleMaintenanceRetry(AUTO_EXPEDITION_RETRY_ALARM);
                    }
                    return;
                }
                decisions = responded.value;
                this.deps.logger.info('auto-expedition', 'Expedition decisions processed', { responded: decisions });
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
                this.deps.logger.warn('auto-expedition', 'No available mercenary matches the selection rules', { candidates: candidates.length });
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
