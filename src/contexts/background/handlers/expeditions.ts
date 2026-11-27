import { z } from 'zod';
import { JOB_MARKETS, jobMarketByKey } from '../../../domains/jobs/markets.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';
import { readWithRetry } from '../automation/delay.js';

export interface ExpeditionHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

const expeditionViewSchema = z.object({
    marketId: z.string().min(1).optional(),
}).strict();

function homeMarketId(requested?: string): string | undefined {
    return requested ?? JOB_MARKETS.find((market) => market.key === 'home')?.marketId;
}

export function registerExpeditionHandlers(server: CoreRuntime['server'], deps: ExpeditionHandlerDeps): void {
    const { core, game, automation } = deps;
    server.register('expeditions.view', expeditionViewSchema, async (request) => {
        const marketId = homeMarketId(request.marketId);
        if (!marketId) return { ok: false, error: { code: 'MARKET_MISSING', message: 'Home market is not configured' } };
        const market = JOB_MARKETS.find((entry) => entry.marketId === marketId) ?? jobMarketByKey('home');
        const marketKey = market?.key ?? 'home';
        if (market && !automation.autoJobs.isRunning() && !automation.autoFinish.isRunning() && !automation.expedition.isRunning()) {
            await automation.routing.routeToServer(market.routeServerId, 'expedition-view', `config:${marketKey}`);
        }
        const result = await readWithRetry(() => game.expeditionService.overview(marketId, { includeConfig: false }), 3);
        if (result.ok) {
            const overview = result.value;
            const hasAnyData = overview.mercenaries.length > 0
                || overview.active.length > 0
                || overview.archived.length > 0;
            automation.expedition.markViewSeen();
            core.logger.info('expedition', 'Expedition view loaded', {
                active: overview.active.length,
                archived: overview.archived.length,
                decisions: overview.decisions.length,
                mercenaries: overview.mercenaries.length,
                locations: overview.locations.length,
            });
            await core.stores.featureAvailability.set({ mercenaryExpedition: hasAnyData });
            await automation.expedition.clearMysteryEggIfExpeditionStarted(overview.active);
            return ok(overview);
        }
        core.logger.warn('expedition', 'Expedition view failed', { code: result.error.code, message: result.error.message });
        if (/locked|unlock|not.*available|not.*unlocked/i.test(result.error.message)) {
            await core.stores.featureAvailability.set({ mercenaryExpedition: false });
        }
        return { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('expeditions.configure', z.object({
        mercenaryId: z.string().min(1),
        locationConfigId: z.string().min(1),
        zoneConfigId: z.string().min(1),
        goalId: z.string().min(1),
        hasInsurance: z.boolean().default(false),
    }).strict(), async (config) => {
        const result = await game.expeditionService.configure(config);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('expeditions.autoRespond', z.object({ marketId: z.string().min(1).optional() }).strict(), async ({ marketId }) => {
        const resolved = homeMarketId(marketId);
        if (!resolved) return { ok: false, error: { code: 'MARKET_MISSING', message: 'Home market is not configured' } };
        const result = await game.expeditionService.autoRespond(resolved);
        return result.ok ? ok({ responded: result.value }) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('expeditions.claimRewards', z.object({ marketId: z.string().min(1).optional() }).strict(), async ({ marketId }) => {
        const resolved = homeMarketId(marketId);
        if (!resolved) return { ok: false, error: { code: 'MARKET_MISSING', message: 'Home market is not configured' } };
        const ready = await game.expeditionService.readyExpeditions(resolved);
        if (!ready.ok) return { ok: false, error: { code: ready.error.code, message: ready.error.message } };
        let opened = 0;
        let claimed = 0;
        const failed: { expeditionId: string; message: string }[] = [];
        for (const expedition of ready.value) {
            const container = await game.expeditionService.openContainer(expedition.id);
            if (!container.ok) {
                failed.push({ expeditionId: expedition.id, message: container.error.message });
                continue;
            }
            opened++;
            const mail = await game.mailService.claimForSource('EXPEDITION', expedition.id);
            if (mail.ok) claimed += mail.value.claimed;
        }
        return ok({ ready: ready.value.length, opened, claimed, failed });
    });
    server.register('expeditions.autoSend', z.object({ marketId: z.string().min(1).optional() }).strict(), async ({ marketId }) => {
        const resolved = homeMarketId(marketId);
        if (!resolved) return { ok: false, error: { code: 'MARKET_MISSING', message: 'Home market is not configured' } };
        const decisions = await game.expeditionService.autoRespond(resolved);
        if (!decisions.ok) return { ok: false, error: { code: decisions.error.code, message: decisions.error.message } };
        const launch = await game.expeditionService.autoLaunch(resolved);
        if (!launch.ok) return { ok: false, error: { code: launch.error.code, message: launch.error.message } };
        return ok({ decisions: decisions.value, launched: launch.value !== null });
    });
    server.register('expeditions.autoLaunch', z.object({ marketId: z.string().min(1).optional() }).strict(), async ({ marketId }) => {
        const resolved = homeMarketId(marketId);
        if (!resolved) return { ok: false, error: { code: 'MARKET_MISSING', message: 'Home market is not configured' } };
        const result = await game.expeditionService.autoLaunch(resolved);
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('expeditions.respond', z.object({
        expeditionId: z.string().min(1),
        messageId: z.string().min(1),
        optionId: z.string().min(1),
    }).strict(), async ({ expeditionId, messageId, optionId }) => {
        const result = await automation.expedition.respondDecision(expeditionId, messageId, optionId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('expeditions.autoStatus', z.object({}).strict(), async () => {
        const availability = await core.stores.featureAvailability.get();
        const status = await automation.expedition.status();
        return ok({ ...status, available: availability.mercenaryExpedition });
    });
    server.register('expeditions.autoEnable', z.object({ intervalMinutes: z.number().int().min(5).max(1440).optional() }).strict(), async ({ intervalMinutes }) => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        const result = await automation.expedition.enable(intervalMinutes);
        return result.ok ? ok(result.value) : result;
    });
    server.register('expeditions.autoDisable', z.object({}).strict(), async () => {
        return ok(await automation.expedition.disable());
    });
    server.register('expeditions.autoRun', z.object({}).strict(), async () => {
        await automation.expedition.run();
        return ok(automation.expedition.lastRun());
    });
    server.register('expeditions.autoCancel', z.object({}).strict(), async () => {
        automation.expedition.cancelPreparation();
        return ok(undefined);
    });
}
