import { saiFilesMessageSchema, type SaiFileEntry } from '../../contracts/sai.js';
import type { SettingsV1 } from '../../contracts/storage.js';
import { hasSaiFileBadge, saiFileHighlight, type SaiFileHighlight } from '../../domains/valuable/sai.js';
import { CONTENT_SETTINGS_KEY, parseContentSettings } from './settings.js';

/**
 * SAI file-list value overlay.
 *
 * The MAIN-world socket hub forwards the latest `sai:get.files` snapshot to the
 * content script. This module paints the corresponding rows in the game's SAI
 * window and adds a compact value badge (credits, detection rate, tags).
 *
 * The SAI window is a React view that re-renders frequently, so highlights are
 * applied through classes and re-applied by a MutationObserver. The original
 * DOM is never rewritten; badges are the only nodes this module owns.
 */

const SAI_ROOT_SELECTOR = '[data-component-name="ServerAdministrationInterfaceApplication"]';
const SAI_FILES_SELECTOR = '[data-component-name="SaiFiles"]';
const SCROLL_AREA_SELECTOR = '[data-component-name="ScrollArea"]';
const STYLE_ID = 'cor3-helper-sai-highlight-style';
const CLASS_USER = 'cor3-sai-row-user';
const CLASS_SYSTEM = 'cor3-sai-row-system';
const CLASS_JOB = 'cor3-sai-row-job';
const CLASS_VALUABLE = 'cor3-sai-row-valuable';
const CLASS_PRICED = 'cor3-sai-row-priced';
const CLASS_OTHER = 'cor3-sai-row-other';
const CLASS_BADGE = 'cor3-sai-badge';
const ROW_CLASSES = [CLASS_USER, CLASS_SYSTEM, CLASS_JOB, CLASS_VALUABLE, CLASS_PRICED, CLASS_OTHER] as const;
const CLASS_BY_HIGHLIGHT: Record<Exclude<SaiFileHighlight, 'none'>, string> = {
    user: CLASS_USER,
    system: CLASS_SYSTEM,
    job: CLASS_JOB,
    valuable: CLASS_VALUABLE,
    priced: CLASS_PRICED,
    other: CLASS_OTHER,
};
const ROOT_RETRY_MS = 1_000;
const REFRESH_DEBOUNCE_MS = 120;
const APPLYING_SETTLE_MS = 50;

const STYLE_TEXT = `
.${CLASS_USER} {
    background-color: rgba(0, 100, 255, .2) !important;
    box-shadow: inset 3px 0 0 #0064ff !important;
}
.${CLASS_SYSTEM} {
    background-color: rgba(176, 49, 44, .2) !important;
    box-shadow: inset 3px 0 0 #b0312c !important;
}
.${CLASS_JOB} {
    background-color: rgba(238, 215, 7, .3) !important;
    box-shadow: inset 3px 0 0 #eed707 !important;
}
.${CLASS_VALUABLE} {
    background-color: rgba(0, 210, 180, .35) !important;
    box-shadow: inset 3px 0 0 #00d2b4 !important;
}
.${CLASS_PRICED} {
    background-color: rgba(255, 160, 0, .3) !important;
    box-shadow: inset 3px 0 0 #ffa000 !important;
}
.${CLASS_OTHER} {
    background-color: rgba(226, 9, 197, .2) !important;
    box-shadow: inset 3px 0 0 #e209c5 !important;
}
.${CLASS_BADGE} {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    vertical-align: middle;
    flex-shrink: 0;
    pointer-events: none;
    white-space: nowrap;
}
.${CLASS_BADGE} .cor3-sai-credits {
    color: #00cdab;
    font-size: 11px;
    font-weight: 600;
}
.${CLASS_BADGE} .cor3-sai-detect {
    color: #ff6b35;
    font-size: 11px;
    font-weight: 600;
    opacity: .9;
}
.${CLASS_BADGE} .cor3-sai-tags {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: rgba(255, 255, 255, .15);
    color: rgba(255, 255, 255, .75);
    font-size: 9px;
    font-weight: 700;
    font-style: italic;
    line-height: 1;
    pointer-events: auto;
    cursor: default;
}
`;

export interface SaiHighlighter {
    setFiles(files: readonly SaiFileEntry[]): void;
}

let files: SaiFileEntry[] = [];
let enabled = false;
let started = false;
let observer: MutationObserver | null = null;
let observedRoot: HTMLElement | null = null;
let highlightedContainer: HTMLElement | null = null;
let retryTimer: number | null = null;
let refreshTimer: number | null = null;
let applying = false;
let appliedSignature: string | null = null;

function injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE_TEXT;
    (document.head ?? document.documentElement).appendChild(style);
}

function getSaiRoot(): HTMLElement | null {
    return document.querySelector<HTMLElement>(SAI_ROOT_SELECTOR);
}

function getFilesContainer(): HTMLElement | null {
    const root = getSaiRoot();
    if (!root) return null;
    const filesTab = root.querySelector<HTMLElement>(SAI_FILES_SELECTOR) ?? root;
    const scrollArea = filesTab.querySelector<HTMLElement>(SCROLL_AREA_SELECTOR)
        ?? root.querySelector<HTMLElement>(SCROLL_AREA_SELECTOR);
    const container = scrollArea?.firstElementChild;
    return container instanceof HTMLElement ? container : null;
}

function clearApplied(container: HTMLElement | null): void {
    if (!container) return;
    for (const row of container.querySelectorAll<HTMLElement>(ROW_CLASSES.map((name) => `.${name}`).join(', '))) {
        row.classList.remove(...ROW_CLASSES);
    }
    for (const badge of container.querySelectorAll(`.${CLASS_BADGE}`)) badge.remove();
}

