import type { SettingsV1 } from '../../../contracts/storage.js';
import type { JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { selectMercenary } from '../../../domains/expeditions/selection.js';
import { MERC_EXPEDITION_PROFILES, mercProfileKeyForMarket } from '../../../domains/expeditions/profiles.js';
import { totalCostInfo } from '../../../application/expeditions/service.js';
import { isExpeditionReady } from '../../../domains/expeditions/model.js';
import { AUTO_EXPEDITION_RETRY_ALARM } from './alarm-ids.js';
import { humanDelay, readWithRetry } from './delay.js';
import type { AutoExpeditionDeps, AutoExpeditionLast, ExpeditionPreparation, ExpeditionRunState } from './expedition-types.js';

const AUTO_EXPEDITION_CONNECTION_RETRY_MS = 30_000;
const AUTO_EXPEDITION_ACTIVE_RETRY_MS = 60_000;

type SelectedMercenary = NonNullable<ReturnType<typeof selectMercenary>>;

export interface ExpeditionLaunchContext {
    readonly deps: AutoExpeditionDeps;
    readonly state: ExpeditionRunState;
    readonly home: JobMarketDefinition;
    readonly usol: JobMarketDefinition | undefined;
    readonly current: SettingsV1;
    readonly decisions: number;
    readonly paid: number;
    readonly selected: SelectedMercenary;
    scheduleMaintenanceRetry(alarm: string): Promise<void>;
    disable(reason: string): Promise<void>;
}

async function waitForPreparation(state: ExpeditionRunState, preparation: ExpeditionPreparation, timeoutMs: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (state.preparationCancelled) return true;
        if (state.preparation?.id !== preparation.id) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return state.preparationCancelled;
}

/** Candidate selection through the irreversible launch step for one Auto Expedition cycle. */
export async function launchExpedition(ctx: ExpeditionLaunchContext): Promise<void> {
    const { deps, state, home, usol, current, decisions, paid, selected } = ctx;
    const profileKey = mercProfileKeyForMarket(selected.marketKey);
    const profile = MERC_EXPEDITION_PROFILES[profileKey];
    const selectedMarket = profileKey === 'core' ? home : usol;
    if (!selectedMarket) {
        state.last = { at: deps.clock.now(), decisions, launched: false, error: 'USOL market is not configured', paid, marketKey: profileKey };
        return;
    }
    const routed = await deps.routing.routeToServer(selectedMarket.routeServerId, 'auto-expedition', 'merc:launch');
    if (!routed.ok) {
        state.last = { at: deps.clock.now(), decisions, launched: false, error: routed.error.message, paid, marketKey: profileKey };
        if (/maintenance|unreachable|no route|ROUTE_FAILED/i.test(routed.error.message)) {
            await ctx.scheduleMaintenanceRetry(AUTO_EXPEDITION_RETRY_ALARM);
        }
        return;
    }
    const config = {
        mercenaryId: selected.mercenary.id,
        marketId: selectedMarket.marketId,
        locationConfigId: profile.locationConfigId,
        zoneConfigId: profile.zoneConfigId,
        goalId: profile.goalId,
        hasInsurance: selected.insurance,
    };
    const preparation: ExpeditionPreparation = {
        id: `expedition-prep-${deps.clock.now()}`,
        startedAt: deps.clock.now(),
        until: deps.clock.now() + 30_000,
        mercenaryName: selected.mercenary.name,
        marketKey: profileKey,
        marketLabel: profile.marketLabel,
        totalCost: selected.totalCost,
        riskScore: selected.riskScore,
        insurance: selected.insurance,
        locationName: profile.locationName,
    };
    state.preparation = preparation;
    state.preparationCancelled = false;
    await deps.state.set('auto-expedition', {
        phase: 'preparing',
        runId: preparation.id,
        startedAt: preparation.startedAt,
        nextActionAt: preparation.until,
        payload: {
            mercenaryName: preparation.mercenaryName,
            marketKey: preparation.marketKey,
            marketLabel: preparation.marketLabel,
            totalCost: preparation.totalCost,
            riskScore: preparation.riskScore,
            insurance: preparation.insurance,
            locationName: preparation.locationName,
            last: state.last,
        },
    });
    deps.events.publish('expeditions.auto.preparing', preparation);
    deps.logger.info('auto-expedition', 'Expedition preparation started', {
        mercenary: preparation.mercenaryName,
        market: preparation.marketLabel,
        cost: preparation.totalCost,
        risk: preparation.riskScore,
        until: preparation.until,
    });
    const cancelled = await waitForPreparation(state, preparation, 30_000);
    state.preparation = null;
    deps.events.publish('expeditions.auto.preparing', null);
    if (cancelled) {
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: 'Preparation cancelled',
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
            message: 'Expedition preparation cancelled',
        };
        await deps.state.set('auto-expedition', {
            phase: 'idle',
            runId: null,
            nextActionAt: null,
            lastError: null,
        });
        deps.events.publish('expeditions.auto.done', state.last);
        return;
    }
    if (!(await deps.settings.get()).autoExpeditionEnabled) {
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: 'Auto Expedition was disabled during preparation',
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
        };
        await deps.state.set('auto-expedition', { phase: 'idle', runId: null, nextActionAt: null });
        return;
    }
    // Reconcile once more right before the irreversible launch. A stale
    // empty active list must never cause a second expedition while another
    // one is already running.
    const activeCheck = await readWithRetry(() => deps.service.overview(home.marketId, { includeMercenaries: false, includeConfig: false }), 2);
    if (!activeCheck.ok) {
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: activeCheck.error.message,
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
            message: 'Could not verify active expeditions before launch',
        };
        await deps.state.set('auto-expedition', {
            phase: 'waiting',
            nextActionAt: deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS,
            lastError: activeCheck.error.message,
            payload: { last: state.last },
        });
        deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: deps.clock.now() + AUTO_EXPEDITION_CONNECTION_RETRY_MS });
        deps.events.publish('expeditions.auto.done', state.last);
        return;
    }
    state.lastViewAt = deps.clock.now();
    const stillActive = [...activeCheck.value.active, ...activeCheck.value.archived].filter((entry) => {
        const status = entry.status.toUpperCase();
        return !isExpeditionReady(entry) && !status.includes('FAILED') && !status.includes('EXPIRED');
    });
    const stillDecisionActive = activeCheck.value.decisions.length > 0;
    if (stillActive.length > 0 || stillDecisionActive) {
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: null,
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
            message: stillActive.length > 0
                ? `${stillActive.length} expedition(s) already active; launch cancelled`
                : 'An expedition is waiting for a decision; launch cancelled',
        };
        await deps.state.set('auto-expedition', {
            phase: 'running',
            nextActionAt: deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS,
            payload: {
                activeIds: stillActive.map((entry) => entry.id),
                last: state.last,
            },
        });
        deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS });
        deps.events.publish('expeditions.auto.done', state.last);
        return;
    }
    await humanDelay(300, 600);
    const configured = await deps.service.configure(config);
    if (!configured.ok) {
        state.last = { at: deps.clock.now(), decisions, launched: false, error: configured.error.message, paid, selectedMerc: selected.mercenary.name, marketKey: profileKey };
        deps.logger.warn('auto-expedition', 'Expedition configure failed', { mercenary: selected.mercenary.name, message: configured.error.message });
        return;
    }
    const configuredCost = totalCostInfo(configured.value);
    const verifiedTotalCost = configuredCost.explicit
        ? configuredCost.total
        : (selected.costEstimated ? null : selected.totalCost);
    const finalTotalCost = verifiedTotalCost ?? selected.totalCost;
    const maxPrice = current.mercMaxPriceEnabled ? current.mercMaxPrice : null;
    if (maxPrice !== null && (verifiedTotalCost === null || verifiedTotalCost > maxPrice)) {
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: verifiedTotalCost === null
                ? 'Configured expedition total cost is unavailable'
                : `Configured expedition total cost ${verifiedTotalCost} exceeds max ${maxPrice}`,
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
            message: 'Expedition not launched: configured total cost does not satisfy the price cap',
        };
        deps.logger.warn('auto-expedition', 'Expedition launch blocked by configured total cost', {
            mercenary: selected.mercenary.name,
            configuredTotalCost: configuredCost.total,
            configuredTotalExplicit: configuredCost.explicit,
            selectedTotalCost: selected.totalCost,
            maxPrice,
        });
        return;
    }
    await humanDelay(500, 900);
    const launched = await deps.service.launch(config);
    if (!launched.ok) {
        const creditFailure = /insufficient|credit|not-enough/i.test(launched.error.message);
        state.last = {
            at: deps.clock.now(),
            decisions,
            launched: false,
            error: launched.error.message,
            paid,
            selectedMerc: selected.mercenary.name,
            marketKey: profileKey,
        };
        deps.logger.warn('auto-expedition', 'Expedition launch failed', { mercenary: selected.mercenary.name, message: launched.error.message });
        if (creditFailure) await ctx.disable('expedition launch failed with insufficient credits');
        else if (/maintenance|unreachable|no route|ROUTE_FAILED/i.test(launched.error.message)) {
            await ctx.scheduleMaintenanceRetry(AUTO_EXPEDITION_RETRY_ALARM);
        }
        return;
    }
    const launchedLast: AutoExpeditionLast = {
        at: deps.clock.now(),
        decisions,
        launched: true,
        error: null,
        paid,
        selectedMerc: selected.mercenary.name,
        marketKey: profileKey,
        message: `Launched with ${selected.mercenary.name} (${profile.marketLabel})`,
    };
    state.last = launchedLast;
    deps.logger.info('auto-expedition', 'Mercenary expedition launched', {
        mercenary: selected.mercenary.name,
        market: selectedMarket.label,
        cost: finalTotalCost,
        insurance: selected.insurance,
        decisions,
        paid,
    });
    await deps.state.set('auto-expedition', {
        phase: 'running',
        nextActionAt: deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS,
        payload: {
            launchedAt: deps.clock.now(),
            mercenaryId: selected.mercenary.id,
            mercenaryName: selected.mercenary.name,
            marketKey: selectedMarket.key,
            last: launchedLast,
        },
    });
    deps.scheduler.create(AUTO_EXPEDITION_RETRY_ALARM, { when: deps.clock.now() + AUTO_EXPEDITION_ACTIVE_RETRY_MS });
    deps.events.publish('expeditions.auto.done', launchedLast);
}
