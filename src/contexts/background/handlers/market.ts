import { z } from 'zod';
import type { MarketView } from '../../../domains/markets/model.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface MarketHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

export function registerMarketHandlers(server: CoreRuntime['server'], deps: MarketHandlerDeps): void {
    const { core, automation } = deps;
    const cache = core.stores.marketCache;
    server.register('market.options', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
        const result = await automation.markets.fetchOptionsView(marketId);
        if (!result.ok) return result;
        const cached = await cache.get(marketId);
        const view: MarketView = cached
            ? { ...cached.view, ...result.value }
            : { ...result.value, lots: [], jobs: [], recentJobs: [], nextJobsResetAt: null };
        await cache.set(marketId, view);
        core.events.publish('market.reputation.updated', { marketId, credits: result.value.credits, reputation: result.value.reputation });
        return ok(result.value);
    });
    server.register('market.cached', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
        return ok(await cache.get(marketId));
    });
}
