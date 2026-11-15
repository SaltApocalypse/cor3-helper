import { describe, expect, it } from 'vitest';
import {
    findIceCandidates,
    iceRequiredMatches,
    findIcePossiblePositions,
    isIceWallLockedIn,
    selectIceCandidate,
    type IceCellData,
    type IceTargetPattern,
} from './ice-wall.js';

const pattern: IceTargetPattern = {
    anchorFingerprint: 'A',
    anchorCol: 0,
    anchorRow: 0,
    offsets: [
        { dc: 1, dr: 0, orient: 'up', fingerprint: 'B' },
        { dc: 0, dr: 1, orient: 'down', fingerprint: 'C' },
    ],
};

function cell(col: number, row: number, fingerprint: string | null, orientation: 'up' | 'down' = 'up'): IceCellData {
    return { col, row, orientation, fingerprint };
}

describe('ICE Wall pure solver', () => {
    it('finds a complete target match', () => {
        const candidates = findIceCandidates([
            cell(5, 5, 'A'),
            cell(6, 5, 'B'),
            cell(5, 6, 'C', 'down'),
            cell(9, 9, 'A'),
        ], pattern);
        expect(candidates).toHaveLength(1);
        expect(candidates[0]).toMatchObject({ col: 5, row: 5, isCompleteMatch: true });
    });

    it('eliminates positions with definite mismatches', () => {
        const possible = findIcePossiblePositions([
            cell(5, 5, 'A'),
            cell(6, 5, 'X'),
            cell(5, 6, 'C', 'down'),
        ], pattern);
        expect(possible).toEqual([]);
    });

    it('keeps positions with unknown glyphs', () => {
        const possible = findIcePossiblePositions([
            cell(5, 5, 'A'),
            cell(6, 5, null),
            cell(5, 6, null, 'down'),
        ], pattern);
        expect(possible).toEqual([{ col: 5, row: 5 }]);
    });

    it('honours invalid positions and selects the best candidate', () => {
        const cells = [
            cell(5, 5, 'A'),
            cell(6, 5, 'B'),
            cell(5, 6, 'C', 'down'),
        ];
        expect(findIceCandidates(cells, pattern, new Set(['5,5']))).toEqual([]);
        const candidates = findIceCandidates(cells, pattern);
        expect(selectIceCandidate(candidates, [])).toMatchObject({ col: 5, row: 5 });
        expect(isIceWallLockedIn(candidates, [])).toBe(true);
    });

    it('locks in via elimination when there are no full candidates', () => {
        const possible = findIcePossiblePositions([
            cell(5, 5, 'A'),
            cell(6, 5, null),
            cell(5, 6, null, 'down'),
            cell(20, 20, 'A'),
            cell(21, 20, 'Z'),
        ], pattern);
        expect(possible).toEqual([{ col: 5, row: 5 }]);
        expect(isIceWallLockedIn([], possible)).toBe(true);
    });
});

describe('ICE Wall guess threshold', () => {
    it('requires full confirmation for 1-3 cell shapes', () => {
        expect(iceRequiredMatches(1)).toBe(1);
        expect(iceRequiredMatches(2)).toBe(2);
        expect(iceRequiredMatches(3)).toBe(3);
    });

    it('uses 65% for 4-6 cell shapes', () => {
        expect(iceRequiredMatches(4)).toBe(3);
        expect(iceRequiredMatches(5)).toBe(3);
        expect(iceRequiredMatches(6)).toBe(4);
    });

    it('keeps the previous rule for larger shapes', () => {
        expect(iceRequiredMatches(7)).toBe(3);
        expect(iceRequiredMatches(9)).toBe(4);
        expect(iceRequiredMatches(12)).toBe(5);
    });

    it('no longer creates a candidate for a partially confirmed 3-cell shape', () => {
        const partial: IceTargetPattern = {
            anchorFingerprint: 'A',
            anchorCol: 0,
            anchorRow: 0,
            offsets: [
                { dc: 1, dr: 0, orient: 'up', fingerprint: 'B' },
                { dc: 0, dr: 1, orient: 'down', fingerprint: 'C' },
            ],
        };
        expect(findIceCandidates([
            cell(5, 5, 'A'),
            cell(6, 5, 'B'),
            cell(5, 6, null, 'down'),
        ], partial)).toEqual([]);
    });
});
