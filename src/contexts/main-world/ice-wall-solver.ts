import type { MinigameResult } from './minigame-solver.js';
import {
    findIceCandidates,
    findIcePossiblePositions,
    selectIceCandidate,
    type IceCellData,
    type IceTargetOffset,
    type IceTargetPattern,
} from '../../domains/minigame/ice-wall.js';

type Orientation = 'up' | 'down';

interface IceCell extends IceCellData {
    readonly el: Element;
}

const COL_STEP = 31.5;
const ROW_STEP = 54;
const BOTTOM_LEFT_TARGET_LAYOUT = ['1,1,up', '2,0,up', '2,2,down', '3,1,down', '3,1,up', '4,0,up', '4,2,down', '5,1,down'].join('|');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function iceWallApp(): Element | null {
    return document.querySelector('[data-component-name="IceWallBreakApplication"], [data-sentry-component="IceWallBreakApplication"]');
}

function wallBoard(): Element | null {
    return document.querySelector('[data-component-name="WallBoard"]');
}

function targetPreview(): Element | null {
    return document.querySelector('[data-component-name="TargetPreview"]');
}

let lastStuckReportAt = 0;

function reportIceWallStuck(reason: string): void {
    const now = Date.now();
    if (now - lastStuckReportAt < 30_000) return;
    lastStuckReportAt = now;
    try {
        window.postMessage({ version: 2, type: 'V2_MINIGAME_STUCK', kind: 'ice-wall', reason }, '*');
    } catch {
        // The game page may be tearing down.
    }
}

function iceWallAwaitingSecureChannel(): boolean {
    const app = iceWallApp();
    if (!app) return false;
    const emptyStage = app.querySelector('[data-component-name="EmptyStage"]')
        ?? app.querySelector('[data-sentry-component="EmptyStage"]');
    if (!emptyStage) return false;
    return (emptyStage.textContent ?? '').includes('Awaiting secure channel');
}

function normalizeCoords(value: string): string {
    return value.replace(/-?\d+(\.\d+)?/g, (match) => String(Math.round(Number(match))));
}

function cellFingerprint(g: Element): string | null {
    if (g.querySelector('path[fill="#00121D"]')) return null;
    const parts: string[] = [];
    for (const el of g.children) {
        if (el.getAttribute('fill-opacity') === '0.2') continue;
        if (el.getAttribute('data-sentry-component') === 'GlyphBoundingTriangle') continue;
        if (el instanceof HTMLElement && el.style.opacity === '0') continue;
        if (el.tagName === 'path') {
            const d = el.getAttribute('d');
            if (d) parts.push(`p:${normalizeCoords(d)}`);
        } else if (el.tagName === 'rect') {
            parts.push(`r:${normalizeCoords([
                el.getAttribute('x') ?? '',
                el.getAttribute('y') ?? '',
                el.getAttribute('width') ?? '',
                el.getAttribute('height') ?? '',
                el.getAttribute('transform') ?? '',
            ].join(','))}`);
        }
    }
    return parts.length > 0 ? parts.join('|') : null;
}

function parseCellTransform(g: Element): { col: number; row: number; orientation: Orientation } | null {
    const transform = g.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(\s*([^,]+),\s*([^)]+)\)/);
    if (!match?.[1] || !match[2]) return null;
    return {
        col: Math.round(Number(match[1]) / COL_STEP),
        row: Math.round(Number(match[2]) / ROW_STEP),
        orientation: transform.includes('scale(1, -1)') || transform.includes('scale(1,-1)') ? 'down' : 'up',
    };
}

function buildCellMap(): Map<string, IceCell> {
    const map = new Map<string, IceCell>();
    for (const g of document.querySelectorAll('[data-component-name="WallBoard"] > g > g > g')) {
        const pos = parseCellTransform(g);
        if (!pos) continue;
        map.set(`${pos.col},${pos.row},${pos.orientation}`, {
            el: g,
            fingerprint: cellFingerprint(g),
            col: pos.col,
            row: pos.row,
            orientation: pos.orientation,
        });
    }
    return map;
}

