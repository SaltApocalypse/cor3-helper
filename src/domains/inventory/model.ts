export type InventoryTier = 'QUEST' | 'LEGENDARY' | 'EPIC' | 'SUPERRARE' | 'RARE' | 'COMMON' | string;

export interface InventoryItem {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly rotated?: boolean | undefined;
    readonly canRotate?: boolean | undefined;
    readonly tier?: InventoryTier | undefined;
    readonly name?: string | undefined;
    readonly shortName?: string | undefined;
    readonly itemConfigId?: string | undefined;
    readonly x?: number | undefined;
    readonly y?: number | undefined;
    readonly location?: 'stash' | 'sorting_table' | string | undefined;
    readonly quantity?: number | undefined;
    readonly canSell?: boolean | undefined;
    readonly sellPrice?: number | undefined;
    readonly canCraft?: boolean | undefined;
    readonly canUse?: boolean | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly imageUrl?: string | undefined;
    readonly description?: string | undefined;
}

export interface InventoryStash {
    readonly gridWidth?: number | undefined;
    readonly usableRows?: number | undefined;
    readonly maxCapacity?: number | undefined;
    readonly currentUsage?: number | undefined;
    readonly sortingTable?: { readonly width?: number | undefined; readonly items?: readonly InventoryItem[] | undefined } | undefined;
    readonly rental?: { readonly status: string | null; readonly expiresAt: string | null; readonly gracePeriodEndAt: string | null } | undefined;
    readonly items: readonly InventoryItem[];
}

export interface InventoryPlacement {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly rotated: boolean;
}

export interface InventoryMove {
    readonly itemId: string;
    readonly location: 'stash' | 'sorting_table';
    readonly x: number;
    readonly y: number;
    readonly rotated: boolean;
}

export type InventoryLayoutResult =
    | { readonly ok: true; readonly items: readonly InventoryPlacement[]; readonly usedRows?: number }
    | { readonly ok: false; readonly reason: string; readonly requiredRows?: number };

export type InventorySortResult =
    | {
        readonly ok: true;
        readonly mode: 'smart' | 'compact';
        readonly moves: readonly InventoryMove[];
        readonly stagedEver: readonly { readonly id: string; readonly original: { readonly x: number; readonly y: number; readonly rotated: boolean } }[];
        readonly fallback: boolean;
        readonly notice: string | null;
    }
    | { readonly ok: false; readonly reason: string };

const RARITY_ORDER: Record<string, number> = {
    QUEST: 0,
    LEGENDARY: 1,
    EPIC: 2,
    SUPERRARE: 3,
    RARE: 4,
    COMMON: 5,
};

/** Highest tier that is safe to sell in bulk. Anything above RARE is protected. */
export const MAX_BULK_SELL_TIER: InventoryTier = 'RARE';

export function inventoryRarityRank(tier: InventoryTier | undefined): number {
    return RARITY_ORDER[String(tier ?? 'COMMON').toUpperCase()] ?? 6;
}

function rarityRank(tier: InventoryTier | undefined): number {
    return inventoryRarityRank(tier);
}

export type InventoryProtectedReason = 'craft' | 'high-tier' | 'not-sellable' | 'no-price';

export function inventorySellProtection(item: InventoryItem, allowCraft = false): InventoryProtectedReason | null {
    if (inventoryRarityRank(item.tier) < inventoryRarityRank(MAX_BULK_SELL_TIER)) return 'high-tier';
    if (item.canCraft === true && !allowCraft) return 'craft';
    if (item.canSell !== true) return 'not-sellable';
    if ((item.sellPrice ?? 0) <= 0) return 'no-price';
    return null;
}

function compareItems(a: InventoryItem, b: InventoryItem): number {
    const rarity = rarityRank(a.tier) - rarityRank(b.tier);
    if (rarity !== 0) return rarity;
    const nameA = String(a.name ?? a.shortName ?? '');
    const nameB = String(b.name ?? b.shortName ?? '');
    const byName = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
}

