export type IceOrientation = 'up' | 'down';

export interface IceCellData {
    readonly col: number;
    readonly row: number;
    readonly orientation: IceOrientation;
    readonly fingerprint: string | null;
}

export interface IceTargetOffset {
    readonly dc: number;
    readonly dr: number;
    readonly orient: IceOrientation;
    readonly fingerprint: string | null;
}

export interface IceTargetPattern {
    readonly anchorFingerprint: string | null;
    readonly anchorCol: number;
    readonly anchorRow: number;
    readonly offsets: readonly IceTargetOffset[];
}

export interface IceCandidate {
    readonly col: number;
    readonly row: number;
    readonly matches: number;
    readonly isCompleteMatch: boolean;
}

export interface IcePosition {
    readonly col: number;
    readonly row: number;
}

function key(col: number, row: number, orientation: IceOrientation): string {
    return `${col},${row},${orientation}`;
}

/**
 * How many confirmed glyphs are required before a candidate may be clicked.
 *
 * Small shapes reveal quickly, so requiring every cell is safer than guessing
 * on an ambiguous partial match. Larger shapes keep the previous fractional
 * rule where one unknown cell is still tolerated.
 */
export function iceRequiredMatches(totalCells: number): number {
    if (totalCells <= 0) return 0;
    if (totalCells <= 3) return totalCells;
    if (totalCells <= 6) return Math.max(1, Math.round(totalCells * 0.65));
    return Math.max(2, Math.ceil(totalCells / 2.4));
}

/**
 * Finds anchor positions whose visible glyphs match the target pattern.
 * Unknown (null) fingerprints are treated as "not contradicted" rather than as
 * matches, matching the game's gradual reveal behaviour.
 */
export function findIceCandidates(
    cells: Iterable<IceCellData>,
    pattern: IceTargetPattern,
    invalid: ReadonlySet<string> = new Set(),
): IceCandidate[] {
    const totalCells = 1 + pattern.offsets.length;
    const minMatches = iceRequiredMatches(totalCells);
    const list = [...cells];
    const byPosition = new Map<string, IceCellData>();
    for (const cell of list) byPosition.set(key(cell.col, cell.row, cell.orientation), cell);
    const candidates: IceCandidate[] = [];
    for (const cell of list) {
        if (cell.orientation !== 'up' || invalid.has(`${cell.col},${cell.row}`)) continue;
        let matches = 0;
        let mismatches = 0;
        if (cell.fingerprint !== null && pattern.anchorFingerprint !== null) {
            if (cell.fingerprint === pattern.anchorFingerprint) matches++;
            else mismatches++;
        }
        for (const offset of pattern.offsets) {
            const offsetCell = byPosition.get(key(cell.col + offset.dc, cell.row + offset.dr, offset.orient));
            if (!offsetCell) {
                mismatches++;
                continue;
            }
            if (offsetCell.fingerprint === null || offset.fingerprint === null) continue;
            if (offsetCell.fingerprint === offset.fingerprint) matches++;
            else mismatches++;
        }
        if (mismatches === 0 && matches >= minMatches) {
            candidates.push({ col: cell.col, row: cell.row, matches, isCompleteMatch: matches === totalCells });
        }
    }
    return candidates.sort((left, right) => right.matches - left.matches);
}

/**
 * Elimination view: positions that have no definite mismatch and no missing
 * neighbour. This can lock in an answer before every glyph is revealed.
 */
export function findIcePossiblePositions(
    cells: Iterable<IceCellData>,
    pattern: IceTargetPattern,
    invalid: ReadonlySet<string> = new Set(),
): IcePosition[] {
    const list = [...cells];
    const byPosition = new Map<string, IceCellData>();
    for (const cell of list) byPosition.set(key(cell.col, cell.row, cell.orientation), cell);
    const possible: IcePosition[] = [];
    for (const cell of list) {
        if (cell.orientation !== 'up' || invalid.has(`${cell.col},${cell.row}`)) continue;
        let impossible = false;
        if (cell.fingerprint !== null && pattern.anchorFingerprint !== null && cell.fingerprint !== pattern.anchorFingerprint) {
            impossible = true;
        }
        if (!impossible) {
            for (const offset of pattern.offsets) {
                const offsetCell = byPosition.get(key(cell.col + offset.dc, cell.row + offset.dr, offset.orient));
                if (!offsetCell) {
                    impossible = true;
                    break;
                }
                if (offsetCell.fingerprint === null || offset.fingerprint === null) continue;
                if (offsetCell.fingerprint !== offset.fingerprint) {
                    impossible = true;
                    break;
                }
            }
        }
        if (!impossible) possible.push({ col: cell.col, row: cell.row });
    }
    return possible;
}

export function selectIceCandidate(candidates: readonly IceCandidate[], possible: readonly IcePosition[]): IcePosition | null {
    return candidates.find((candidate) => candidate.isCompleteMatch)
        ?? candidates[0]
        ?? possible[0]
        ?? null;
}

export function isIceWallLockedIn(candidates: readonly IceCandidate[], possible: readonly IcePosition[]): boolean {
    return candidates.some((candidate) => candidate.isCompleteMatch)
        || candidates.length === 1
        || (candidates.length === 0 && possible.length === 1);
}
