import type { InventoryRuntimePort } from '../../application/inventory/sorter.js';
import type { InventoryMove, InventoryStash } from '../../domains/inventory/model.js';
import type { GameError } from '../../application/game/ports.js';
import { rawInventoryStashSchema } from '../../contracts/inventory.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';
import { unwrapTabResult } from './tab-response.js';

export class ChromeTabInventoryAdapter implements InventoryRuntimePort {
    constructor(private readonly tabs: TabMessagePort) {}

    async getStash(): Promise<Result<InventoryStash, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_STASH_GET' });
            const unwrapped = unwrapTabResult(response, { code: 'STASH_FAILED', message: 'Stash command failed' });
            if (!unwrapped.ok) return unwrapped;
            const candidate = unwrapped.value && typeof unwrapped.value === 'object'
                ? (unwrapped.value as { stash?: unknown }).stash ?? unwrapped.value
                : unwrapped.value;
            const parsed = rawInventoryStashSchema.safeParse(candidate);
            if (!parsed.success) return err({ code: 'STASH_INVALID', message: 'Stash data failed schema validation' });
            return ok({
                ...(parsed.data.gridWidth !== undefined ? { gridWidth: parsed.data.gridWidth } : {}),
                ...(parsed.data.usableRows !== undefined ? { usableRows: parsed.data.usableRows } : {}),
                ...(parsed.data.maxCapacity !== undefined ? { maxCapacity: parsed.data.maxCapacity } : {}),
                ...(parsed.data.currentUsage !== undefined ? { currentUsage: parsed.data.currentUsage } : {}),
                ...(parsed.data.sortingTable ? {
                    sortingTable: {
                        ...(parsed.data.sortingTable.width !== undefined ? { width: parsed.data.sortingTable.width } : {}),
                        ...(parsed.data.sortingTable.items ? { items: parsed.data.sortingTable.items.map(mapItem) } : {}),
                    },
                } : {}),
                ...(parsed.data.rental ? {
                    rental: {
                        status: parsed.data.rental.status ?? null,
                        expiresAt: parsed.data.rental.expiresAt ?? null,
                        gracePeriodEndAt: parsed.data.rental.gracePeriodEndAt ?? null,
                    },
                } : {}),
                items: parsed.data.items.map(mapItem),
            });
        } catch (error) {
            return err({ code: 'STASH_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    async sellItem(itemId: string, quantity: number): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const result = unwrapTabResult(await this.tabs.send(tabId, { type: 'V2_STASH_SELL', itemId, quantity }), { code: 'STASH_SELL_FAILED', message: 'Stash sell failed' });
            return result.ok ? ok(undefined) : result;
        } catch (error) {
            return err({ code: 'STASH_SELL_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    async moveItem(move: InventoryMove): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const result = unwrapTabResult(await this.tabs.send(tabId, { type: 'V2_STASH_MOVE', ...move }), { code: 'STASH_MOVE_FAILED', message: 'Stash move failed' });
            return result.ok ? ok(undefined) : result;
        } catch (error) {
            return err({ code: 'STASH_MOVE_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}



function mapItem(item: {
    readonly id: string;
    readonly width?: number | undefined;
    readonly height?: number | undefined;
    readonly rotated?: boolean | undefined;
    readonly canRotate?: boolean | undefined;
    readonly tier?: string | undefined;
    readonly name?: string | undefined;
    readonly shortName?: string | undefined;
    readonly itemConfigId?: string | undefined;
    readonly x?: number | undefined;
    readonly y?: number | undefined;
    readonly location?: string | undefined;
    readonly quantity?: number | undefined;
    readonly canSell?: boolean | undefined;
    readonly sellPrice?: number | undefined;
    readonly canCraft?: boolean | undefined;
    readonly canUse?: boolean | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly imageUrl?: string | undefined;
    readonly description?: string | undefined;
}): import('../../domains/inventory/model.js').InventoryItem {
    return {
        id: item.id,
        width: item.width ?? 1,
        height: item.height ?? 1,
        ...(item.rotated !== undefined ? { rotated: item.rotated } : {}),
        ...(item.canRotate !== undefined ? { canRotate: item.canRotate } : {}),
        ...(item.tier !== undefined ? { tier: item.tier } : {}),
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.shortName !== undefined ? { shortName: item.shortName } : {}),
        ...(item.itemConfigId !== undefined ? { itemConfigId: item.itemConfigId } : {}),
        ...(item.x !== undefined ? { x: item.x } : {}),
        ...(item.y !== undefined ? { y: item.y } : {}),
        ...(item.location !== undefined ? { location: item.location } : {}),
        ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
        ...(item.canSell !== undefined ? { canSell: item.canSell } : {}),
        ...(item.sellPrice !== undefined ? { sellPrice: item.sellPrice } : {}),
        ...(item.canCraft !== undefined ? { canCraft: item.canCraft } : {}),
        ...(item.canUse !== undefined ? { canUse: item.canUse } : {}),
        ...(item.tags !== undefined ? { tags: item.tags } : {}),
        ...(item.imageUrl !== undefined ? { imageUrl: item.imageUrl } : {}),
        ...(item.description !== undefined ? { description: item.description } : {}),
    };
}
