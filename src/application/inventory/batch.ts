import type { Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import { err, ok } from '../../kernel/result.js';
import {
    inventorySellProtection,
    planInventoryBatchSell,
    type InventoryBatchSellPlan,
    type InventoryBatchSellTag,
} from '../../domains/inventory/model.js';
import type { InventoryRuntimePort } from './sorter.js';


export interface FilterSellSummary {
    readonly soldStacks: number;
    readonly soldQuantity: number;
    readonly sellValue: number;
    readonly protectedStacks: number;
    readonly protectedValue: number;
    readonly failed: readonly { readonly itemId: string; readonly message: string }[];
}

export interface FilterPreview {
    readonly stacks: number;
    readonly quantity: number;
    readonly value: number;
    readonly protectedStacks: number;
    readonly protectedQuantity: number;
    readonly protectedValue: number;
    readonly protected: InventoryBatchSellPlan['protected'];
}

export class InventoryFilterSellService {
    constructor(
        private readonly runtime: InventoryRuntimePort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly sellGapMs = 0,
        private readonly sellJitterMs = 0,
    ) {}

    async previewFilter(tiers: readonly string[], tag: InventoryBatchSellTag): Promise<Result<FilterPreview, { readonly code: string; readonly message: string }>> {
        const stash = await this.runtime.getStash();
        if (!stash.ok) return err(stash.error);
        const plan = planInventoryBatchSell(stash.value, { tiers, tag });
        return ok({
            stacks: plan.eligible.length,
            quantity: plan.eligible.reduce((sum, entry) => sum + entry.quantity, 0),
            value: plan.eligibleValue,
            protectedStacks: plan.protected.length,
            protectedQuantity: plan.protected.reduce((sum, entry) => sum + entry.quantity, 0),
            protectedValue: plan.protectedValue,
            protected: plan.protected,
        });
    }

    /**
     * Sells only items that pass the safe-sale plan. Craftable items and items
     * above RARE are never sent to the server, even when the tier filter
     * includes them.
     */
    async sellByFilter(tiers: readonly string[], tag: InventoryBatchSellTag): Promise<Result<FilterSellSummary, { readonly code: string; readonly message: string }>> {
        const stash = await this.runtime.getStash();
        if (!stash.ok) return err(stash.error);
        const plan = planInventoryBatchSell(stash.value, { tiers, tag });
        let soldStacks = 0;
        let soldQuantity = 0;
        let sellValue = 0;
        const failed: { itemId: string; message: string }[] = [];
        for (const [index, entry] of plan.eligible.entries()) {
            if (index > 0 && this.sellGapMs > 0) await this.sleep(this.sellGapMs + Math.floor(Math.random() * this.sellJitterMs));
            const result = await this.runtime.sellItem(entry.itemId, entry.quantity);
            if (result.ok) {
                soldStacks++;
                soldQuantity += entry.quantity;
                sellValue += entry.sellValue;
            } else {
                failed.push({ itemId: entry.itemId, message: result.error.message });
            }
        }
        return ok({
            soldStacks,
            soldQuantity,
            sellValue,
            protectedStacks: plan.protected.length,
            protectedValue: plan.protectedValue,
            failed,
        });
    }
}

export interface ItemSellSummary {
    readonly itemId: string;
    readonly name: string;
    readonly quantity: number;
    readonly sellValue: number;
}

/**
 * Sells a single stash stack. Protected items (craftable or above RARE) are
 * rejected here as well so a compromised/stale UI cannot bypass the rule.
 */
export class InventoryItemSellService {
    constructor(private readonly runtime: InventoryRuntimePort) {}

    async sell(itemId: string, requestedQuantity?: number): Promise<Result<ItemSellSummary, { readonly code: string; readonly message: string }>> {
        const stash = await this.runtime.getStash();
        if (!stash.ok) return err(stash.error);
        const item = stash.value.items.find((entry) => entry.id === itemId);
        if (!item) return err({ code: 'ITEM_NOT_FOUND', message: 'Item is no longer in the warehouse' });
        const reason = inventorySellProtection(item, true);
        if (reason === 'high-tier') {
            return err({ code: 'ITEM_PROTECTED_TIER', message: 'Items above RARE must be sold manually' });
        }
        if (reason === 'craft') {
            return err({ code: 'ITEM_PROTECTED_CRAFT', message: 'Craftable items must be sold manually' });
        }
        if (reason !== null) {
            return err({ code: 'ITEM_NOT_SELLABLE', message: 'This item cannot be sold' });
        }
        const quantity = Math.max(1, Math.min(requestedQuantity ?? item.quantity ?? 1, item.quantity ?? 1));
        const result = await this.runtime.sellItem(itemId, quantity);
        if (!result.ok) return err(result.error);
        return ok({
            itemId,
            name: item.name ?? itemId,
            quantity,
            sellValue: (item.sellPrice ?? 0) * quantity,
        });
    }
}