function baseDims(item: InventoryItem): { w: number; h: number } {
    let w = Math.max(1, Number(item.width) || 1);
    let h = Math.max(1, Number(item.height) || 1);
    if (item.rotated) [w, h] = [h, w];
    return { w, h };
}

function canonicalDims(item: InventoryItem, gridWidth: number): { w: number; h: number; rotated: boolean } | null {
    const base = baseDims(item);
    if (base.w <= gridWidth) return { w: base.w, h: base.h, rotated: false };
    if (item.canRotate && base.h <= gridWidth) return { w: base.h, h: base.w, rotated: true };
    return null;
}

function makeGrid(width: number, height: number): (string | null)[][] {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => null));
}

function canPlace(grid: (string | null)[][], x: number, y: number, w: number, h: number, gw: number, gh: number): boolean {
    if (x < 0 || y < 0 || x + w > gw || y + h > gh) return false;
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            if (grid[yy]?.[xx] !== null) return false;
        }
    }
    return true;
}

function place(grid: (string | null)[][], x: number, y: number, w: number, h: number, id: string): void {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            const row = grid[yy];
            if (row) row[xx] = id;
        }
    }
}

function clearRect(grid: (string | null)[][], x: number, y: number, w: number, h: number, id: string): void {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            const row = grid[yy];
            if (row?.[xx] === id) row[xx] = null;
        }
    }
}

export function layoutInventoryCompact(items: readonly InventoryItem[], gw: number, gh: number): InventoryLayoutResult {
    const grid = makeGrid(gw, gh);
    const result: InventoryPlacement[] = [];
    for (const item of [...items].sort(compareItems)) {
        const base = baseDims(item);
        let placement: InventoryPlacement | null = null;
        for (let y = 0; y <= gh - base.h && !placement; y++) {
            for (let x = 0; x <= gw - base.w; x++) {
                if (canPlace(grid, x, y, base.w, base.h, gw, gh)) {
                    placement = { id: item.id, x, y, w: base.w, h: base.h, rotated: false };
                    break;
                }
            }
        }
        if (!placement && item.canRotate && base.w !== base.h) {
            const rw = base.h;
            const rh = base.w;
            for (let y = 0; y <= gh - rh && !placement; y++) {
                for (let x = 0; x <= gw - rw; x++) {
                    if (canPlace(grid, x, y, rw, rh, gw, gh)) {
                        placement = { id: item.id, x, y, w: rw, h: rh, rotated: true };
                        break;
                    }
                }
            }
        }
        if (!placement) {
            return { ok: false, reason: `Not enough warehouse rows for the compact layout (item: ${item.name ?? item.id}).` };
        }
        place(grid, placement.x, placement.y, placement.w, placement.h, item.id);
        result.push(placement);
    }
    return { ok: true, items: result };
}

interface SmartGroup {
    readonly items: InventoryItem[];
    readonly w: number;
    readonly h: number;
    readonly rotated: boolean;
    readonly name: string;
    readonly key: string;
}

