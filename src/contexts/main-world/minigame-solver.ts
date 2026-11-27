import { solveIceWall } from './ice-wall-solver.js';

export type MinigameKind = 'simple-decrypt' | 'config-hack' | 'ice-wall' | 'none';

export interface MinigameResult {
    readonly kind: MinigameKind;
    readonly solved: boolean;
    readonly message?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MinigameSession { abort: boolean; }
let activeSession: MinigameSession | null = null;
let lastStuckReportAt = 0;

function reportMinigameStuck(kind: string, reason: string): void {
    const now = Date.now();
    if (now - lastStuckReportAt < 30_000) return;
    lastStuckReportAt = now;
    try {
        window.postMessage({ version: 2, type: 'V2_MINIGAME_STUCK', kind, reason }, '*');
    } catch {
        // The game page may be tearing down.
    }
}

function simpleDecryptApp(): Element | null {
    return document.querySelector('[data-component-name="SimpleDecryptApplication"], [data-sentry-component="SimpleDecryptApplication"], [data-component-name="SimpleDecryptionApplication"], [data-sentry-component="SimpleDecryptionApplication"], [data-component-name="DecryptionApplication"], [data-sentry-component="DecryptionApplication"]');
}

function configHackApp(): Element | null {
    // The in-game window is named "Terminal Hack"; the internal kind stays
    // `config-hack` for compatibility with existing settings and bridge data.
    return document.querySelector('[data-sentry-component="ConfigHackApplication"], [data-component-name="ConfigHackApplication"]');
}

function iceWallApp(): Element | null {
    return document.querySelector('[data-component-name="IceWallBreakApplication"], [data-sentry-component="IceWallBreakApplication"], [data-component-name="WallBoard"], [data-sentry-component="WallBoard"]');
}

function decryptButton(): HTMLElement | null {
    return document.querySelector('[data-sentry-element="DecryptButtonStyled"], button.go1966296074');
}

function progressPercent(): number | null {
    const label = document.querySelector('[data-sentry-element="FooterCenterLabelStyled"]');
    if (!label) return null;
    const match = (label.textContent ?? '').match(/(\d+)\s*%/);
    return match?.[1] ? Number(match[1]) : null;
}

async function solveSimpleDecrypt(session: MinigameSession, deadline: number): Promise<MinigameResult> {
    await sleep(500);
    if (session.abort) return { kind: 'simple-decrypt', solved: false, message: 'aborted' };
    let button = decryptButton();
    const buttonWaitStarted = Date.now();
    while (!button && Date.now() - buttonWaitStarted < 10_000 && Date.now() < deadline) {
        if (session.abort) return { kind: 'simple-decrypt', solved: false, message: 'aborted' };
        await sleep(250);
        button = decryptButton();
    }
    if (!button) {
        reportMinigameStuck('simple-decrypt', 'decrypt button did not render');
        return { kind: 'simple-decrypt', solved: false, message: 'decrypt button not found' };
    }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const started = Date.now();
    while (Date.now() - started < 120_000 && Date.now() < deadline) {
        if (session.abort) return { kind: 'simple-decrypt', solved: false, message: 'aborted' };
        if (!simpleDecryptApp()) return { kind: 'simple-decrypt', solved: true };
        if ((progressPercent() ?? 0) >= 100) {
            await sleep(2000);
            return { kind: 'simple-decrypt', solved: true };
        }
        await sleep(500);
    }
    return { kind: 'simple-decrypt', solved: false, message: session.abort ? 'aborted' : 'timed out' };
}

function dispatchKey(element: Element, key: string, keyCode: number, count = 1): void {
    for (let index = 0; index < count; index++) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
            element.dispatchEvent(new KeyboardEvent(type, {
                key,
                code: key,
                keyCode,
                charCode: type === 'keypress' ? keyCode : 0,
                bubbles: true,
                cancelable: true,
            }));
        }
    }
}

function currentFieldValues(): string[] {
    const buttons = [...document.querySelectorAll('[data-sentry-component="ParameterCells"] button[type="button"]')]
        .filter((button) => button.getAttribute('data-sentry-element') !== 'SendButtonStyled');
    return buttons.map((button) => {
        const spans = button.querySelectorAll('span');
        return spans.length >= 2 ? (spans[1]?.textContent ?? '').trim() : '';
    });
}

function logLines(): string[] {
    const container = document.querySelector('[data-sentry-element="LogContentStyled"][data-sentry-source-file="config-hack-application.tsx"]');
    return [...(container?.querySelectorAll('div') ?? [])]
        .map((entry) => (entry.textContent ?? '').trim())
        .filter((line) => line.length > 0);
}

function detectFields(lines: readonly string[]): string[][] {
    const fields: string[][] = [];
    for (const line of lines) {
        const match = line.match(/→\s*(.+)/);
        if (match?.[1]) fields.push(match[1].split('/').map((value) => value.trim()));
    }
    return fields;
}

