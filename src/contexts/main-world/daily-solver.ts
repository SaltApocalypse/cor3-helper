export interface DailyHackResult {
    readonly solved: boolean;
    readonly puzzle: string;
    readonly message: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let abort = false;

const VALID_TYPES = new Set(['AUTH', 'TEMP-SYNC', 'SCAN', 'ROUTE-CHECK', 'RADIO-TEST', 'PING', 'SYNC']);
const VALID_STATUSES = new Set(['OK', 'WARN', 'ERROR']);
const ERROR_LABELS: Record<string, string> = {
    TIME: 'Time format is incorrect',
    TYPE: 'Event type is incorrect',
    MISSING_SECTOR: 'Missing /sector parameter',
    MISSING_STATUS: 'Missing /status parameter',
    SECTOR_BAD: '/sector parameter is incorrect',
    STATUS_BAD: '/status parameter is incorrect',
};

function isVisible(element: Element | null): boolean {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function click(element: Element | null): boolean {
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
}

async function waitFor(selector: string, timeoutMs = 8000): Promise<Element | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (abort) return null;
        const element = document.querySelector(selector);
        if (element && isVisible(element)) return element;
        await sleep(100);
    }
    return null;
}

function actionButton(pattern: RegExp): Element | null {
    const direct = document.querySelector('.go190644802');
    if (isVisible(direct)) return direct;
    return [...document.querySelectorAll('button, [role="button"]')]
        .find((element) => isVisible(element) && pattern.test((element.textContent ?? '').trim())) ?? null;
}

async function waitForActionButton(pattern: RegExp, timeoutMs = 8000): Promise<Element | null> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (abort) return null;
        const button = actionButton(pattern);
        if (button) return button;
        await sleep(100);
    }
    return null;
}

export function analyzeLogLine(rawText: string): string[] {
    const issues: string[] = [];
    const text = rawText.trim();
    const timeMatch = text.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s+/);
    let rest = text;
    if (timeMatch) {
        const h = Number(timeMatch[1]);
        const m = Number(timeMatch[2]);
        const s = Number(timeMatch[3]);
        if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59 && s >= 0 && s <= 59)) issues.push('TIME');
        rest = text.slice(timeMatch[0].length);
    } else {
        issues.push('TIME');
    }
    const typeMatch = rest.match(/^([A-Z-]+)\b/);
    if (typeMatch) {
        if (!VALID_TYPES.has(typeMatch[1]!)) issues.push('TYPE');
        rest = rest.slice(typeMatch[0].length).trim();
    } else {
        issues.push('TYPE');
    }
    const hasSector = /(^|\s)\/sector=/.test(rest);
    const hasStatus = /(^|\s)\/status=/.test(rest);
    if (!hasSector) issues.push('MISSING_SECTOR');
    if (!hasStatus) issues.push('MISSING_STATUS');
    if (hasSector) {
        const match = rest.match(/\/sector=([^\s]+)/);
        const value = match?.[1] ?? null;
        const number = value !== null && /^[0-9]+$/.test(value) ? Number(value) : NaN;
        if (!(Number.isInteger(number) && number >= 1 && number <= 256)) issues.push('SECTOR_BAD');
    }
    if (hasStatus) {
        const match = rest.match(/\/status=([^\s]+)/);
        const value = match?.[1] ?? null;
        if (value === null || !VALID_STATUSES.has(value)) issues.push('STATUS_BAD');
    }
    return [...new Set(issues)];
}

function selectCheckbox(entry: Element): boolean {
    const input = entry.querySelector('input[type="checkbox"]')
        ?? entry.querySelector('.checkbox input')
        ?? entry.querySelector('[role="checkbox"]')
        ?? entry.querySelector('input');
    if (!input) return false;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        if (!input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        return true;
    }
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
}

function errorTypeButton(container: Element, label: string): Element | null {
    return [...container.querySelectorAll('.error-type-button')]
        .find((button) => (button.textContent ?? '').trim() === label) ?? null;
}