function signatureOf(entries: readonly SaiFileEntry[]): string {
    return entries
        .map((entry) => [
            entry.fileId,
            entry.source,
            entry.isValuableMarked ? '1' : '0',
            entry.basePrice,
            entry.detectRate,
            JSON.stringify(entry.tags),
        ].join('\u0000'))
        .join('\u0001');
}

function expectedClass(entry: SaiFileEntry): string | null {
    const highlight = saiFileHighlight(entry);
    return highlight === 'none' ? null : CLASS_BY_HIGHLIGHT[highlight];
}

function needsApply(container: HTMLElement): boolean {
    if (appliedSignature !== signatureOf(files)) return true;
    const rows = Array.from(container.children);
    for (let index = 0; index < files.length; index += 1) {
        const entry = files[index];
        const row = rows[index];
        if (!entry || !(row instanceof HTMLElement)) continue;
        const expected = expectedClass(entry);
        if (expected && !row.classList.contains(expected)) return true;
        if (hasSaiFileBadge(entry) && !row.querySelector(`.${CLASS_BADGE}`)) return true;
    }
    return false;
}

function createBadge(entry: SaiFileEntry): HTMLElement | null {
    if (!hasSaiFileBadge(entry)) return null;
    const badge = document.createElement('span');
    badge.className = CLASS_BADGE;
    if (entry.basePrice > 0) {
        const credits = document.createElement('span');
        credits.className = 'cor3-sai-credits';
        credits.textContent = `CR ${entry.basePrice.toLocaleString()}`;
        badge.appendChild(credits);
    }
    if (entry.detectRate > 0) {
        const detect = document.createElement('span');
        detect.className = 'cor3-sai-detect';
        detect.textContent = `${entry.detectRate}% det`;
        badge.appendChild(detect);
    }
    if (entry.tags.length > 0) {
        const tags = document.createElement('span');
        tags.className = 'cor3-sai-tags';
        tags.textContent = 'i';
        tags.title = entry.tags.join(', ');
        badge.appendChild(tags);
    }
    return badge;
}

function apply(container: HTMLElement): void {
    clearApplied(container);
    highlightedContainer = container;
    if (!enabled || files.length === 0) return;
    const rows = Array.from(container.children);
    files.forEach((entry, index) => {
        const row = rows[index];
        if (!(row instanceof HTMLElement)) return;
        const highlight = expectedClass(entry);
        if (highlight) row.classList.add(highlight);
        const badge = createBadge(entry);
        if (!badge) return;
        const target = row.firstElementChild instanceof HTMLElement ? row.firstElementChild : row;
        target.appendChild(badge);
    });
}

function refresh(): void {
    if (!enabled) {
        clearApplied(highlightedContainer);
        highlightedContainer = null;
        return;
    }
    const root = getSaiRoot();
    if (!root) {
        clearApplied(highlightedContainer);
        highlightedContainer = null;
        return;
    }
    ensureObserver(root);
    const container = getFilesContainer();
    if (!container) return;
    if (highlightedContainer && highlightedContainer !== container) clearApplied(highlightedContainer);
    if (highlightedContainer === container && !needsApply(container)) return;
    applying = true;
    try {
        apply(container);
        appliedSignature = signatureOf(files);
    } finally {
        window.setTimeout(() => {
            applying = false;
        }, APPLYING_SETTLE_MS);
    }
}

function scheduleRefresh(delay = REFRESH_DEBOUNCE_MS): void {
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        refresh();
    }, delay);
}

function ensureObserver(root: HTMLElement): void {
    if (observedRoot === root && observer) return;
    observer?.disconnect();
    observer = new MutationObserver(() => {
        if (applying) return;
        scheduleRefresh();
    });
    observer.observe(root, { childList: true, subtree: true });
    observedRoot = root;
}

function startRetryLoop(): void {
    if (retryTimer !== null) return;
    retryTimer = window.setInterval(() => {
        if (!enabled) return;
        const root = getSaiRoot();
        if (!root) {
            clearApplied(highlightedContainer);
            highlightedContainer = null;
            return;
        }
        ensureObserver(root);
        if (!highlightedContainer || !highlightedContainer.isConnected) scheduleRefresh(0);
    }, ROOT_RETRY_MS);
}

function stop(): void {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
    if (retryTimer !== null) {
        window.clearInterval(retryTimer);
        retryTimer = null;
    }
    if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
    }
    clearApplied(highlightedContainer);
    highlightedContainer = null;
    appliedSignature = null;
    applying = false;
}

function setEnabled(next: boolean): void {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
        stop();
        return;
    }
    injectStyle();
    startRetryLoop();
    scheduleRefresh(0);
}

function setFiles(next: readonly SaiFileEntry[]): void {
    files = [...next];
    if (enabled) scheduleRefresh(0);
}

function applySettings(next: SettingsV1 | null): void {
    setEnabled(next?.saiFileHighlightEnabled ?? false);
}

function start(): void {
    if (started) return;
    started = true;
    injectStyle();
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const parsed = saiFilesMessageSchema.safeParse(event.data);
        if (parsed.success) setFiles(parsed.data.files);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[CONTENT_SETTINGS_KEY]) return;
        applySettings(parseContentSettings(changes[CONTENT_SETTINGS_KEY].newValue));
    });
    void chrome.storage.local.get(CONTENT_SETTINGS_KEY)
        .then((stored) => applySettings(parseContentSettings(stored[CONTENT_SETTINGS_KEY])))
        .catch(() => undefined);
}

export function startSaiHighlighter(): SaiHighlighter {
    start();
    return { setFiles };
}