function buildCombo(indices: readonly number[], fields: readonly string[][]): string {
    return indices.map((value, field) => fields[field]?.[value] ?? '').join(' ');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function submitGuess(fields: readonly string[][], indices: readonly number[]): Promise<boolean> {
    const container = configHackApp();
    if (!container) return false;
    (container as HTMLElement).focus();
    await sleep(1);
    dispatchKey(container, 'ArrowLeft', 37, fields.length);
    await sleep(1);
    for (let field = 0; field < fields.length; field++) {
        if (field > 0) {
            dispatchKey(container, 'ArrowRight', 39);
            await sleep(1);
        }
        const values = currentFieldValues();
        const current = values[field] ?? '';
        const options = fields[field] ?? [];
        const target = indices[field] ?? 0;
        const currentIndex = options.indexOf(current);
        if (currentIndex === target) continue;
        const numOptions = options.length;
        const downSteps = ((currentIndex - target) % numOptions + numOptions) % numOptions;
        const upSteps = ((target - currentIndex) % numOptions + numOptions) % numOptions;
        if (downSteps <= upSteps) dispatchKey(container, 'ArrowDown', 40, downSteps);
        else dispatchKey(container, 'ArrowUp', 38, upSteps);
        await sleep(10);
        const next = currentFieldValues()[field] ?? '';
        if (next !== options[target]) return false;
    }
    await sleep(1);
    dispatchKey(container, 'Enter', 13);
    return true;
}

function configHackReady(): boolean {
    const lines = logLines();
    if (detectFields(lines).length > 0) return true;
    return lines.some((line) => line.startsWith('Attempts:'));
}

async function waitForResponse(combo: string, session: MinigameSession, deadline: number, timeout = 8000): Promise<number | null> {
    const pattern = new RegExp(
        `Input:\\s*${escapeRegExp(combo)}\\s*(?:\\r?\\n)+Result:\\s*(?:\\r?\\n)+Mismatched\\s*:?\\s*(\\d+)`,
        'i',
    );
    const started = Date.now();
    while (Date.now() - started < timeout && Date.now() < deadline) {
        if (session.abort || !configHackApp()) return null;
        const match = logLines().join('\n').match(pattern);
        if (match?.[1]) return Number(match[1]);
        await sleep(100);
    }
    return null;
}

function allCombinations(numFields: number, optionsPerField: readonly number[]): number[][] {
    let results: number[][] = [[]];
    for (let field = 0; field < numFields; field++) {
        const next: number[][] = [];
        for (const result of results) {
            for (let option = 0; option < (optionsPerField[field] ?? 0); option++) next.push([...result, option]);
        }
        results = next;
    }
    return results;
}

interface MastermindSolver {
    readonly fieldsKey: string;
    readonly guesses: readonly number[][];
    readonly distance: Uint8Array;
    readonly memo: Map<string, { guess: number; depth: number }>;
    readonly size: number;
    readonly numFields: number;
}

let cachedSolver: MastermindSolver | null = null;

function getSolver(fields: readonly string[][]): MastermindSolver {
    const key = fields.map((field) => field.join('|')).join('||');
    if (cachedSolver?.fieldsKey === key) return cachedSolver;
    const numFields = fields.length;
    const guesses = allCombinations(numFields, fields.map((field) => field.length));
    const size = guesses.length;
    const distance = new Uint8Array(size * size);
    for (let left = 0; left < size; left++) {
        for (let right = left; right < size; right++) {
            let value = 0;
            for (let field = 0; field < numFields; field++) {
                if (guesses[left]?.[field] !== guesses[right]?.[field]) value++;
            }
            distance[left * size + right] = value;
            distance[right * size + left] = value;
        }
    }
    cachedSolver = { fieldsKey: key, guesses, distance, memo: new Map(), size, numFields };
    return cachedSolver;
}

function bestGuess(solver: MastermindSolver, possibilities: readonly number[], parentBest = Infinity): { guess: number; depth: number } {
    if (possibilities.length === 1) return { guess: possibilities[0] ?? 0, depth: 1 };
    const key = possibilities.join(',');
    const cached = solver.memo.get(key);
    if (cached) return cached;
    let bestDepth = Infinity;
    let bestGuessIndex = -1;
    for (let guess = 0; guess < solver.size; guess++) {
        const partitions: number[][] = Array.from({ length: solver.numFields + 1 }, () => []);
        let possibleAnswer = false;
        for (const possibility of possibilities) {
            const distance = solver.distance[guess * solver.size + possibility] ?? 0;
            if (distance === 0) possibleAnswer = true;
            else partitions[distance]?.push(possibility);
        }
        let dominated = false;
        for (let distance = 1; distance <= solver.numFields; distance++) {
            if (partitions[distance]?.length === possibilities.length) {
                dominated = true;
                break;
            }
        }
        if (dominated) continue;
        let currentMax = possibleAnswer ? 1 : 0;
        let aborted = false;
        for (let distance = 1; distance <= solver.numFields; distance++) {
            const partition = partitions[distance];
            if (!partition?.length) continue;
            const result = bestGuess(solver, partition, bestDepth);
            currentMax = Math.max(currentMax, result.depth + 1);
            if (currentMax > bestDepth || currentMax >= parentBest) {
                aborted = true;
                break;
            }
        }
        if (aborted) continue;
        if (currentMax < bestDepth) {
            bestDepth = currentMax;
            bestGuessIndex = guess;
        } else if (currentMax === bestDepth) {
            const newInSet = possibilities.includes(guess);
            const currentInSet = possibilities.includes(bestGuessIndex);
            if (newInSet && !currentInSet) bestGuessIndex = guess;
        }
    }
    const result = { guess: bestGuessIndex, depth: bestDepth };
    solver.memo.set(key, result);
    return result;
}

async function solveConfigHack(session: MinigameSession, deadline: number): Promise<MinigameResult> {
    const fields = detectFields(logLines());
    if (fields.length === 0) return { kind: 'config-hack', solved: false, message: 'could not detect fields' };
    if (!configHackApp()) return { kind: 'config-hack', solved: false, message: 'hack container not found' };
    const solver = getSolver(fields);
    let possibilities = Array.from({ length: solver.size }, (_, index) => index);
    let guessNumber = 0;
    while (possibilities.length > 0) {
        if (session.abort) return { kind: 'config-hack', solved: false, message: 'aborted' };
        if (Date.now() >= deadline) return { kind: 'config-hack', solved: false, message: 'timed out' };
        const best = bestGuess(solver, possibilities);
        const guess = solver.guesses[best.guess];
        if (!guess) return { kind: 'config-hack', solved: false, message: 'solver produced no guess' };
        const combo = buildCombo(guess, fields);
        const submitted = await submitGuess(fields, guess);
        if (!submitted) return { kind: 'config-hack', solved: false, message: 'failed to submit guess' };
        const mismatch = await waitForResponse(combo, session, deadline);
        guessNumber++;
        if (mismatch === null) return { kind: 'config-hack', solved: false, message: `no response for guess ${guessNumber}` };
        if (mismatch === 0) {
            const closedAt = Date.now();
            while (configHackApp() && Date.now() - closedAt < 10_000 && !session.abort) await sleep(100);
            return { kind: 'config-hack', solved: true };
        }
        possibilities = possibilities.filter((possibility) =>
            (solver.distance[best.guess * solver.size + possibility] ?? 0) === mismatch,
        );
        if (possibilities.length === 0) return { kind: 'config-hack', solved: false, message: 'no possibilities left' };
    }
    return { kind: 'config-hack', solved: false, message: 'solver exhausted possibilities' };
}

/**
 * Waits for a known minigame and solves it when supported. ICE Wall is detected
 * but reported as unsupported until its TS solver is implemented.
 */
export function detectMinigameKind(): MinigameKind | null {
    if (simpleDecryptApp()) return 'simple-decrypt';
    if (configHackApp()) return 'config-hack';
    if (iceWallApp()) return 'ice-wall';
    return null;
}

export async function solveMinigame(
    timeoutMs = 180_000,
    allowed: ReadonlySet<MinigameKind> = new Set(['simple-decrypt', 'config-hack', 'ice-wall']),
): Promise<MinigameResult> {
    if (activeSession) {
        // A background auto-solver tick may already own the minigame. Give it a
        // bounded chance to finish instead of failing the job instantly with a
        // misleading "another minigame run is already active" timeout.
        const waitUntil = Date.now() + Math.min(timeoutMs, 20_000);
        while (activeSession && Date.now() < waitUntil) await sleep(100);
    }
    if (activeSession) return { kind: 'none', solved: false, message: 'another minigame run is already active' };
    const session: MinigameSession = { abort: false };
    activeSession = session;
    try {
        const started = Date.now();
        let configHackStuckSince: number | null = null;
        while (Date.now() - started < timeoutMs) {
            if (session.abort) return { kind: 'none', solved: false, message: 'aborted' };
            const detected = detectMinigameKind();
            if (detected === 'config-hack' && !configHackReady()) {
                configHackStuckSince ??= Date.now();
                if (Date.now() - configHackStuckSince >= 15_000) {
                    reportMinigameStuck('config-hack', 'terminal hack did not render its fields');
                    return { kind: 'config-hack', solved: false, message: 'terminal hack stuck' };
                }
            } else {
                configHackStuckSince = null;
            }
            if (detected !== null && !allowed.has(detected)) {
                // Stop immediately instead of waiting for the timeout. The
                // caller can report a capability/configuration problem rather
                // than treating it as a failed or locked minigame.
                return { kind: detected, solved: false, message: `solver disabled for ${detected}` };
            }
            if (simpleDecryptApp() && allowed.has('simple-decrypt')) return await solveSimpleDecrypt(session, started + timeoutMs);
            if (configHackApp() && allowed.has('config-hack')) {
                if (configHackReady()) return await solveConfigHack(session, started + timeoutMs);
                await sleep(250);
                continue;
            }
            if (iceWallApp() && allowed.has('ice-wall')) return await solveIceWall(() => session.abort, started + timeoutMs);
            await sleep(250);
        }
        return { kind: 'none', solved: false, message: 'no minigame detected' };
    } finally {
        if (activeSession === session) activeSession = null;
    }
}

export function cancelMinigame(): void {
    if (activeSession) activeSession.abort = true;
}