async function closeWindows(): Promise<void> {
    for (let index = 0; index < 5; index++) {
        await sleep(250);
        const close = document.querySelector('[data-component-name="close-app-btn"]');
        if (close) {
            click(close);
            continue;
        }
        const closeButton = [...document.querySelectorAll('button, [role="button"]')]
            .find((element) => {
                if (!isVisible(element)) return false;
                const text = (element.textContent ?? '').trim().toUpperCase();
                return text === 'CLOSE' || text === '关闭';
            });
        if (closeButton) {
            click(closeButton);
            continue;
        }
        break;
    }
}

function dailyUiVisible(): boolean {
    return Boolean(
        [...document.querySelectorAll('[data-component-name="DailyOpsStartButton"], [data-component-name="DailyOpsTaskInfoTitle"], .log-entries, .log-entry, .pulse-timeline, .encoding-option, .code-input')]
            .find((element) => isVisible(element)),
    );
}

async function openDailyOps(): Promise<boolean> {
    // The user may already have the Daily Ops window open. Clicking the tab
    // again would close it, so detect the real screen first.
    if (dailyUiVisible()) return true;
    const selectors = [
        '[data-component-name="TabBarItem-019a0c41-b17f-7abc-1234-567890abcde2"]',
        '[data-component-name="TabBarItem-019a0c41-b17f-7abc-1234-567890abcde1"]',
    ];
    let tab: Element | null = null;
    for (const selector of selectors) {
        const candidate = document.querySelector(selector);
        if (isVisible(candidate)) {
            tab = candidate;
            break;
        }
    }
    if (!tab) {
        // Selector names occasionally change between builds; fall back to the
        // visible tab label instead of failing immediately.
        tab = [...document.querySelectorAll('[data-component-name^="TabBarItem-"]')]
            .find((element) => isVisible(element) && /daily\s*ops|每日行动|日常行动/i.test(element.textContent ?? '')) ?? null;
    }
    if (!tab) return false;
    click(tab);
    await sleep(800);
    if (dailyUiVisible()) return true;
    const section = await waitFor('.game-center-grid button:nth-child(2)', 4000)
        ?? [...document.querySelectorAll('.game-center-grid button')]
            .find((element) => isVisible(element) && /daily\s*ops|每日行动|日常行动/i.test(element.textContent ?? ''))
        ?? null;
    if (section) {
        click(section);
        await sleep(900);
    }
    if (dailyUiVisible()) return true;
    return (await waitFor('[data-component-name="DailyOpsStartButton"]', 3000)) !== null;
}

function puzzleTitle(): string {
    return (document.querySelector('[data-component-name="DailyOpsTaskInfoTitle"]')?.textContent ?? '').trim();
}

function detectPuzzle(): 'log' | 'signal' | null {
    const title = puzzleTitle();
    if (/system log integrity|system log|log integrity|系统日志完整性|日志完整性/i.test(title)) return 'log';
    if (/signal|信号/i.test(title)) return 'signal';
    // The title can lag behind the rendered puzzle, so fall back to its DOM.
    if ([...document.querySelectorAll('.log-entries, .log-entry')].some((element) => isVisible(element))) return 'log';
    if ([...document.querySelectorAll('.pulse-timeline, .encoding-option, .code-input')].some((element) => isVisible(element))) return 'signal';
    return null;
}

function puzzleRunning(): boolean {
    return [...document.querySelectorAll('.log-entries, .log-entry, .pulse-timeline, .encoding-option, .code-input')]
        .some((element) => isVisible(element));
}

async function startTask(): Promise<boolean> {
    // Only skip Start Task when the puzzle content itself is present. The task
    // title may already be visible before the task is started.
    if (puzzleRunning()) return true;
    const button = await waitFor('[data-component-name="DailyOpsStartButton"]', 8000)
        ?? await waitForActionButton(/start\s*task|开始任务/i, 4000);
    if (!button) return false;
    click(button);
    await sleep(1000);
    return true;
}


