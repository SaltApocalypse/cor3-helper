import { z } from 'zod';
import { mapSpecialistState } from '../../../application/specialists/map.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';

export interface SpecialistHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
}

const specialistPurchaseSchema = z.object({
    specialistType: z.string().min(1),
    kind: z.string().min(1),
    level: z.number().int().nonnegative(),
    priceId: z.string().min(1),
}).strict();

export function registerSpecialistHandlers(server: CoreRuntime['server'], deps: SpecialistHandlerDeps): void {
    const { core, game } = deps;
    server.register('specialists.view', z.object({}).strict(), async () => {
        const availability = await core.stores.featureAvailability.get();
        const raw = await game.specialistAdapter.getState();
        if (!raw.ok) {
            if (/locked|unlock|not.*unlocked|requires.*specialist/i.test(raw.error.message)) {
                await core.stores.featureAvailability.set({ stashExpansion: false });
                return ok({ expansions: [], offers: [], available: false });
            }
            return { ok: false, error: { code: raw.error.code, message: raw.error.message } };
        }
        const state = mapSpecialistState(raw.value);
        if (!state) {
            const keys = raw.value && typeof raw.value === 'object'
                ? Object.keys(raw.value as Record<string, unknown>).slice(0, 12)
                : [];
            // Log only the top-level keys, never the payload itself.
            core.logger.warn('specialists', 'Specialist payload failed schema validation', { keys });
            return { ok: false, error: { code: 'SPECIALIST_INVALID', message: 'Specialist payload failed schema validation' } };
        }
        const hasData = state.expansions.length > 0 || state.offers.length > 0;
        if (hasData && !availability.stashExpansion) await core.stores.featureAvailability.set({ stashExpansion: true });
        // A successful get.state means the service is reachable even if no
        // temporary offer is currently listed. Only the explicit locked error above
        // marks it unavailable.
        return ok({ ...state, available: true });
    });
    server.register('specialists.purchase', specialistPurchaseSchema, async (purchase) => {
        const result = await game.specialistAdapter.purchase(purchase);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
