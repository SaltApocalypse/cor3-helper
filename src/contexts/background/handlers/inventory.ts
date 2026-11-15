import { z } from 'zod';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';
import { readWithRetry } from '../automation/delay.js';

export interface InventoryHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

function mapInventoryItemView(item: import('../../../domains/inventory/model.js').InventoryItem) {
    return {
        id: item.id,
        name: item.name ?? item.id,
        tier: item.tier ?? 'UNKNOWN',
        quantity: item.quantity ?? 1,
        sellPrice: item.sellPrice ?? 0,
        canSell: item.canSell === true,
        canCraft: item.canCraft === true,
        canUse: item.canUse === true,
        tags: item.tags ?? [],
        width: item.width,
        height: item.height,
        x: item.x ?? null,
        y: item.y ?? null,
        itemConfigId: item.itemConfigId ?? null,
        imageUrl: item.imageUrl ?? null,
        description: item.description ?? null,
    };
}

const inventoryBatchSellSchema = z.object({
    tiers: z.array(z.string().min(1)).max(8).default([]),
    tag: z.enum(['any', 'none', 'craft']).default('any'),
}).strict();

const inventorySortSchema = z.object({ mode: z.enum(['smart', 'compact']).default('smart') }).strict();

export function registerInventoryHandlers(server: CoreRuntime['server'], deps: InventoryHandlerDeps): void {
    const { core, game, automation } = deps;
    server.register('inventory.view', z.object({}).strict(), async () => {
        const stash = await readWithRetry(() => game.inventoryAdapter.getStash(), 3);
        if (!stash.ok) return { ok: false, error: { code: stash.error.code, message: stash.error.message } };
        return ok({
            summary: {
                items: stash.value.items.length,
                gridWidth: stash.value.gridWidth ?? null,
                usableRows: stash.value.usableRows ?? null,
                maxCapacity: stash.value.maxCapacity ?? null,
                currentUsage: stash.value.currentUsage ?? null,
                rental: stash.value.rental
                    ? {
                        status: stash.value.rental.status,
                        expiresAt: stash.value.rental.expiresAt,
                        gracePeriodEndAt: stash.value.rental.gracePeriodEndAt,
                    }
                    : null,
            },
            items: stash.value.items.map(mapInventoryItemView),
            sortingTableItems: stash.value.sortingTable?.items?.length ?? 0,
        });
    });
    server.register('inventory.previewFilter', inventoryBatchSellSchema, async ({ tiers, tag }) => {
        const result = await game.inventoryFilterSell.previewFilter(tiers, tag);
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('inventory.sellFilter', inventoryBatchSellSchema, async ({ tiers, tag }) => {
        const result = await game.inventoryFilterSell.sellByFilter(tiers, tag);
        if (!result.ok) {
            core.logger.warn('inventory', 'Filtered sell failed', { code: result.error.code, message: result.error.message, tiers, tag });
            return { ok: false, error: { code: result.error.code, message: result.error.message } };
        }
        core.logger.info('inventory', 'Filtered sell completed', {
            tiers,
            tag,
            soldStacks: result.value.soldStacks,
            soldQuantity: result.value.soldQuantity,
            sellValue: result.value.sellValue,
            protectedStacks: result.value.protectedStacks,
            failed: result.value.failed.length,
        });
        let mailClaimed = 0;
        if (result.value.soldStacks > 0) {
            const mail = await game.mailService.claimPending();
            if (mail.ok) mailClaimed = mail.value.claimed;
        }
        return ok({ ...result.value, mailClaimed });
    });
    server.register('inventory.sellItem', z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().positive().optional(),
    }).strict(), async ({ itemId, quantity }) => {
        const result = await game.inventoryItemSell.sell(itemId, quantity);
        if (!result.ok) {
            core.logger.warn('inventory', 'Single item sell rejected', { itemId, quantity, code: result.error.code, message: result.error.message });
            return { ok: false, error: { code: result.error.code, message: result.error.message } };
        }
        core.logger.info('inventory', 'Single item sold', result.value);
        return ok(result.value);
    });
    server.register('inventory.sort', inventorySortSchema, async ({ mode }) => {
        const result = await automation.inventoryLock.run(() => game.inventorySorter.sort(mode));
        if (result === null) return { ok: false, error: { code: 'SORT_BUSY', message: 'A warehouse sort is already running' } };
        return result.ok
            ? ok(result.value)
            : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
}
