import { describe, expect, it } from 'vitest';
import { InventorySortService } from './sorter.js';

describe('InventorySortService', () => {
    it('plans and applies moves', async () => {
        const moves: unknown[] = [];
        const progress: number[] = [];
        const service = new InventorySortService({
            getStash: async () => ({ ok: true, value: {
                gridWidth: 2,
                usableRows: 2,
                items: [
                    { id: 'a', width: 1, height: 1, x: 1, y: 1 },
                    { id: 'b', width: 1, height: 1, x: 0, y: 0 },
                ],
            } }),
            moveItem: async (move) => { moves.push(move); return { ok: true, value: undefined }; },
            sellItem: async () => ({ ok: true, value: undefined }),
        });
        const result = await service.sort('compact', (entry) => progress.push(entry.done));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.moves).toBeGreaterThan(0);
        expect(moves.length).toBeGreaterThan(0);
        expect(progress.at(-1)).toBeGreaterThan(0);
    });

    it('refuses to sort when the sorting table is occupied', async () => {
        const service = new InventorySortService({
            getStash: async () => ({ ok: true, value: {
                gridWidth: 4,
                usableRows: 4,
                sortingTable: { width: 5, items: [{ id: 'staged', width: 1, height: 1 }] },
                items: [{ id: 'a', width: 1, height: 1 }],
            } }),
            moveItem: async () => { throw new Error('should not move'); },
            sellItem: async () => ({ ok: true, value: undefined }),
        });
        const result = await service.sort('compact');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('SORTING_TABLE_NOT_EMPTY');
    });

    it('rolls staged items back when a move fails', async () => {
        const moves: unknown[] = [];
        let count = 0;
        const service = new InventorySortService({
            getStash: async () => ({ ok: true, value: {
                gridWidth: 2,
                usableRows: 2,
                items: [
                    { id: 'a', width: 1, height: 1, x: 1, y: 1 },
                    { id: 'b', width: 1, height: 1, x: 0, y: 0 },
                ],
            } }),
            sellItem: async () => ({ ok: true, value: undefined }),
            moveItem: async (move) => {
                moves.push(move);
                count++;
                if (count === 2) return { ok: false, error: { code: 'MOVE_FAILED', message: 'blocked' } };
                return { ok: true, value: undefined };
            },
        });
        const result = await service.sort('compact');
        expect(result.ok).toBe(false);
        expect(moves.some((move) => (move as { location?: string }).location === 'stash')).toBe(true);
    });

    it('returns a layout error without moving items', async () => {
        const service = new InventorySortService({
            getStash: async () => ({ ok: true, value: {
                gridWidth: 2,
                usableRows: 2,
                items: [{ id: 'wide', width: 5, height: 1 }],
            } }),
            moveItem: async () => { throw new Error('should not move'); },
            sellItem: async () => ({ ok: true, value: undefined }),
        });
        const result = await service.sort('compact');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('LAYOUT_INFEASIBLE');
    });
});