export function layoutInventorySmart(items: readonly InventoryItem[], gw: number, gh: number): InventoryLayoutResult {
    const byRarity = new Map<string, SmartGroup[]>();
    for (const item of items) {
        const dimensions = canonicalDims(item, gw);
        if (!dimensions) return { ok: false, reason: `Item "${item.name ?? item.id}" cannot fit in the warehouse grid.` };
        const tier = String(item.tier ?? 'COMMON').toUpperCase();
        const typeKey = item.itemConfigId ?? `${item.name ?? ''}|${tier}`;
        const key = `${typeKey}|${dimensions.w}x${dimensions.h}`;
        const groups = byRarity.get(tier) ?? [];
        let group = groups.find((entry) => entry.key === key);
        if (!group) {
            group = {
                items: [],
                w: dimensions.w,
                h: dimensions.h,
                rotated: dimensions.rotated,
                name: item.name ?? item.shortName ?? '',
                key,
            };
            groups.push(group);
            byRarity.set(tier, groups);
        }
        group.items.push(item);
    }

    const grid = makeGrid(gw, gh);
    const result: InventoryPlacement[] = [];
    const rarityKeys = [...byRarity.keys()].sort((a, b) => rarityRank(a) - rarityRank(b));
    let sectionStart = 0;
    for (const tier of rarityKeys) {
        const groups = byRarity.get(tier)!;
        // Tall groups anchor the rarity section; similar sizes are packed
        // together. Unlike the old shelf bands, shorter groups may fill the
        // empty space next to a taller neighbour, which saves rows.
        groups.sort((a, b) => b.h - a.h || b.w - a.w || compareItems(a.items[0]!, b.items[0]!));
        let sectionEnd = sectionStart;
        for (const group of groups) {
            group.items.sort(compareItems);
            for (const item of group.items) {
                let placement: { x: number; y: number } | null = null;
                for (let y = sectionStart; y <= gh - group.h && !placement; y++) {
                    for (let x = 0; x <= gw - group.w; x++) {
                        if (canPlace(grid, x, y, group.w, group.h, gw, gh)) {
                            placement = { x, y };
                            break;
                        }
                    }
                }
                if (!placement) {
                    return {
                        ok: false,
                        reason: `Not enough warehouse rows for the smart layout. Required more than ${gh} rows.`,
                        requiredRows: sectionEnd + group.h,
                    };
                }
                result.push({ id: item.id, x: placement.x, y: placement.y, w: group.w, h: group.h, rotated: group.rotated });
                place(grid, placement.x, placement.y, group.w, group.h, item.id);
                sectionEnd = Math.max(sectionEnd, placement.y + group.h);
            }
        }
        sectionStart = sectionEnd;
    }
    return { ok: true, items: result, usedRows: sectionStart };
}

interface CurrentPlacement {
    x: number;
    y: number;
    w: number;
    h: number;
    rotated: boolean;
    location: 'stash' | 'sorting_table';
}