const MORSE_MAP: Record<string, string> = {
    LLLLL: '0', SLLLL: '1', SSLLL: '2', SSSLL: '3', SSSSL: '4',
    SSSSS: '5', LSSSS: '6', LLSSS: '7', LLLSS: '8', LLLLS: '9',
};
const BINARY_MAP: Record<string, string> = {
    SSSS: '0', SSSL: '1', SSLS: '2', SSLL: '3', SLSS: '4',
    SLSL: '5', SLLS: '6', SLLL: '7', LSSS: '8', LSSL: '9',
};
const ENCODING_LABELS: Record<string, string> = {
    MORSE: 'Morse Numeric (0-9)',
    BINARY: 'Binary Numeric',
};

function setInputValue(input: Element, value: string): void {
    if (!(input instanceof HTMLInputElement)) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function solveSignalHack(): Promise<DailyHackResult> {
    const getSignal = await waitForActionButton(/get\s*signal|获取信号|信号/i, 8000);
    if (!getSignal) return { solved: false, puzzle: 'signal', message: 'Get Signal button not found' };
    click(getSignal);
    await sleep(1500);
    const timeline = await waitFor('.pulse-timeline', 10000);
    if (!timeline) return { solved: false, puzzle: 'signal', message: 'Pulse timeline not found' };
    const pulses = [...timeline.querySelectorAll('.pulse-group')].map((group): string => {
        if (group.querySelector('.pulse-bar.short')) return 'S';
        const longCount = group.querySelectorAll('.pulse-bar.long').length;
        if (longCount >= 3) return 'L';
        const bar = group.querySelector('.pulse-bar');
        if (bar?.classList.contains('short')) return 'S';
        if (bar?.classList.contains('long')) return 'L';
        return '?';
    });
    const decode = (size: number, map: Record<string, string>): string => {
        const result: string[] = [];
        for (let index = 0; index < pulses.length; index += size) {
            const chunk = pulses.slice(index, index + size);
            if (chunk.length < size) break;
            result.push(map[chunk.join('')] ?? '?');
        }
        return result.join('');
    };
    const morse = decode(5, MORSE_MAP);
    const binary = decode(4, BINARY_MAP);
    const digits = (value: string): number => (value.match(/[0-9]/g) ?? []).length;
    const unknown = (value: string): number => (value.match(/\?/g) ?? []).length;
    const morseDigits = digits(morse);
    const binaryDigits = digits(binary);
    if (morseDigits === 0 && binaryDigits === 0) {
        await closeWindows();
        return { solved: false, puzzle: 'signal', message: 'Could not decode signal' };
    }
    let encoding: 'MORSE' | 'BINARY';
    let value: string;
    if (morseDigits > binaryDigits) {
        encoding = 'MORSE';
        value = morse;
    } else if (binaryDigits > morseDigits) {
        encoding = 'BINARY';
        value = binary;
    } else if (unknown(morse) <= unknown(binary)) {
        encoding = 'MORSE';
        value = morse;
    } else {
        encoding = 'BINARY';
        value = binary;
    }
    await sleep(500);
    if (!click(document.querySelector('.next-button'))) return { solved: false, puzzle: 'signal', message: 'Encoding button not found' };
    await sleep(800);
    const target = ENCODING_LABELS[encoding];
    const option = [...document.querySelectorAll('.encoding-option')]
        .find((entry) => (entry.querySelector('.option-header')?.textContent ?? '').trim() === target);
    if (!option) return { solved: false, puzzle: 'signal', message: `Encoding option not found: ${target}` };
    click(option);
    await sleep(500);
    if (!click(document.querySelector('.next-button'))) return { solved: false, puzzle: 'signal', message: 'Decode button not found' };
    await sleep(800);
    const input = await waitFor('.code-input', 5000);
    if (!input) return { solved: false, puzzle: 'signal', message: 'Code input not found' };
    setInputValue(input, value);
    await sleep(400);
    if (!click(document.querySelector('.submit-button'))) return { solved: false, puzzle: 'signal', message: 'Confirm code button not found' };
    await sleep(1500);
    const result = document.querySelector('.result-title');
    const solved = result?.classList.contains('success') === true;
    await closeWindows();
    return {
        solved,
        puzzle: 'signal',
        message: solved ? `Signal decoded as ${encoding}: ${value}` : (result?.textContent ?? 'Result not confirmed').trim(),
    };
}

async function solveSystemLogs(): Promise<DailyHackResult> {
    const getLogs = await waitForActionButton(/get\s*logs|获取日志|日志/i, 8000);
    if (!getLogs) return { solved: false, puzzle: 'log', message: 'Get Logs button not found' };
    click(getLogs);
    await sleep(4000);
    const container = await waitFor('.log-entries', 10000);
    if (!container) return { solved: false, puzzle: 'log', message: 'log entries not found' };
    const entries = [...container.querySelectorAll('.log-entry.log-entry-appearing')];
    const analyzed = entries
        .map((entry) => {
            const text = ((entry.querySelector('span') ?? entry.querySelector('.log-line') ?? entry).textContent ?? '').trim();
            return { entry, text, issues: analyzeLogLine(text) };
        })
        .filter((entry) => entry.issues.length > 0)
        .sort((left, right) => right.issues.length - left.issues.length);
    const selected = analyzed.slice(0, 2);
    if (selected.length === 0) return { solved: false, puzzle: 'log', message: 'No invalid log entries found' };
    for (const entry of selected) selectCheckbox(entry.entry);
    const confirm = document.querySelector('.confirm-button');
    if (!click(confirm)) return { solved: false, puzzle: 'log', message: 'Confirm button not found' };
    await sleep(1000);
    const analysis = await waitFor('.analysis-container', 5000);
    if (!analysis) return { solved: false, puzzle: 'log', message: 'Analysis container not found' };
    const issueMap = new Map(selected.map((entry) => [entry.text, entry.issues]));
    for (const block of analysis.querySelectorAll('.error-analysis-block')) {
        const line = (block.querySelector('.log-line-display')?.textContent ?? '').trim();
        let issues = issueMap.get(line);
        if (!issues) {
            const matched = selected.find((entry) => entry.text === line || (line.length > 0 && entry.text.includes(line)));
            issues = matched?.issues;
        }
        if (!issues) continue;
        const fix = block.querySelector('.fix-error-button');
        if (!fix) continue;
        click(fix);
        await sleep(50);
        for (const issue of issues) {
            const button = errorTypeButton(block, ERROR_LABELS[issue] ?? issue);
            if (button) {
                click(button);
                await sleep(25);
            }
        }
    }
    await sleep(1000);
    if (!click(document.querySelector('.confirm-button'))) return { solved: false, puzzle: 'log', message: 'Fix confirm button not found' };
    await sleep(1000);
    if (!click(document.querySelector('.scan-button'))) return { solved: false, puzzle: 'log', message: 'Scan button not found' };
    await sleep(1500);
    const result = document.querySelector('.result-title');
    const solved = result?.classList.contains('success') === true;
    await closeWindows();
    return {
        solved,
        puzzle: 'log',
        message: solved ? 'System Log Integrity solved' : (result?.textContent ?? 'Result not confirmed').trim(),
    };
}

export async function solveDailyHack(timeoutMs = 120000): Promise<DailyHackResult> {
    abort = false;
    const started = Date.now();
    if (!(await openDailyOps())) {
        return { solved: false, puzzle: 'none', message: 'Daily Ops window not found' };
    }
    if (!(await startTask())) {
        const title = puzzleTitle();
        return {
            solved: false,
            puzzle: 'none',
            message: `Start Task button not found${title ? ` (title: ${title})` : ''}`,
        };
    }
    while (Date.now() - started < timeoutMs) {
        if (abort) return { solved: false, puzzle: 'none', message: 'aborted' };
        const puzzle = detectPuzzle();
        if (puzzle === 'log') return solveSystemLogs();
        if (puzzle === 'signal') return solveSignalHack();
        await sleep(250);
    }
    const title = puzzleTitle();
    return {
        solved: false,
        puzzle: 'none',
        message: `No supported daily puzzle detected${title ? ` (title: ${title})` : ''}`,
    };
}

export function cancelDailyHack(): void {
    abort = true;
}
