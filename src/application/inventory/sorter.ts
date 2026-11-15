import type { Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import { err, ok } from '../../kernel/result.js';
import { planInventorySort, type InventoryMove, type InventoryStash } from '../../domains/inventory/model.js';

export interface InventoryRuntimePort {
    getStash(): Promise<Result<InventoryStash, { readonly code: string; readonly message: string }>>;
    moveItem(move: InventoryMove): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    sellItem(itemId: string, quantity: number): Promise<Result<void, { readonly code: string; readonly message: string }>>;
}

export interface InventorySortProgress {
    readonly done: number;
    readonly total: number;
    readonly currentItemId: string | null;
}

export interface InventorySortSummary {
    readonly mode: 'smart' | 'compact';
    readonly moves: number;
    readonly fallback: boolean;
    readonly notice: string | null;
}

export type InventorySortError = { readonly code: string; readonly message: string };


export class InventorySortService {
    constructor(
        private readonly runtime: InventoryRuntimePort,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly moveGapMs = 0,
    ) {}

    async sort(
        mode: 'smart' | 'compact',
        onProgress?: (progress: InventorySortProgress) => void,
    ): Promise<Result<InventorySortSummary, InventorySortError>> {
        const stash = await this.runtime.getStash();
        if (!stash.ok) return err(stash.error);
        const plan = planInventorySort(stash.value, mode);
        if (!plan.ok) {
            return err({
                code: plan.reason.includes('sorting table') ? 'SORTING_TABLE_NOT_EMPTY' : 'LAYOUT_INFEASIBLE',
                message: plan.reason,
            });
        }
        const total = plan.moves.length;
        const staged = new Set<string>();
        for (let index = 0; index < total; index++) {
            const move = plan.moves[index]!;
            onProgress?.({ done: index, total, currentItemId: move.itemId });
            const moved = await this.runtime.moveItem(move);
            if (!moved.ok) {
                const rollbackErrors: string[] = [];
                for (const entry of plan.stagedEver) {
                    if (!staged.has(entry.id)) continue;
                    const rollback = await this.runtime.moveItem({
                        itemId: entry.id,
                        location: 'stash',
                        x: entry.original.x,
                        y: entry.original.y,
                        rotated: entry.original.rotated,
                    });
                    if (!rollback.ok) rollbackErrors.push(`${entry.id}: ${rollback.error.message}`);
                }
                return err({
                    code: 'MOVE_FAILED',
                    message: rollbackErrors.length > 0
                        ? `${moved.error.message}; rollback failed for ${rollbackErrors.join(', ')}`
                        : moved.error.message,
                });
            }
            if (move.location === 'sorting_table') staged.add(move.itemId);
            else staged.delete(move.itemId);
            if (index < total - 1 && this.moveGapMs > 0) await this.sleep(this.moveGapMs);
        }
        onProgress?.({ done: total, total, currentItemId: null });
        return ok({
            mode: plan.mode,
            moves: total,
            fallback: plan.fallback,
            notice: plan.notice,
        });
    }
}