export function computeInventoryMoves(
    stash: InventoryStash,
    layoutItems: readonly InventoryPlacement[],
): InventorySortResult {
    const gw = Number(stash.gridWidth) || 12;
    const gh = Number(stash.usableRows) || 60;
    const stWidth = Number(stash.sortingTable?.width) || 15;
    const items = stash.items.filter((item) => !!item.id && (!item.location || item.location === 'stash'));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const targetById = new Map(layoutItems.map((item) => [item.id, item]));
    const grid = makeGrid(gw, gh);
    const current = new Map<string, CurrentPlacement>();
    for (const item of items) {
        if (!targetById.has(item.id)) continue;
        const w = Number(item.width) || 1;
        const h = Number(item.height) || 1;
        const x = Number(item.x) || 0;
        const y = Number(item.y) || 0;
        current.set(item.id, { x, y, w, h, rotated: !!item.rotated, location: 'stash' });
        place(grid, x, y, w, h, item.id);
    }

    const placed = new Set<string>();
    for (const item of items) {
        const target = targetById.get(item.id);
        if (target && item.x === target.x && item.y === target.y && !!item.rotated === target.rotated) placed.add(item.id);
    }

    const staged = new Map<string, { target?: InventoryPlacement; original: { x: number; y: number; rotated: boolean } }>();
    const stagedEver = new Map<string, { id: string; original: { x: number; y: number; rotated: boolean } }>();
    const staging = { x: 0, y: 0, rowH: 0 };
    const moves: InventoryMove[] = [];

    const nextStagingPosition = (item: InventoryItem): { x: number; y: number; rotated: boolean } => {
        const base = baseDims(item);
        let w = base.w;
        let h = base.h;
        let rotated = false;
        if (w > stWidth && item.canRotate) {
            w = base.h;
            h = base.w;
            rotated = true;
        }
        if (w > stWidth) throw new Error(`Item "${item.name ?? item.id}" is too wide for the sorting table.`);
        if (staging.x + w > stWidth) {
            staging.y += staging.rowH;
            staging.x = 0;
            staging.rowH = 0;
        }
        const position = { x: staging.x, y: staging.y, rotated };
        staging.x += w;
        if (h > staging.rowH) staging.rowH = h;
        return position;
    };

    const stageBlockers = (target: InventoryPlacement, selfId: string): string | null => {
        const blockers = new Set<string>();
        for (let yy = target.y; yy < target.y + target.h; yy++) {
            for (let xx = target.x; xx < target.x + target.w; xx++) {
                const occupant = grid[yy]?.[xx] ?? null;
                if (occupant && occupant !== selfId) blockers.add(occupant);
            }
        }
        for (const blockerId of blockers) {
            if (placed.has(blockerId)) {
                const self = itemById.get(selfId);
                return `Layout conflict: a placed item blocks ${self?.name ?? selfId}.`;
            }
            if (staged.has(blockerId)) continue;
            const blocker = itemById.get(blockerId);
            if (!blocker) continue;
            const position = nextStagingPosition(blocker);
            moves.push({ itemId: blockerId, location: 'sorting_table', x: position.x, y: position.y, rotated: position.rotated });
            const placement = current.get(blockerId);
            if (placement) {
                clearRect(grid, placement.x, placement.y, placement.w, placement.h, blockerId);
                placement.location = 'sorting_table';
            }
            const original = { x: blocker.x ?? 0, y: blocker.y ?? 0, rotated: !!blocker.rotated };
            staged.set(blockerId, { ...(targetById.get(blockerId) ? { target: targetById.get(blockerId)! } : {}), original });
            stagedEver.set(blockerId, { id: blockerId, original });
        }
        return null;
    };

    for (const target of layoutItems) {
        const item = itemById.get(target.id);
        if (!item) continue;
        const isStaged = staged.has(item.id);
        if (!isStaged && placed.has(item.id)) continue;
        const stageError = stageBlockers(target, item.id);
        if (stageError) return { ok: false, reason: stageError };
        if (isStaged) staged.delete(item.id);
        const placement = current.get(item.id);
        if (placement?.location === 'stash') clearRect(grid, placement.x, placement.y, placement.w, placement.h, item.id);
        moves.push({ itemId: item.id, location: 'stash', x: target.x, y: target.y, rotated: target.rotated });
        place(grid, target.x, target.y, target.w, target.h, item.id);
        current.set(item.id, { x: target.x, y: target.y, w: target.w, h: target.h, rotated: target.rotated, location: 'stash' });
        placed.add(item.id);
    }

    for (const [id, entry] of [...staged.entries()]) {
        if (!entry.target) continue;
        moves.push({ itemId: id, location: 'stash', x: entry.target.x, y: entry.target.y, rotated: entry.target.rotated });
        staged.delete(id);
    }

    return {
        ok: true,
        mode: 'compact',
        moves,
        stagedEver: [...stagedEver.values()],
        fallback: false,
        notice: null,
    };
}