function extractIceTargetPattern(): IceTargetPattern | null {
    const preview = targetPreview();
    if (!preview) return null;
    const cells: { pos: { col: number; row: number; orientation: Orientation }; fingerprint: string | null }[] = [];
    for (const child of preview.querySelectorAll(':scope > g')) {
        const pos = parseCellTransform(child);
        if (!pos) continue;
        cells.push({ pos, fingerprint: cellFingerprint(child) });
    }
    if (cells.length === 0) return null;
    const upCells = cells.filter((cell) => cell.pos.orientation === 'up');
    if (upCells.length === 0) return null;

    const viewBox = (preview.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
    const validViewBox = viewBox.length === 4 && viewBox.every((value) => Number.isFinite(value)) && (viewBox[2] ?? 0) > 0;
    const centerCol = validViewBox
        ? ((viewBox[0] ?? 0) + (viewBox[2] ?? 0) / 2 - COL_STEP) / COL_STEP
        : (Math.min(...cells.map((cell) => cell.pos.col)) + Math.max(...cells.map((cell) => cell.pos.col))) / 2;

    const layout = cells.map((cell) => `${cell.pos.col},${cell.pos.row},${cell.pos.orientation}`).sort().join('|');
    let anchor = layout === BOTTOM_LEFT_TARGET_LAYOUT
        ? upCells.find((cell) => cell.pos.col === 1 && cell.pos.row === 1)
        : undefined;
    if (!anchor) {
        anchor = upCells[0]!;
        for (const cell of upCells.slice(1)) {
            const lower = cell.pos.row > anchor.pos.row;
            const closer = cell.pos.row === anchor.pos.row
                && Math.abs(cell.pos.col - centerCol) < Math.abs(anchor.pos.col - centerCol);
            if (lower || closer) anchor = cell;
        }
    }

    const offsets: IceTargetOffset[] = [];
    for (const cell of cells) {
        if (cell === anchor) continue;
        offsets.push({
            dc: cell.pos.col - anchor.pos.col,
            dr: cell.pos.row - anchor.pos.row,
            orient: cell.pos.orientation,
            fingerprint: cell.fingerprint,
        });
    }
    return {
        anchorFingerprint: anchor.fingerprint,
        anchorCol: anchor.pos.col,
        anchorRow: anchor.pos.row,
        offsets,
    };
}

function clickAnchor(cell: IceCell): void {
    const target = cell.el.querySelector('[data-sentry-component="GlyphBoundingTriangle"]') ?? cell.el;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function roundSignature(): string {
    const counter = document.querySelector('[data-sentry-element="SidebarCounterStyled"] span');
    const preview = targetPreview();
    return `${counter?.textContent ?? ''}||${preview?.innerHTML.slice(0, 300) ?? ''}`;
}

function roundCounts(): { completed: number; total: number } | null {
    const counter = document.querySelector('[data-sentry-element="SidebarCounterStyled"]');
    if (!counter) return null;
    const spans = counter.querySelectorAll('span');
    if (spans.length < 2) return null;
    const completedMatch = (spans[0]?.textContent ?? '').match(/\d+/);
    const totalMatch = (spans[1]?.textContent ?? '').match(/\d+/);
    const completed = completedMatch?.[0] ? Number(completedMatch[0]) : NaN;
    const total = totalMatch?.[0] ? Number(totalMatch[0]) : NaN;
    return Number.isNaN(completed) || Number.isNaN(total) ? null : { completed, total };
}

async function waitForUniqueCandidate(
    pattern: IceTargetPattern,
    invalid: ReadonlySet<string>,
    isAborted: () => boolean,
    deadline: number,
): Promise<Map<string, IceCell> | null> {
    const started = Date.now();
    while (Date.now() - started < 45_000 && Date.now() < deadline) {
        if (isAborted()) return null;
        if (!wallBoard() || !iceWallApp()) return null;
        const cellMap = buildCellMap();
        const candidates = findIceCandidates(cellMap.values(), pattern, invalid);
        if (candidates.some((candidate) => candidate.isCompleteMatch) || candidates.length === 1) return cellMap;
        if (candidates.length === 0) {
            const possible = findIcePossiblePositions(cellMap.values(), pattern, invalid);
            if (possible.length === 1) return cellMap;
            if (possible.length === 0) return null;
        }
        await sleep(150);
    }
    if (Date.now() >= deadline) return null;
    const finalMap = buildCellMap();
    return findIcePossiblePositions(finalMap.values(), pattern, invalid).length <= 5 ? finalMap : null;
}

async function waitForAdvance(previousSignature: string): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < 1500) {
        if (!iceWallApp()) return true;
        if (roundSignature() !== previousSignature) return true;
        await sleep(100);
    }
    return false;
}

