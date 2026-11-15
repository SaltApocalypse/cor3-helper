import type { InventoryStash } from '../../domains/inventory/model.js';
import type { MailAttachment } from '../../domains/mail/model.js';

export interface AttachmentPlacement {
    readonly attachmentId: string;
    readonly x: number;
    readonly y: number;
    readonly rotated: boolean;
}

function buildOccupancy(stash: InventoryStash): { grid: boolean[][]; width: number; height: number } {
    const width = Number(stash.gridWidth) || 12;
    const height = Number(stash.usableRows) || 60;
    const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => false));
    for (const item of stash.items) {
        if (item.location && item.location !== 'stash') continue;
        const x = Number(item.x) || 0;
        const y = Number(item.y) || 0;
        const w = Number(item.width) || 1;
        const h = Number(item.height) || 1;
        for (let yy = y; yy < y + h; yy++) {
            for (let xx = x; xx < x + w; xx++) {
                if (grid[yy]?.[xx] !== undefined) grid[yy]![xx] = true;
            }
        }
    }
    return { grid, width, height };
}

function findFree(grid: boolean[][], gw: number, gh: number, w: number, h: number, canRotate: boolean): { x: number; y: number; rotated: boolean } | null {
    const scan = (width: number, height: number, rotated: boolean): { x: number; y: number; rotated: boolean } | null => {
        for (let y = 0; y <= gh - height; y++) {
            for (let x = 0; x <= gw - width; x++) {
                let free = true;
                for (let yy = y; yy < y + height && free; yy++) {
                    for (let xx = x; xx < x + width; xx++) {
                        if (grid[yy]?.[xx]) { free = false; break; }
                    }
                }
                if (free) return { x, y, rotated };
            }
        }
        return null;
    };
    return scan(w, h, false) ?? (canRotate ? scan(h, w, true) : null);
}

export function planAttachmentPlacements(stash: InventoryStash, attachments: readonly MailAttachment[]): AttachmentPlacement[] | null {
    const occupancy = buildOccupancy(stash);
    const placements: AttachmentPlacement[] = [];
    for (const attachment of attachments) {
        const position = findFree(occupancy.grid, occupancy.width, occupancy.height, attachment.width, attachment.height, attachment.canRotate);
        if (!position) return null;
        const w = position.rotated ? attachment.height : attachment.width;
        const h = position.rotated ? attachment.width : attachment.height;
        for (let yy = position.y; yy < position.y + h; yy++) {
            for (let xx = position.x; xx < position.x + w; xx++) {
                if (occupancy.grid[yy]?.[xx] !== undefined) occupancy.grid[yy]![xx] = true;
            }
        }
        placements.push({ attachmentId: attachment.id, x: position.x, y: position.y, rotated: position.rotated });
    }
    return placements;
}