export function planInventorySort(stash: InventoryStash, requestedMode: 'smart' | 'compact'): InventorySortResult {
    if ((stash.sortingTable?.items?.length ?? 0) > 0) {
        return { ok: false, reason: 'The sorting table is not empty. Close the warehouse window to return those items first.' };
    }
    const gw = Number(stash.gridWidth) || 12;
    const gh = Number(stash.usableRows) || 60;
    const items = stash.items.filter((item) => !!item.id && (!item.location || item.location === 'stash'));
    if (items.length === 0) return { ok: false, reason: 'No items to sort.' };

    let layout: InventoryLayoutResult;
    let fallback = false;
    let notice: string | null = null;
    if (requestedMode === 'smart') {
        layout = layoutInventorySmart(items, gw, gh);
        if (!layout.ok) {
            const smartReason = layout.reason;
            const smartRows = 'requiredRows' in layout ? layout.requiredRows : undefined;
            const compact = layoutInventoryCompact(items, gw, gh);
            if (!compact.ok) {
                return {
                    ok: false,
                    reason: smartRows
                        ? `Smart layout needs at least ${smartRows} rows (max ${gh}), and the compact fallback also does not fit.`
                        : `${smartReason} The compact fallback also does not fit.`,
                };
            }
            layout = compact;
            fallback = true;
            notice = smartRows
                ? `Smart layout needs at least ${smartRows} rows (max ${gh}) — used Compact layout instead.`
                : `Smart layout could not fit (${smartReason}) — used Compact layout instead.`;
        }
    } else {
        layout = layoutInventoryCompact(items, gw, gh);
        if (!layout.ok) return { ok: false, reason: layout.reason };
    }

    const plan = computeInventoryMoves(stash, layout.items);
    if (!plan.ok) return plan;
    return {
        ...plan,
        mode: fallback ? 'compact' : requestedMode,
        fallback,
        notice,
    };
}


export interface InventoryFilterSell {
    readonly itemId: string;
    readonly name: string;
    readonly tier: string;
    readonly quantity: number;
    readonly sellValue: number;
}

export type InventoryBatchSellTag = 'any' | 'none' | 'craft';

export interface InventoryBatchSellProtected {
    readonly itemId: string;
    readonly name: string;
    readonly tier: string;
    readonly quantity: number;
    readonly sellValue: number;
    readonly reason: InventoryProtectedReason;
}

export interface InventoryBatchSellPlan {
    readonly eligible: readonly InventoryFilterSell[];
    readonly protected: readonly InventoryBatchSellProtected[];
    readonly eligibleValue: number;
    readonly protectedValue: number;
}

export interface InventoryBatchSellFilter {
    /** Empty means every tier. Tiers above RARE are still protected. */
    readonly tiers: readonly string[];
    readonly tag: InventoryBatchSellTag;
}

function batchTagMatches(item: InventoryItem, tag: InventoryBatchSellTag): boolean {
    if (tag === 'any') return true;
    if (tag === 'craft') return item.canCraft === true;
    return item.canCraft !== true;
}

/**
 * Builds a safe bulk-sale plan. Craftable items and anything rarer than RARE
 * are always filtered out and reported separately so the UI can ask the user
 * to sell those by hand. This protects valuable items even if the user picks a
 * broad tier filter.
 */
export function planInventoryBatchSell(stash: InventoryStash, filter: InventoryBatchSellFilter): InventoryBatchSellPlan {
    const tiers = new Set(filter.tiers.map((tier) => tier.toUpperCase()));
    const eligible: InventoryFilterSell[] = [];
    const protectedItems: InventoryBatchSellProtected[] = [];
    for (const item of stash.items) {
        if (item.location && item.location !== 'stash') continue;
        const tier = String(item.tier ?? 'COMMON').toUpperCase();
        if (tiers.size > 0 && !tiers.has(tier)) continue;
        if (!batchTagMatches(item, filter.tag)) continue;
        const quantity = item.quantity ?? 1;
        const value = (item.sellPrice ?? 0) * quantity;
        const reason = inventorySellProtection(item, filter.tag === 'craft');
        if (reason !== null) {
            protectedItems.push({
                itemId: item.id,
                name: item.name ?? item.id,
                tier,
                quantity,
                sellValue: value,
                reason,
            });
            continue;
        }
        eligible.push({ itemId: item.id, name: item.name ?? item.id, tier, quantity, sellValue: value });
    }
    return {
        eligible,
        protected: protectedItems,
        eligibleValue: eligible.reduce((sum, entry) => sum + entry.sellValue, 0),
        protectedValue: protectedItems.reduce((sum, entry) => sum + entry.sellValue, 0),
    };
}