async function waitForNextRound(completedBefore: number, isAborted: () => boolean, deadline: number): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < 10_000 && Date.now() < deadline) {
        if (isAborted() || !iceWallApp()) return false;
        const counts = roundCounts();
        if (counts && Number.isFinite(counts.total) && counts.completed >= counts.total) return false;
        if (counts && counts.completed > completedBefore && extractIceTargetPattern()) return true;
        await sleep(150);
    }
    return false;
}

async function runRound(pattern: IceTargetPattern, isAborted: () => boolean, deadline: number): Promise<boolean> {
    const invalid = new Set<string>();
    let current = pattern;
    for (let falsePositives = 0; falsePositives < 8; falsePositives++) {
        if (isAborted() || !iceWallApp() || Date.now() >= deadline) return false;
        const cellMap = await waitForUniqueCandidate(current, invalid, isAborted, deadline);
        if (!cellMap) return false;
        const candidates = findIceCandidates(cellMap.values(), current, invalid);
        const possible = findIcePossiblePositions(cellMap.values(), current, invalid);
        let best: { col: number; row: number } | null = selectIceCandidate(candidates, possible);
        if (!best) return false;
        if (!best) return false;
        const anchor = cellMap.get(`${best.col},${best.row},up`);
        const previous = roundSignature();
        if (anchor) clickAnchor(anchor);
        if (await waitForAdvance(previous)) return true;
        invalid.add(`${best.col},${best.row}`);
        current = extractIceTargetPattern() ?? current;
        await sleep(200);
    }
    return false;
}

export async function solveIceWall(isAborted: () => boolean, deadline = Number.POSITIVE_INFINITY): Promise<MinigameResult> {
    if (!iceWallApp()) return { kind: 'ice-wall', solved: false, message: 'ICE Wall app not found' };
    let roundsCompleted = 0;
    let total = roundCounts()?.total ?? null;
    let stuckSince: number | null = null;
    let loadingSince: number | null = null;
    while (!isAborted() && iceWallApp() && roundsCompleted < 20 && Date.now() < deadline) {
        const now = Date.now();
        if (iceWallAwaitingSecureChannel()) {
            stuckSince ??= now;
            if (now - stuckSince >= 10_000) {
                reportIceWallStuck('awaiting secure channel');
                return { kind: 'ice-wall', solved: false, message: 'ICE Wall stuck on Awaiting secure channel' };
            }
        } else {
            stuckSince = null;
        }
        if (!wallBoard()) {
            loadingSince ??= now;
            if (now - loadingSince >= 20_000) {
                reportIceWallStuck('wall board did not render');
                return { kind: 'ice-wall', solved: false, message: 'ICE Wall board did not render' };
            }
        } else {
            loadingSince = null;
        }
        const counts = roundCounts();
        if (counts && Number.isFinite(counts.total)) total = counts.total;
        if (total !== null && roundsCompleted >= total) break;
        const pattern = extractIceTargetPattern();
        if (!pattern) {
            await sleep(100);
            continue;
        }
        const before = counts?.completed ?? roundsCompleted;
        const advanced = await runRound(pattern, isAborted, deadline);
        if (!advanced) break;
        roundsCompleted++;
        if (total !== null && roundsCompleted >= total) break;
        if (!(await waitForNextRound(before, isAborted, deadline))) break;
    }
    // Fail closed when the round counter is unavailable. Returning success
    // after the first layer is exactly what leaves a 3-layer ICE Wall open and
    // triggers the server's 20-minute minigame lock.
    const solved = total !== null && roundsCompleted >= total;
    return {
        kind: 'ice-wall',
        solved,
        ...(!solved
            ? {
                message: roundsCompleted === 0
                    ? 'No ICE Wall round completed'
                    : `ICE Wall incomplete (${roundsCompleted}/${total ?? '?'} rounds)`,
            }
            : {}),
    };
}
