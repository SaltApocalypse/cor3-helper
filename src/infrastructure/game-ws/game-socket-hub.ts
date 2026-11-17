import type { RawNetworkMap } from '../../contracts/map.js';
import { rawMarketSnapshotSchema, type RawMarketSnapshot } from '../../contracts/market.js';
import { normalizeSaiFile, normalizeSaiFiles, type SaiFileEntry } from '../../contracts/sai.js';
import type { GameError } from '../../application/game/ports.js';
import { isGameReady, type GameReadiness } from '../../contracts/game-readiness.js';
import { err, ok, type Result } from '../../kernel/result.js';

interface PendingMap {
    readonly resolve: (map: RawNetworkMap) => void;
    readonly reject: (error: Error) => void;
    readonly timer: number;
}

interface PendingRequest {
    readonly resolve: (response: GameResponse) => void;
    readonly reject: (error: Error) => void;
    readonly timer: number;
}

interface PendingStash {
    readonly resolve: (stash: unknown) => void;
    readonly reject: (error: Error) => void;
    readonly timer: number;
}

export function looksLikeExpeditionData(value: unknown): boolean {
    const isExpedition = (entry: object): boolean => {
        const item = entry as Record<string, unknown>;
        return 'locationName' in item
            || 'zoneName' in item
            || 'messages' in item
            || 'mercenary' in item
            || 'endsAt' in item
            || 'endTime' in item;
    };
    if (Array.isArray(value)) {
        return value.length === 0 || value.some((entry) => !!entry && typeof entry === 'object' && isExpedition(entry));
    }
    if (!value || typeof value !== 'object') return false;
    const entry = value as { expeditions?: unknown; active?: unknown; data?: unknown; id?: unknown; status?: unknown };
    if (Array.isArray(entry.expeditions) || Array.isArray(entry.active)) return true;
    if (entry.data !== undefined) return looksLikeExpeditionData(entry.data);
    return typeof entry.id === 'string' && isExpedition(entry);
}

function expeditionDataEmpty(value: unknown): boolean {
    if (Array.isArray(value)) return value.length === 0;
    if (!value || typeof value !== 'object') return true;
    const entry = value as { expeditions?: unknown; active?: unknown; activeExpeditions?: unknown; data?: unknown; id?: unknown };
    if (Array.isArray(entry.expeditions)) return entry.expeditions.length === 0;
    if (Array.isArray(entry.active)) return entry.active.length === 0;
    if (Array.isArray(entry.activeExpeditions)) return entry.activeExpeditions.length === 0;
    if (entry.data !== undefined) return expeditionDataEmpty(entry.data);
    return typeof entry.id !== 'string';
}

export function collectExpeditionObjects(value: unknown, output: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        for (const entry of value) collectExpeditionObjects(entry, output);
        return output;
    }
    if (!value || typeof value !== 'object') return output;
    const entry = value as Record<string, unknown>;
    if (entry.data !== undefined) {
        collectExpeditionObjects(entry.data, output);
        return output;
    }
    for (const key of ['expeditions', 'active', 'activeExpeditions']) {
        if (Array.isArray(entry[key])) collectExpeditionObjects(entry[key], output);
    }
    if (entry.expedition !== undefined) collectExpeditionObjects(entry.expedition, output);
    const isExpedition = typeof entry.id === 'string' && (
        'locationName' in entry
        || 'zoneName' in entry
        || 'messages' in entry
        || 'endsAt' in entry
        || 'endTime' in entry
        || 'mercenary' in entry
    );
    if (isExpedition && !output.includes(entry)) output.push(entry);
    return output;
}

export function collectDecisionObjects(value: unknown, output: unknown[] = []): unknown[] {
    if (Array.isArray(value)) {
        for (const entry of value) collectDecisionObjects(entry, output);
        return output;
    }
    if (!value || typeof value !== 'object') return output;
    const entry = value as Record<string, unknown>;
    if (entry.data !== undefined) {
        collectDecisionObjects(entry.data, output);
        return output;
    }
    if (Array.isArray(entry.decisions)) output.push(...entry.decisions);
    const hasOptions = Array.isArray(entry.decisionOptions) || Array.isArray(entry.options);
    if (hasOptions && (typeof entry.id === 'string' || typeof entry.messageId === 'string')) {
        output.push(entry);
    }
    if (entry.event && typeof entry.event === 'object' && !Array.isArray(entry.event)) {
        const event = entry.event as Record<string, unknown>;
        if (Array.isArray(event.decisionOptions) || Array.isArray(event.options)) {
            output.push({
                ...event,
                id: entry.messageId ?? event.id,
                expeditionId: entry.expeditionId ?? event.expeditionId,
            });
        }
    }
    return output;
}

function looksLikeStash(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const entry = value as { items?: unknown; stash?: unknown };
    if (Array.isArray(entry.items)) return true;
    return Boolean(entry.stash && typeof entry.stash === 'object' && Array.isArray((entry.stash as { items?: unknown }).items));
}

function looksLikeMailState(value: unknown): boolean {
    if (Array.isArray(value)) return true;
    if (!value || typeof value !== 'object') return false;
    const record = value as { messages?: unknown; mail?: unknown; data?: unknown };
    if (Array.isArray(record.messages)) return true;
    if (record.mail !== undefined) return looksLikeMailState(record.mail);
    if (record.data !== undefined) return looksLikeMailState(record.data);
    return false;
}

export function looksLikeSpecialistState(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    return 'specialists' in (value as Record<string, unknown>);
}

export interface WsLogEntry {
    readonly at: number;
    readonly direction: 'in' | 'out';
    readonly event: string;
    readonly action: string;
    readonly text: string;
    readonly socketUrl?: string;
}

/**
 * The game opens extra WebSockets for minigames (ICE Wall, ConfigHack, ...).
 * v1 excluded those from active-socket selection because commands sent to a
 * minigame socket never get an answer. Keep the same rule here.
 */
export function isMinigameSocketUrl(url: string): boolean {
    return /ice-wall-break|minigame|hack|games/i.test(url);
}

export interface OutgoingMarketRequest {
    readonly action: 'get.options' | 'get.lots' | 'get.jobs';
    readonly marketId: string;
}

/**
 * Detects market refresh frames sent by the game itself. The extension only
 * cached responses for its own requests before, so a manual in-game refresh
 * never reached the Auto Jobs snapshot.
 */
export function parseOutgoingMarketRequest(data: unknown): OutgoingMarketRequest | null {
    if (typeof data !== 'string' || !data.startsWith('42')) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(data.substring(2));
    } catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed[0] !== 'event') return null;
    const payload = parsed[1] as { event?: { name?: unknown; action?: unknown }; data?: { marketId?: unknown } } | undefined;
    if (payload?.event?.name !== 'market') return null;
    const action = payload.event.action;
    if (action !== 'get.options' && action !== 'get.lots' && action !== 'get.jobs') return null;
    const marketId = payload.data?.marketId;
    if (typeof marketId !== 'string' || marketId.length === 0) return null;
    return { action, marketId };
}

export interface SocketCandidate {
    readonly url: string;
    readonly minigame: boolean;
    readonly lastActivityAt: number;
    readonly readyState: number;
}

/**
 * Pick the game socket that most recently received data. v1 did the same:
 * the "last opened" socket is not reliable because the game opens transient
 * sockets for minigames and other services.
 */
export function pickActiveSocket<T extends SocketCandidate>(records: Iterable<T>): T | null {
    let best: T | null = null;
    for (const record of records) {
        if (record.minigame || record.readyState !== 1) continue;
        if (!best || record.lastActivityAt > best.lastActivityAt) best = record;
    }
    return best;
}

interface SocketRecord {
    readonly ws: WebSocket;
    readonly url: string;
    readonly minigame: boolean;
    lastActivityAt: number;
    readyState: number;
}

interface PendingMail {
    readonly resolve: (mail: unknown) => void;
    readonly reject: (error: Error) => void;
    readonly timer: number;
}

interface GameResponse {
    readonly data: unknown;
    readonly error: unknown;
}

interface QueuedFrame {
    readonly event: string;
    readonly action: string;
    readonly frame: string;
    readonly networkMap: boolean;
    readonly deadline: number;
}

/** v1 used a 250 ms WebSocket send throttle; keep the same baseline. */
const MIN_SEND_INTERVAL_MS = 250;
/** network-map commands are the ones that surface "Too many requests" toasts. */
const NETWORK_MAP_SEND_INTERVAL_MS = 2_500;
/** After a rate-limit response, pause all sends long enough for the server to recover. */
const RATE_LIMIT_COOLDOWN_MS = 5_000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 60_000;
const RATE_LIMIT_STRIKE_WINDOW_MS = 60_000;
/** Bound the outgoing queue so a long rate-limit window cannot grow forever. */
const MAX_QUEUED_FRAMES = 50;
/** Retry flush while no game socket is open (v1 requeued in this situation too). */
const QUEUE_RETRY_MS = 4_000;
const DEFAULT_FRAME_DEADLINE_MS = 15_000;

function isRateLimitError(value: unknown): boolean {
    if (typeof value === 'string') return /too many requests|rate[\s-]?limit/i.test(value);
    if (!value || typeof value !== 'object') return false;
    const entry = value as { message?: unknown; code?: unknown };
    const text = [entry.message, entry.code].filter((part): part is string => typeof part === 'string').join(' ');
    return /too many requests|rate[\s-]?limit/i.test(text);
}

function payloadErrorMessage(value: unknown, fallback: string): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const entry = value as { message?: unknown; code?: unknown };
        if (typeof entry.message === 'string') return entry.message;
        if (typeof entry.code === 'string') return entry.code;
    }
    return fallback;
}

function sanitizeSocketUrl(url: string | null): string | null {
    if (!url) return url;
    try {
        const parsed = new URL(url);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return url.replace(/[?#].*$/, '');
    }
}

interface Codec {
    isReady(): boolean;
    packetToString(packet: unknown): string | null;
    stringToPacketBuffer(value: string): ArrayBuffer | null;
    decodeBinaryPacketAsync(data: unknown): Promise<unknown>;
}

declare global {
    interface Window {
        __cor3MsgpackCodec?: Codec;
    }
}

function gameError(error: unknown, fallback: string): GameError {
    if (error && typeof error === 'object') {
        const candidate = error as { code?: unknown; message?: unknown; retryAt?: unknown; lockExpiresAt?: unknown };
        return {
            code: typeof candidate.code === 'string' ? candidate.code : fallback,
            message: typeof candidate.message === 'string' ? candidate.message : fallback,
            ...(typeof candidate.retryAt === 'number' ? { retryAt: candidate.retryAt } : {}),
            ...(typeof candidate.lockExpiresAt === 'number' ? { lockExpiresAt: candidate.lockExpiresAt } : {}),
        };
    }
    return { code: fallback, message: fallback };
}

/**
 * Game socket hub for the MAIN world.
 * It captures the page WebSocket, sends typed commands, and correlates responses
 * by Socket.IO event + action. Commands are serialized by the caller, so one
 * pending waiter per action is intentional.
 */
export class GameSocketHub {
    private active: WebSocket | null = null;
    private readonly sockets = new Map<WebSocket, SocketRecord>();
    private pendingMap: PendingMap | null = null;
    private pendingMapPromise: Promise<RawNetworkMap> | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    private readonly requestChains = new Map<string, Promise<GameResponse>>();
    private readonly expeditionEventCache = new Map<string, { readonly at: number; readonly value: Record<string, unknown> }>();
    private readonly expeditionDecisionCache: { readonly at: number; readonly value: unknown }[] = [];
    private pendingStash: PendingStash | null = null;
    private pendingMail: PendingMail | null = null;
    private lastMailState: unknown = null;
    private pendingExpeditions: PendingRequest | null = null;
    private pendingExpeditionsFallback: { readonly data?: unknown; readonly error?: unknown } | null = null;
    private pendingExpeditionsFallbackTimer: number | null = null;
    private expeditionsReadPromise: Promise<Result<unknown, GameError>> | null = null;
    private sendQueue: QueuedFrame[] = [];
    private sendTimer: number | null = null;
    private lastSendAt = 0;
    private lastNetworkMapSendAt = 0;
    private rateLimitedUntil = 0;
    private rateLimitStrikes = 0;
    private lastRateLimitAt = 0;
    private token: string | null = null;
    private tokenExpiresAt: number | null = null;
    private joinedRooms = new Set<string>();
    private lastDroneEvent: unknown = null;
    private lastDroneCompleted: unknown = null;
    private minigameLock: { readonly lockExpiresAt: number; readonly at: number } | null = null;
    private frameLog: WsLogEntry[] = [];
    private installed = false;
    private socketOpen = false;
    private authenticated = false;
    private mapLoadedAt: number | null = null;
    private marketLoadedAt: number | null = null;
    private loadoutLoadedAt: number | null = null;
    private readyAt: number | null = null;
    private lastNotifiedReadiness: string | null = null;
    private lastAuthReconnectAt = 0;
    private lastActiveNoticeAt = 0;
    private readonly pendingMarketActions = new Map<string, { readonly marketId: string; readonly expiresAt: number }>();
    private desktopOptions: unknown | null = null;
    private readonly marketCache = new Map<string, {
        options?: unknown;
        lots?: unknown;
        jobs?: unknown;
        updatedAt: number;
    }>();
    private saiFiles: SaiFileEntry[] = [];

    install(): void {
        if (this.installed) return;
        try {
            this.installHooks();
            this.installed = true;
        } catch (error) {
            this.installed = false;
            console.warn('[cor3-helper 2.0] failed to install game socket hooks', error);
        }
    }

    private installHooks(): void {
        const original = window.WebSocket;
        const hub = this;
        const ProxyCtor = new Proxy(original, {
            construct(target, args) {
                const ws = Reflect.construct(target, args) as WebSocket;
                const url = String(args[0] ?? '');
                if (url.includes('cor3') || url.includes('corie')) hub.track(ws, url);
                return ws;
            },
        });
        Object.defineProperty(ProxyCtor, 'prototype', { value: original.prototype });
        window.WebSocket = ProxyCtor as unknown as typeof WebSocket;

        const originalFetch = window.fetch.bind(window);
        window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
            this.captureHeaders(init?.headers);
            const result = originalFetch(input, init);
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
            if (url.includes('socket.io') && url.includes('transport=polling')) {
                void result.then((response) => response.clone().text())
                    .then((text) => this.parseDesktopPolling(text))
                    .catch(() => undefined);
            }
            return result;
        }) as typeof window.fetch;

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        (XMLHttpRequest.prototype as unknown as { open: (...args: unknown[]) => void }).open = function (this: XMLHttpRequest, ...args: unknown[]) {
            (this as XMLHttpRequest & { __v2Url?: string }).__v2Url = String(args[1] ?? '');
            return (originalOpen as unknown as (...args: unknown[]) => void).apply(this, args);
        };
        XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
            const url = (this as XMLHttpRequest & { __v2Url?: string }).__v2Url ?? '';
            if (name.toLowerCase() === 'authorization' && /cor3|corie/i.test(url)) hub.captureToken(value);
            return originalSetHeader.call(this, name, value);
        };
    }

    authStatus(): { readonly authenticated: boolean; readonly expiresAt?: number } {
        const expired = this.tokenExpiresAt !== null && this.tokenExpiresAt <= Date.now();
        const authenticated = this.token !== null && !expired;
        if (authenticated !== this.authenticated) {
            this.authenticated = authenticated;
            this.notifyReadiness();
        }
        return {
            authenticated,
            ...(this.tokenExpiresAt !== null ? { expiresAt: this.tokenExpiresAt } : {}),
        };
    }

    readiness(): GameReadiness {
        const checkedAt = Date.now();
        this.authenticated = this.token !== null && (this.tokenExpiresAt === null || this.tokenExpiresAt > checkedAt);
        const current: GameReadiness = {
            socketOpen: this.socketOpen,
            authenticated: this.authenticated,
            mapLoaded: this.mapLoadedAt !== null,
            marketLoaded: this.marketLoadedAt !== null,
            loadoutLoaded: this.loadoutLoadedAt !== null,
            ready: false,
            readyAt: this.readyAt,
            checkedAt,
        };
        const ready = isGameReady(current);
        if (ready && this.readyAt === null) this.readyAt = checkedAt;
        if (!ready) this.readyAt = null;
        return {
            ...current,
            ready,
            readyAt: this.readyAt,
        };
    }

    cachedMarket(marketId: string): RawMarketSnapshot | null {
        const entry = this.marketCache.get(marketId);
        if (!entry || entry.options === undefined || entry.lots === undefined || entry.jobs === undefined) return null;
        const parsed = rawMarketSnapshotSchema.safeParse({ options: entry.options, lots: entry.lots, jobs: entry.jobs });
        return parsed.success ? parsed.data : null;
    }

    saiFilesSnapshot(): { readonly files: readonly SaiFileEntry[] } {
        return { files: this.saiFiles };
    }

    private setSaiFiles(files: SaiFileEntry[]): void {
        this.saiFiles = files;
        try {
            window.postMessage({ version: 2, type: 'V2_SAI_FILES', files }, '*');
        } catch {
            // The game page may be tearing down.
        }
    }

    private handleSaiEvent(action: string | undefined, data: unknown): void {
        if (!data || typeof data !== 'object') return;
        const record = data as Record<string, unknown>;
        if (action === 'get.files' || (action === undefined && Array.isArray(record.files))) {
            this.setSaiFiles(normalizeSaiFiles(data));
            return;
        }
        if (action === 'file.delete') {
            const fileId = record.deletedFileId;
            if (typeof fileId !== 'string') return;
            this.setSaiFiles(this.saiFiles.filter((file) => file.fileId !== fileId));
            return;
        }
        if (action === 'file.upload') {
            const uploaded = normalizeSaiFile(record.file);
            if (uploaded) this.setSaiFiles([uploaded, ...this.saiFiles]);
            return;
        }
        if (action === 'file.search-valuable') {
            const hits = normalizeSaiFiles({ files: Array.isArray(record.found) ? record.found : [] });
            if (hits.length === 0) return;
            const prices = new Map(hits.map((hit) => [hit.fileId, hit.basePrice]));
            this.setSaiFiles(this.saiFiles.map((file) => {
                const price = prices.get(file.fileId);
                if (price === undefined) return file;
                return { ...file, isValuableMarked: true, basePrice: Math.max(file.basePrice, price) };
            }));
        }
    }

    private updateMarketCache(action: string, data: unknown): void {
        const pending = this.pendingMarketActions.get(action);
        if (!pending || pending.expiresAt < Date.now()) return;
        this.pendingMarketActions.delete(action);
        const marketId = pending.marketId;
        const entry = this.marketCache.get(marketId) ?? { updatedAt: Date.now() };
        if (action === 'get.options') entry.options = data;
        else if (action === 'get.lots') entry.lots = data;
        else if (action === 'get.jobs') entry.jobs = data;
        entry.updatedAt = Date.now();
        this.marketCache.set(marketId, entry);
        const snapshot = this.cachedMarket(marketId);
        if (snapshot) window.postMessage({ version: 2, type: 'V2_MARKET_CACHE_UPDATED', marketId, snapshot, updatedAt: entry.updatedAt }, '*');
    }

    private notifyReadiness(): void {
        const readiness = this.readiness();
        const key = `${readiness.socketOpen}:${readiness.authenticated}:${readiness.mapLoaded}:${readiness.marketLoaded}:${readiness.loadoutLoaded}:${readiness.ready}:${readiness.readyAt ?? ''}`;
        if (key === this.lastNotifiedReadiness) return;
        this.lastNotifiedReadiness = key;
        window.postMessage({ version: 2, type: 'V2_GAME_READINESS_CHANGED', readiness }, '*');
    }

    async getStash(timeoutMs = 15000): Promise<Result<unknown, GameError>> {
        if (!this.token) return err({ code: 'AUTH_REQUIRED', message: 'No game bearer token captured yet' });
        if (this.pendingStash) return err({ code: 'STASH_BUSY', message: 'A stash request is already pending' });
        // See getMail(): a forced leave recovers from stale room tracking
        // after injecting into a page that already joined the stash room.
        this.leaveRoom('stash', true);
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const joined = this.joinRoom('stash');
        if (!joined.ok) return joined;
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pendingStash = null;
                reject(new Error('Timed out waiting for stash data'));
            }, timeoutMs);
            this.pendingStash = { resolve, reject, timer };
        }).then((stash) => ok(stash)).catch((error: unknown) => err({
            code: 'STASH_TIMEOUT',
            message: error instanceof Error ? error.message : String(error),
        }));
    }

    async specialistAction(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const actions: Record<string, { action: string; timeoutMs: number }> = {
            getState: { action: 'get.state', timeoutMs: 15000 },
            purchase: { action: 'purchase', timeoutMs: 15000 },
        };
        const entry = actions[kind];
        if (!entry) return err({ code: 'GAME_UNKNOWN_ACTION', message: `Unknown specialist action: ${kind}` });
        // Specialists live in their own room. The game client joins it when the
        // specialist UI opens; the helper must do the same explicitly. Get state
        // uses a forced rejoin so a stale room tracking state cannot suppress
        // the response after a page/socket reload.
        if (kind === 'getState') {
            this.leaveRoom('specialists', true);
            await new Promise((resolve) => window.setTimeout(resolve, 300));
            const joined = this.joinRoom('specialists');
            if (!joined.ok) return joined;
            await new Promise((resolve) => window.setTimeout(resolve, 200));
        } else if (!this.joinedRooms.has('specialists')) {
            const joined = this.joinRoom('specialists');
            if (!joined.ok) return joined;
            await new Promise((resolve) => window.setTimeout(resolve, 200));
        }
        const response = await this.request('specialists', entry.action, payload, entry.timeoutMs).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_SPECIALIST_FAILED'));
        return ok(response.data);
    }

    private rememberExpeditionData(data: unknown): void {
        const now = Date.now();
        for (const expedition of collectExpeditionObjects(data)) {
            const id = typeof expedition.id === 'string' ? expedition.id : '';
            if (id.length === 0) continue;
            this.expeditionEventCache.set(id, { at: now, value: expedition });
        }
        for (const [id, entry] of this.expeditionEventCache) {
            if (now - entry.at > 10 * 60_000) this.expeditionEventCache.delete(id);
        }
        while (this.expeditionEventCache.size > 30) {
            const oldest = [...this.expeditionEventCache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
            if (!oldest) break;
            this.expeditionEventCache.delete(oldest[0]);
        }
        for (const decision of collectDecisionObjects(data)) {
            if (!decision || typeof decision !== 'object') continue;
            const entry = decision as { id?: unknown; messageId?: unknown; expeditionId?: unknown };
            const id = typeof entry.id === 'string' ? entry.id : typeof entry.messageId === 'string' ? entry.messageId : '';
            if (id.length === 0) continue;
            const key = `${typeof entry.expeditionId === 'string' ? entry.expeditionId : ''}:${id}`;
            const isResolved = (decision as { isResolved?: unknown }).isResolved === true;
            const existingIndex = this.expeditionDecisionCache.findIndex((cached) => {
                const value = cached.value as { id?: unknown; messageId?: unknown; expeditionId?: unknown };
                const cachedId = typeof value.id === 'string' ? value.id : typeof value.messageId === 'string' ? value.messageId : '';
                const cachedKey = `${typeof value.expeditionId === 'string' ? value.expeditionId : ''}:${cachedId}`;
                return cachedKey === key;
            });
            if (isResolved) {
                if (existingIndex >= 0) this.expeditionDecisionCache.splice(existingIndex, 1);
                continue;
            }
            if (existingIndex >= 0) this.expeditionDecisionCache[existingIndex] = { at: now, value: decision };
            else this.expeditionDecisionCache.push({ at: now, value: decision });
        }
        while (this.expeditionDecisionCache.length > 50) this.expeditionDecisionCache.shift();
        const cutoff = now - 10 * 60_000;
        while (this.expeditionDecisionCache[0] && this.expeditionDecisionCache[0].at < cutoff) this.expeditionDecisionCache.shift();
    }

    private clearExpeditionDecision(expeditionId: string, messageId: string): void {
        for (let index = this.expeditionDecisionCache.length - 1; index >= 0; index--) {
            const entry = this.expeditionDecisionCache[index]?.value as { id?: unknown; messageId?: unknown; expeditionId?: unknown } | undefined;
            if (!entry) continue;
            const id = typeof entry.id === 'string' ? entry.id : typeof entry.messageId === 'string' ? entry.messageId : '';
            const expId = typeof entry.expeditionId === 'string' ? entry.expeditionId : '';
            if (id === messageId && (expId.length === 0 || expId === expeditionId)) {
                this.expeditionDecisionCache.splice(index, 1);
            }
        }
    }

    private mergeExpeditionEvents(expeditions: readonly Record<string, unknown>[], decisions: readonly unknown[]): { expeditions: readonly Record<string, unknown>[]; decisions: readonly unknown[] } {
        const now = Date.now();
        const merged = new Map<string, Record<string, unknown>>();
        for (const expedition of expeditions) {
            const id = typeof expedition.id === 'string' ? expedition.id : '';
            if (id.length > 0) merged.set(id, expedition);
        }
        for (const [id, entry] of this.expeditionEventCache) {
            const age = now - entry.at;
            const messages = Array.isArray(entry.value.messages) ? entry.value.messages : [];
            const status = typeof entry.value.status === 'string' ? entry.value.status.toUpperCase() : '';
            const recentlyActive = age <= 2 * 60_000
                && !status.includes('COMPLETE')
                && !status.includes('READY')
                && !status.includes('FAILED')
                && !status.includes('EXPIRED');
            const hasDecision = messages.some((message) =>
                !!message && typeof message === 'object'
                && (Array.isArray((message as { decisionOptions?: unknown }).decisionOptions)
                    || Array.isArray((message as { options?: unknown }).options)));
            if (!recentlyActive && !(hasDecision && age <= 10 * 60_000)) continue;
            const existing = merged.get(id);
            if (!existing) {
                merged.set(id, entry.value);
                continue;
            }
            const existingMessages = Array.isArray(existing.messages) ? existing.messages : [];
            if (hasDecision && existingMessages.length === 0) {
                merged.set(id, { ...existing, messages: entry.value.messages });
            }
        }
        const decisionMap = new Map<string, unknown>();
        for (const decision of decisions) {
            if (!decision || typeof decision !== 'object') continue;
            const entry = decision as { id?: unknown; messageId?: unknown; expeditionId?: unknown };
            const id = typeof entry.id === 'string' ? entry.id : typeof entry.messageId === 'string' ? entry.messageId : '';
            if (id.length === 0) continue;
            decisionMap.set(`${typeof entry.expeditionId === 'string' ? entry.expeditionId : ''}:${id}`, decision);
        }
        for (const cached of this.expeditionDecisionCache) {
            if (now - cached.at > 10 * 60_000) continue;
            const entry = cached.value as { id?: unknown; messageId?: unknown; expeditionId?: unknown };
            const id = typeof entry.id === 'string' ? entry.id : typeof entry.messageId === 'string' ? entry.messageId : '';
            if (id.length === 0) continue;
            const key = `${typeof entry.expeditionId === 'string' ? entry.expeditionId : ''}:${id}`;
            if (!decisionMap.has(key)) decisionMap.set(key, cached.value);
        }
        return { expeditions: [...merged.values()], decisions: [...decisionMap.values()] };
    }

    private clearExpeditionFallback(): void {
        if (this.pendingExpeditionsFallbackTimer !== null) {
            window.clearTimeout(this.pendingExpeditionsFallbackTimer);
            this.pendingExpeditionsFallbackTimer = null;
        }
        this.pendingExpeditionsFallback = null;
    }

    private requestExpeditionsActive(timeoutMs = 20000): Promise<Result<unknown, GameError>> {
        if (this.expeditionsReadPromise) return this.expeditionsReadPromise;
        const pending = this.readExpeditionsActive(timeoutMs);
        this.expeditionsReadPromise = pending;
        return pending.finally(() => {
            if (this.expeditionsReadPromise === pending) this.expeditionsReadPromise = null;
        });
    }

    private async readExpeditionsActive(timeoutMs = 20000): Promise<Result<unknown, GameError>> {
        if (!this.token) return err({ code: 'AUTH_REQUIRED', message: 'No game bearer token captured yet' });
        if (this.pendingExpeditions) return err({ code: 'EXPEDITION_BUSY', message: 'An expedition request is already pending' });
        if (!(await this.waitForActiveSocket(4000))) return err({ code: 'GAME_NO_SOCKET', message: 'No game WebSocket is available' });
        return new Promise<GameResponse>((resolve, reject) => {
            this.clearExpeditionFallback();
            const timer = window.setTimeout(() => {
                this.pendingExpeditions = null;
                this.clearExpeditionFallback();
                reject(new Error('Timed out waiting for expedition data'));
            }, timeoutMs);
            this.pendingExpeditions = { resolve, reject, timer };
            const joined = this.joinRoom('expeditions');
            if (!joined.ok) {
                window.clearTimeout(timer);
                this.pendingExpeditions = null;
                reject(new Error(joined.error.message));
                return;
            }
            if (!this.sendWithoutData('expeditions', 'get.active', timeoutMs)) {
                window.clearTimeout(timer);
                this.pendingExpeditions = null;
                reject(new Error('No game WebSocket is available'));
            }
        }).then((response) => {
            if (response.error) return err(gameError(response.error, 'GAME_EXPEDITION_FAILED'));
            const snapshot = collectExpeditionObjects(response.data);
            const decisions = collectDecisionObjects(response.data);
            return ok(this.mergeExpeditionEvents(snapshot, decisions));
        }).catch((error: unknown) => {
            this.clearExpeditionFallback();
            return err({
                code: 'EXPEDITION_TIMEOUT',
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }

    async expeditionAction(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const actions: Record<string, { action: string; timeoutMs: number }> = {
            getActive: { action: 'get.active', timeoutMs: 20000 },
            getArchived: { action: 'get.archived', timeoutMs: 20000 },
            getMercenaries: { action: 'get.mercenaries', timeoutMs: 20000 },
            getConfig: { action: 'get.config', timeoutMs: 20000 },
            configure: { action: 'configure', timeoutMs: 15000 },
            launch: { action: 'launch', timeoutMs: 20000 },
            openContainer: { action: 'open.container', timeoutMs: 20000 },
            respondEvent: { action: 'respond.event', timeoutMs: 15000 },
        };
        const entry = actions[kind];
        if (!entry) return err({ code: 'GAME_UNKNOWN_ACTION', message: `Unknown expedition action: ${kind}` });
        if (kind === 'getActive') return this.requestExpeditionsActive(entry.timeoutMs);
        const response = await this.request('expeditions', entry.action, payload, entry.timeoutMs).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_EXPEDITION_FAILED'));
        if (kind === 'respondEvent') {
            const expeditionId = typeof payload.expeditionId === 'string' ? payload.expeditionId : '';
            const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';
            if (messageId.length > 0) this.clearExpeditionDecision(expeditionId, messageId);
        }
        return ok(response.data);
    }

    latestDroneEvent(): unknown {
        return this.lastDroneEvent;
    }

    clearDroneEvent(): void {
        this.lastDroneEvent = null;
    }

    latestMinigameLock(): number | null {
        if (!this.minigameLock) return null;
        if (this.minigameLock.lockExpiresAt <= Date.now()) {
            this.minigameLock = null;
            return null;
        }
        return this.minigameLock.lockExpiresAt;
    }

    clearMinigameLock(): void {
        this.minigameLock = null;
    }

    latestDroneCompleted(): unknown {
        return this.lastDroneCompleted;
    }

    clearDroneCompleted(): void {
        this.lastDroneCompleted = null;
    }

    async droneAction(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const actions: Record<string, { action: string; timeoutMs: number }> = {
            getOptions: { action: 'get.options', timeoutMs: 20000 },
            getArchived: { action: 'get.archived', timeoutMs: 20000 },
            launch: { action: 'launch', timeoutMs: 20000 },
            resolveEvent: { action: 'resolve.event', timeoutMs: 15000 },
            repair: { action: 'repair', timeoutMs: 20000 },
            getEvent: { action: 'get.event', timeoutMs: 1000 },
        };
        const entry = actions[kind];
        if (!entry) return err({ code: 'GAME_UNKNOWN_ACTION', message: `Unknown drone action: ${kind}` });
        const response = await this.request('drone-missions', entry.action, payload, entry.timeoutMs).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_DRONE_FAILED'));
        return ok(response.data);
    }

    async getDailyOps(): Promise<Result<unknown, GameError>> {
        return this.authenticatedJson('https://svc-corie.cor3.gg/api/user-daily-claim');
    }

    async getDailyRewards(): Promise<Result<unknown, GameError>> {
        return this.authenticatedJson('https://svc-corie.cor3.gg/api/user-daily-claim/rewards');
    }

    private async authenticatedJson(url: string): Promise<Result<unknown, GameError>> {
        if (!this.token) return err({ code: 'AUTH_REQUIRED', message: 'No game bearer token captured yet' });
        if (this.tokenExpiresAt !== null && this.tokenExpiresAt <= Date.now()) {
            return err({ code: 'AUTH_EXPIRED', message: 'Captured bearer token has expired' });
        }
        try {
            const response = await fetch(url, { headers: { Authorization: this.token } });
            if (!response.ok) return err({ code: 'HTTP_FAILED', message: `HTTP ${response.status}` });
            return ok(await response.json());
        } catch (error) {
            return err({ code: 'HTTP_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    async getMail(timeoutMs = 15000): Promise<Result<unknown, GameError>> {
        if (!this.token) return err({ code: 'AUTH_REQUIRED', message: 'No game bearer token captured yet' });
        if (this.pendingMail) return err({ code: 'MAIL_BUSY', message: 'A mail request is already pending' });
        // Mail lives in its own socket room in the current game client, not in
        // the stash room. The game also supports an explicit `mail get.state`
        // command, which is more reliable than waiting for an unsolicited push.
        this.leaveRoom('mail', true);
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        const joined = this.joinRoom('mail');
        if (!joined.ok) return joined;
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                if (this.pendingMail?.timer !== timer) return;
                this.pendingMail = null;
                // Last resort: a previously pushed state is still better than
                // failing auto-collect when the server ignores get.state.
                if (this.lastMailState !== null) resolve(this.lastMailState);
                else reject(new Error('Timed out waiting for mail data'));
            }, timeoutMs);
            this.pendingMail = { resolve, reject, timer };
            // Explicit state request; the response is a `mail get.state` event
            // with `data.messages`.
            this.notifyHost('debug', 'Requesting mail state', { room: 'mail' });
            this.send('mail', 'get.state', {}, timeoutMs);
        }).then((mail) => ok(mail)).catch((error: unknown) => err({
            code: 'MAIL_TIMEOUT',
            message: error instanceof Error ? error.message : String(error),
        }));
    }

    async claimMailAll(messageId: string): Promise<Result<void, GameError>> {
        return this.mailCommand('claim.all', { messageId });
    }

    async claimMailItem(attachmentId: string, x: number, y: number, rotated: boolean): Promise<Result<void, GameError>> {
        return this.mailCommand('claim.item', { attachmentId, placement: { x, y, rotated } });
    }

    private async mailCommand(action: string, data: Record<string, unknown>): Promise<Result<void, GameError>> {
        const response = await this.request('mail', action, data, 15000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_MAIL_FAILED'));
        return ok(undefined);
    }

    async sellStashItem(itemId: string, quantity: number): Promise<Result<void, GameError>> {
        const response = await this.request('stash', 'sell.item', { itemId, quantity }, 12000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_STASH_SELL_FAILED'));
        return ok(undefined);
    }

    async moveStashItem(move: { readonly itemId: string; readonly location: 'stash' | 'sorting_table'; readonly x: number; readonly y: number; readonly rotated: boolean }): Promise<Result<void, GameError>> {
        const response = await this.request('stash', 'move.item', move, 12000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_STASH_MOVE_FAILED'));
        return ok(undefined);
    }

    private joinRoom(room: string): Result<void, GameError> {
        const token = this.token;
        if (!token) return err({ code: 'AUTH_REQUIRED', message: 'No game bearer token captured yet' });
        const data: Record<string, unknown> = { room, jwtToken: token.replace(/^Bearer\s+/i, '') };
        const version = (window as Window & { __cor3WebVersion?: unknown }).__cor3WebVersion;
        if (typeof version === 'string') data.clientVersion = version;
        if (!this.sendFrame(`42["join-room",${JSON.stringify(data)}]`)) {
            return err({ code: 'GAME_NO_SOCKET', message: 'No game WebSocket is available' });
        }
        this.joinedRooms.add(room);
        return ok(undefined);
    }

    private leaveRoom(room: string, force = false): void {
        if (!force && !this.joinedRooms.has(room)) return;
        this.sendFrame(`42["leave-room",{"room":${JSON.stringify(room)}}]`);
        this.joinedRooms.delete(room);
    }

    private captureHeaders(headers: HeadersInit | undefined): void {
        if (!headers) return;
        if (headers instanceof Headers) {
            const value = headers.get('Authorization') ?? headers.get('authorization');
            if (value) this.captureToken(value);
            return;
        }
        if (Array.isArray(headers)) {
            for (const [name, value] of headers) if (name.toLowerCase() === 'authorization') this.captureToken(value);
            return;
        }
        for (const [name, value] of Object.entries(headers)) if (name.toLowerCase() === 'authorization') this.captureToken(String(value));
    }

    private captureToken(value: unknown): void {
        if (typeof value === 'string' && value.toLowerCase().startsWith('bearer ')) {
            this.token = value;
            this.tokenExpiresAt = decodeJwtExpiry(value);
            const authenticated = this.tokenExpiresAt === null || this.tokenExpiresAt > Date.now();
            if (authenticated !== this.authenticated) {
                this.authenticated = authenticated;
                this.notifyReadiness();
            }
        }
    }

    private inspectOutgoing(data: unknown): void {
        if (typeof data !== 'string') return;
        if (data.startsWith('40{')) {
            try {
                const payload = JSON.parse(data.substring(2)) as { token?: unknown };
                this.captureToken(payload.token);
            } catch {
                // Ignore malformed connect payloads.
            }
            return;
        }
        const market = parseOutgoingMarketRequest(data);
        if (market) {
            // The game's own market refresh uses the same frames as the helper.
            // Remember which market is loading so its responses can update the
            // Auto Jobs snapshot as well.
            this.pendingMarketActions.set(market.action, {
                marketId: market.marketId,
                expiresAt: Date.now() + 20_000,
            });
        }
    }

    private sendFrame(frame: string): boolean {
        return this.enqueueFrame('room', 'frame', frame, false, DEFAULT_FRAME_DEADLINE_MS);
    }

    private activeGameSocket(): WebSocket | null {
        if (this.active && this.active.readyState === WebSocket.OPEN) {
            const record = this.sockets.get(this.active);
            if (record && !record.minigame) return this.active;
        }
        const selected = pickActiveSocket(this.sockets.values())?.ws ?? null;
        if (selected && selected !== this.active) this.setActive(selected);
        return selected;
    }

    private setActive(ws: WebSocket | null): void {
        if (this.active === ws) return;
        const previousUrl = sanitizeSocketUrl(this.active ? this.sockets.get(this.active)?.url ?? null : null);
        this.active = ws;
        const nextUrl = sanitizeSocketUrl(ws ? this.sockets.get(ws)?.url ?? null : null);
        const now = Date.now();
        if (previousUrl !== nextUrl && now - this.lastActiveNoticeAt >= 2_000) {
            this.lastActiveNoticeAt = now;
            this.notifyHost('info', 'Active game socket changed', { from: previousUrl, to: nextUrl });
        }
    }

    private hasOpenGameSocket(): boolean {
        for (const [ws, record] of this.sockets) {
            if (!record.minigame && ws.readyState === WebSocket.OPEN) return true;
        }
        return false;
    }

    private scheduleFlush(delayMs: number): void {
        if (this.sendTimer !== null) return;
        this.sendTimer = window.setTimeout(() => {
            this.sendTimer = null;
            this.flushSendQueue();
        }, Math.max(0, delayMs));
    }

    private dropQueued(event: string, action: string): void {
        const key = `${event}:${action}`;
        const before = this.sendQueue.length;
        this.sendQueue = this.sendQueue.filter((frame) => `${frame.event}:${frame.action}` !== key);
        if (this.sendQueue.length !== before) {
            this.notifyHost('debug', 'Dropped queued command after timeout', { key, dropped: before - this.sendQueue.length });
        }
    }

    private enqueueFrame(event: string, action: string, frame: string, networkMap: boolean, deadlineMs: number): boolean {
        const socket = this.activeGameSocket();
        if (!socket) {
            this.notifyHost('warn', 'No open game socket for command', { event, action });
            return false;
        }
        while (this.sendQueue.length >= MAX_QUEUED_FRAMES) {
            const dropped = this.sendQueue.shift();
            if (dropped) this.notifyHost('warn', 'WebSocket send queue overflow', { dropped: `${dropped.event}:${dropped.action}` });
        }
        this.sendQueue.push({ event, action, frame, networkMap, deadline: Date.now() + Math.max(1_000, deadlineMs) });
        this.flushSendQueue();
        return true;
    }

    private flushSendQueue(): void {
        if (this.sendTimer !== null) return;
        const now = Date.now();
        while (this.sendQueue[0] && this.sendQueue[0].deadline < now) {
            const expired = this.sendQueue.shift();
            if (expired) this.notifyHost('debug', 'Dropped expired queued command', { key: `${expired.event}:${expired.action}` });
        }
        const next = this.sendQueue[0];
        if (!next) return;
        const socket = this.activeGameSocket();
        if (!socket) {
            // Keep the frame alive for a short while so a reconnecting game
            // socket can still receive it, but never past its deadline.
            this.scheduleFlush(QUEUE_RETRY_MS);
            return;
        }
        let readyAt = this.lastSendAt + MIN_SEND_INTERVAL_MS;
        if (next.networkMap) readyAt = Math.max(readyAt, this.lastNetworkMapSendAt + NETWORK_MAP_SEND_INTERVAL_MS);
        if (this.rateLimitedUntil > readyAt) readyAt = this.rateLimitedUntil;
        const wait = readyAt - now;
        if (wait > 0) {
            this.scheduleFlush(wait);
            return;
        }
        const codec = window.__cor3MsgpackCodec;
        const payload = codec?.isReady() ? codec.stringToPacketBuffer(next.frame) : null;
        try {
            socket.send(payload ?? next.frame);
        } catch (error) {
            this.notifyHost('warn', 'WebSocket send failed', {
                url: sanitizeSocketUrl(this.sockets.get(socket)?.url ?? null),
                message: error instanceof Error ? error.message : String(error),
            });
            this.active = null;
            this.scheduleFlush(500);
            return;
        }
        this.lastSendAt = now;
        if (next.networkMap) this.lastNetworkMapSendAt = now;
        this.recordFrame('out', next.event, next.action, next.frame, sanitizeSocketUrl(this.sockets.get(socket)?.url ?? null));
        this.sendQueue.shift();
        this.flushSendQueue();
    }

    private noteRateLimit(): void {
        const now = Date.now();
        if (now - this.lastRateLimitAt > RATE_LIMIT_STRIKE_WINDOW_MS) this.rateLimitStrikes = 0;
        this.lastRateLimitAt = now;
        this.rateLimitStrikes = Math.min(4, this.rateLimitStrikes + 1);
        const cooldown = Math.min(
            RATE_LIMIT_MAX_COOLDOWN_MS,
            RATE_LIMIT_COOLDOWN_MS * 2 ** (this.rateLimitStrikes - 1),
        );
        this.rateLimitedUntil = Math.max(this.rateLimitedUntil, now + cooldown);
        this.notifyHost('warn', 'Game server rate limit', { cooldownMs: cooldown, strikes: this.rateLimitStrikes });
        if (this.sendTimer !== null) {
            window.clearTimeout(this.sendTimer);
            this.sendTimer = null;
        }
        this.flushSendQueue();
    }

    private notifyHost(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
        try {
            window.postMessage({ version: 2, type: 'V2_WS_NOTICE', level, message, ...(data !== undefined ? { data } : {}) }, '*');
        } catch {
            // The page may be tearing down.
        }
    }

    activeSocketUrl(): string | null {
        return sanitizeSocketUrl(this.active ? this.sockets.get(this.active)?.url ?? null : null);
    }

    private handleAuthExpiry(): void {
        const now = Date.now();
        if (now - this.lastAuthReconnectAt < 5_000) return;
        this.lastAuthReconnectAt = now;
        this.notifyHost('warn', 'Token expired; closing game sockets to force reconnect', { sockets: this.sockets.size });
        this.tokenExpiresAt = 0;
        this.authenticated = false;
        for (const [ws, record] of this.sockets) {
            if (record.minigame) continue;
            try { ws.close(); } catch { /* ignore */ }
        }
        this.active = null;
        this.socketOpen = false;
        this.mapLoadedAt = null;
        this.readyAt = null;
        this.notifyReadiness();
    }

    connectIp(ip: string): boolean {
        return this.send('network-map', 'connect.ip', { ipAddress: ip });
    }

    async setEndpoint(serverId: string): Promise<Result<void, GameError>> {
        const response = await this.request('network-map', 'set.endpoint', { serverId }, 12000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_SET_ENDPOINT_FAILED'));
        return ok(undefined);
    }

    async getLoginStatus(serverId: string): Promise<Result<unknown, GameError>> {
        const response = await this.request('sai', 'get.login.status', { serverId }, 10000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_LOGIN_STATUS_FAILED'));
        return ok(response.data);
    }

    async hackStart(serverId: string): Promise<Result<{ readonly autoHacked: boolean }, GameError>> {
        const response = await this.request('sai', 'hack.start', { serverId }, 30000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_HACK_FAILED'));
        const data = response.data as { autoHacked?: unknown } | null;
        return ok({ autoHacked: data?.autoHacked === true });
    }

    async loginWithAccess(serverId: string, accessGrantId: string): Promise<Result<void, GameError>> {
        const response = await this.request('sai', 'login.with-access', { serverId, accessGrantId }, 10000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_LOGIN_FAILED'));
        return ok(undefined);
    }

    async takeJob(marketId: string, jobId: string): Promise<Result<unknown, GameError>> {
        return this.jobCommand('job.take', marketId, jobId);
    }

    async completeJob(marketId: string, jobId: string): Promise<Result<unknown, GameError>> {
        return this.jobCommand('job.complete', marketId, jobId);
    }

    async dismissJob(marketId: string, jobId: string): Promise<Result<unknown, GameError>> {
        return this.jobCommand('job.dismiss', marketId, jobId);
    }

    private parseDesktopPolling(text: string): void {
        let start = 0;
        while (start < text.length) {
            const marker = text.indexOf('42["desktop"', start);
            if (marker < 0) return;
            const jsonStart = marker + 2;
            let depth = 0;
            let inString = false;
            let escape = false;
            let end = -1;
            for (let index = jsonStart; index < text.length; index++) {
                const char = text[index];
                if (escape) { escape = false; continue; }
                if (char === '\\' && inString) { escape = true; continue; }
                if (char === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (char === '[' || char === '{') depth++;
                else if (char === ']' || char === '}') {
                    depth--;
                    if (depth === 0) { end = index + 1; break; }
                }
            }
            if (end > jsonStart) {
                try {
                    const parsed = JSON.parse(text.slice(jsonStart, end)) as unknown[];
                    const payload = parsed[1] as { event?: { action?: string }; data?: unknown } | undefined;
                    if (payload?.event?.action === 'get.options' && payload.data) this.desktopOptions = payload.data;
                } catch {
                    // ignore malformed polling frames
                }
            }
            start = marker + 1;
        }
    }

    private async jobCommand(action: string, marketId: string, jobId: string): Promise<Result<unknown, GameError>> {
        const response = await this.request('market', action, { marketId, jobId }, 15000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_JOB_FAILED'));
        return ok(response.data);
    }

    async jobAction(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const actions: Record<string, { event: string; action: string }> = {
            getFiles: { event: 'sai', action: 'get.files' },
            deleteFile: { event: 'sai', action: 'file.delete' },
            getLogs: { event: 'sai', action: 'get.logs' },
            deleteLog: { event: 'sai', action: 'log.delete' },
            downloadLog: { event: 'sai', action: 'log.download' },
            downloadFile: { event: 'sai', action: 'file.download' },
            getDesktopOptions: { event: 'desktop', action: 'get.options' },
            openFolder: { event: 'desktop', action: 'open.folder' },
            getFileAnalysis: { event: 'desktop', action: 'get.file.analysis' },
            decryptFile: { event: 'desktop', action: 'decrypt.file' },
            getTransit: { event: 'sai', action: 'get.transit' },
            addTransit: { event: 'sai', action: 'transit.add' },
            removeTransit: { event: 'sai', action: 'transit.remove' },
            uploadFile: { event: 'sai', action: 'file.upload' },
        };
        const action = actions[kind];
        if (!action) return err({ code: 'GAME_UNKNOWN_ACTION', message: `Unknown job action: ${kind}` });
        if (kind === 'getDesktopOptions' && this.desktopOptions) return ok(this.desktopOptions);
        const response = await this.request(action.event, action.action, payload, 15000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) {
            if (kind === 'getDesktopOptions' && this.desktopOptions) return ok(this.desktopOptions);
            return err(gameError(response.error, 'GAME_JOB_ACTION_FAILED'));
        }
        if (kind === 'getDesktopOptions') this.desktopOptions = response.data;
        return ok(response.data);
    }

    async valuableAction(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const actions: Record<string, { event: string; action: string; timeoutMs: number }> = {
            searchFiles: { event: 'sai', action: 'file.search-valuable', timeoutMs: 40000 },
            searchLogs: { event: 'sai', action: 'log.search-valuable', timeoutMs: 40000 },
            getFiles: { event: 'sai', action: 'get.files', timeoutMs: 15000 },
            getLogs: { event: 'sai', action: 'get.logs', timeoutMs: 15000 },
            downloadFile: { event: 'sai', action: 'file.download', timeoutMs: 40000 },
            downloadLog: { event: 'sai', action: 'log.download', timeoutMs: 40000 },
            getSellableItems: { event: 'market', action: 'get.sellable-items', timeoutMs: 20000 },
            sellItems: { event: 'market', action: 'sell.items', timeoutMs: 20000 },
        };
        const action = actions[kind];
        if (!action) return err({ code: 'GAME_UNKNOWN_ACTION', message: `Unknown valuable action: ${kind}` });
        const response = await this.request(action.event, action.action, payload, action.timeoutMs).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_VALUABLE_ACTION_FAILED'));
        return ok(response.data);
    }

    async getLoadout(): Promise<Result<unknown, GameError>> {
        const response = await this.request('loadout', 'get.options', {}, 35_000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_LOADOUT_FAILED'));
        return ok(response.data);
    }

    async equipHardware(moduleConfigId: string): Promise<Result<void, GameError>> {
        return this.loadoutCommand('equip.hardware', moduleConfigId);
    }

    async equipSoftware(moduleConfigId: string): Promise<Result<void, GameError>> {
        return this.loadoutCommand('equip.software', moduleConfigId);
    }

    async unequipSoftware(moduleConfigId: string): Promise<Result<void, GameError>> {
        return this.loadoutCommand('unequip.software', moduleConfigId);
    }

    private async loadoutCommand(action: string, moduleConfigId: string): Promise<Result<void, GameError>> {
        const response = await this.request('loadout', action, { moduleConfigId }, 10000).catch((error) => error);
        if (response instanceof Error) return err({ code: 'GAME_TIMEOUT', message: response.message });
        if (response.error) return err(gameError(response.error, 'GAME_LOADOUT_COMMAND_FAILED'));
        return ok(undefined);
    }

    async requestMarketOptions(marketId: string): Promise<Result<unknown, GameError>> {
        this.pendingMarketActions.set('get.options', { marketId, expiresAt: Date.now() + 45_000 });
        const response = await this.request('market', 'get.options', { marketId }, 35_000).catch((error) => error);
        if (response instanceof Error) {
            this.pendingMarketActions.delete('get.options');
            return err({ code: 'GAME_TIMEOUT', message: response.message });
        }
        if (response.error) {
            this.pendingMarketActions.delete('get.options');
            return err(gameError(response.error, 'GAME_MARKET_FAILED'));
        }
        return ok(response.data);
    }

    async requestMarketLots(marketId: string): Promise<Result<unknown, GameError>> {
        this.pendingMarketActions.set('get.lots', { marketId, expiresAt: Date.now() + 45_000 });
        const response = await this.request('market', 'get.lots', { marketId }, 35_000).catch((error) => error);
        if (response instanceof Error) {
            this.pendingMarketActions.delete('get.lots');
            return err({ code: 'GAME_TIMEOUT', message: response.message });
        }
        if (response.error) {
            this.pendingMarketActions.delete('get.lots');
            return err(gameError(response.error, 'GAME_MARKET_FAILED'));
        }
        return ok(response.data);
    }

    async requestMarketJobs(marketId: string): Promise<Result<unknown, GameError>> {
        this.pendingMarketActions.set('get.jobs', { marketId, expiresAt: Date.now() + 45_000 });
        const response = await this.request('market', 'get.jobs', { marketId }, 35_000).catch((error) => error);
        if (response instanceof Error) {
            this.pendingMarketActions.delete('get.jobs');
            return err({ code: 'GAME_TIMEOUT', message: response.message });
        }
        if (response.error) {
            this.pendingMarketActions.delete('get.jobs');
            return err(gameError(response.error, 'GAME_MARKET_FAILED'));
        }
        return ok(response.data);
    }

    async requestMap(timeoutMs = 10000): Promise<RawNetworkMap> {
        if (this.pendingMapPromise) return this.pendingMapPromise;
        const startedAt = Date.now();
        const promise = (async () => {
            if (!(await this.waitForActiveSocket(4000))) throw new Error('No game WebSocket is available');
            return new Promise<RawNetworkMap>((resolve, reject) => {
                const timer = window.setTimeout(() => {
                    this.pendingMap = null;
                    this.dropQueued('network-map', 'get.map');
                    this.notifyHost('warn', 'get.map failed', {
                        reason: 'timeout',
                        durationMs: Date.now() - startedAt,
                        socketUrl: this.activeSocketUrl(),
                    });
                    reject(new Error('Timed out waiting for get.map'));
                }, timeoutMs);
                this.pendingMap = {
                    resolve: (map) => {
                        this.notifyHost('debug', 'get.map ok', {
                            durationMs: Date.now() - startedAt,
                            socketUrl: this.activeSocketUrl(),
                        });
                        resolve(map);
                    },
                    reject,
                    timer,
                };
                if (!this.send('network-map', 'get.map', {}, timeoutMs)) {
                    window.clearTimeout(timer);
                    this.pendingMap = null;
                    reject(new Error('No game WebSocket is available'));
                }
            });
        })();
        this.pendingMapPromise = promise;
        return promise.finally(() => {
            if (this.pendingMapPromise === promise) this.pendingMapPromise = null;
        });
    }

    wsLogs(limit = 200): readonly WsLogEntry[] {
        return this.frameLog.slice(-limit);
    }

    clearWsLogs(): void {
        this.frameLog.splice(0, this.frameLog.length);
    }

    sendRawFrame(frame: string): Result<void, GameError> {
        if (!frame.trim()) return err({ code: 'INVALID_FRAME', message: 'WebSocket frame is empty' });
        if (!this.sendFrame(frame)) return err({ code: 'GAME_NO_SOCKET', message: 'No game WebSocket is available' });
        return ok(undefined);
    }

    private recordFrame(direction: 'in' | 'out', event: string, action: string, text: string, socketUrl: string | null): void {
        this.frameLog.push({
            at: Date.now(),
            direction,
            event,
            action,
            text: redactFrameText(text).slice(0, 2000),
            ...(socketUrl ? { socketUrl } : {}),
        });
        if (this.frameLog.length > 400) this.frameLog.splice(0, this.frameLog.length - 400);
    }

    private request(event: string, action: string, data: unknown, timeoutMs: number): Promise<GameResponse> {
        const key = `${event}:${action}`;
        const previous = this.requestChains.get(key);
        const next = (previous ? previous.then(() => undefined, () => undefined) : Promise.resolve())
            .then(() => this.performRequest(event, action, data, timeoutMs));
        let tracked: Promise<GameResponse>;
        tracked = next.finally(() => {
            if (this.requestChains.get(key) === tracked) this.requestChains.delete(key);
        });
        this.requestChains.set(key, tracked);
        return tracked;
    }

    private async performRequest(event: string, action: string, data: unknown, timeoutMs: number): Promise<GameResponse> {
        const key = `${event}:${action}`;
        if (this.pendingRequests.has(key)) throw new Error(`Request already pending: ${key}`);
        if (!(await this.waitForActiveSocket(4000))) throw new Error('No game WebSocket is available');
        return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
                this.pendingRequests.delete(key);
                this.dropQueued(event, action);
                reject(new Error(`Timed out waiting for ${key}`));
            }, timeoutMs);
            this.pendingRequests.set(key, { resolve, reject, timer });
            if (!this.send(event, action, data, timeoutMs)) {
                window.clearTimeout(timer);
                this.pendingRequests.delete(key);
                reject(new Error('No game WebSocket is available'));
            }
        });
    }

    private async waitForActiveSocket(timeoutMs: number): Promise<boolean> {
        if (this.activeGameSocket()) return true;
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            if (this.activeGameSocket()) return true;
        }
        return false;
    }

    private track(ws: WebSocket, url: string): void {
        const minigame = isMinigameSocketUrl(url);
        const record: SocketRecord = {
            ws,
            url,
            minigame,
            lastActivityAt: Date.now(),
            readyState: ws.readyState,
        };
        this.sockets.set(ws, record);
        if (minigame) this.notifyHost('info', 'Tracking minigame socket (excluded from active)', { url: sanitizeSocketUrl(url) });
        ws.addEventListener('open', () => {
            record.lastActivityAt = Date.now();
            record.readyState = WebSocket.OPEN;
            if (minigame) return;
            this.socketOpen = true;
            if (!this.active || this.active.readyState !== WebSocket.OPEN) {
                this.setActive(ws);
                this.mapLoadedAt = null;
                this.readyAt = null;
            }
            this.notifyHost('info', 'Game socket opened', { url: sanitizeSocketUrl(url) });
            this.notifyReadiness();
        });
        if (ws.readyState === WebSocket.OPEN) {
            record.readyState = WebSocket.OPEN;
            if (!minigame) {
                this.socketOpen = true;
                if (!this.active) this.setActive(ws);
            }
        }
        const originalSend = ws.send.bind(ws);
        ws.send = ((data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
            this.inspectOutgoing(data);
            return originalSend(data as string | Blob | BufferSource);
        }) as typeof ws.send;
        ws.addEventListener('message', (event) => {
            record.lastActivityAt = Date.now();
            if (!minigame) this.setActive(ws);
            void this.handleIncoming(event.data, ws);
        });
        ws.addEventListener('close', () => {
            const wasActive = this.active === ws;
            record.readyState = WebSocket.CLOSED;
            this.sockets.delete(ws);
            if (wasActive) this.active = null;
            const next = pickActiveSocket(this.sockets.values())?.ws ?? null;
            if (next) this.setActive(next);
            this.socketOpen = this.hasOpenGameSocket();
            if (this.active === null) {
                this.mapLoadedAt = null;
                this.readyAt = null;
            }
            if (!minigame && wasActive && this.saiFiles.length > 0) this.setSaiFiles([]);
            if (!minigame) this.notifyHost('info', 'Game socket closed', { url: sanitizeSocketUrl(url), remaining: this.sockets.size });
            this.notifyReadiness();
        });
    }

    private send(name: string, action: string, data: unknown, deadlineMs = DEFAULT_FRAME_DEADLINE_MS): boolean {
        const frame = `42${JSON.stringify(['event', { event: { name, action }, data }])}`;
        return this.enqueueFrame(name, action, frame, name === 'network-map', deadlineMs);
    }

    private sendWithoutData(name: string, action: string, deadlineMs = DEFAULT_FRAME_DEADLINE_MS): boolean {
        const frame = `42${JSON.stringify(['event', { event: { name, action } }])}`;
        return this.enqueueFrame(name, action, frame, name === 'network-map', deadlineMs);
    }

    private async handleIncoming(raw: unknown, ws: WebSocket): Promise<void> {
        const text = await this.decode(raw);
        if (!text || !text.startsWith('42')) return;
        let parsed: unknown;
        try { parsed = JSON.parse(text.substring(2)); } catch { return; }
        if (!Array.isArray(parsed) || parsed.length < 2) return;
        const eventName = parsed[0];
        const payload = parsed[1] as { event?: { action?: string }; data?: unknown; error?: unknown; message?: unknown };
        this.recordFrame('in', String(eventName), payload?.event?.action ?? '', text, sanitizeSocketUrl(this.sockets.get(ws)?.url ?? null));
        if (eventName === 'error') {
            const errorText = payloadErrorMessage(payload.error ?? payload.message ?? payload.data, '');
            if (/token[-\s]?expired|invalid-access-token|unauthori[sz]ed/i.test(errorText)) {
                this.handleAuthExpiry();
                return;
            }
        }
        if (isRateLimitError(payload?.error) || isRateLimitError(payload?.data)) this.noteRateLimit();
        if (eventName === 'stash' && this.pendingStash) {
            // The stash push may carry an event.action depending on the game
            // build. Resolve on any stash payload that has data, otherwise the
            // warehouse view times out even though the server answered.
            if (payload?.data !== undefined && looksLikeStash(payload.data)) {
                const pending = this.pendingStash;
                this.pendingStash = null;
                window.clearTimeout(pending.timer);
                pending.resolve(payload.data);
            } else if (payload?.error !== undefined) {
                const pending = this.pendingStash;
                this.pendingStash = null;
                window.clearTimeout(pending.timer);
                pending.reject(new Error(typeof payload.error === 'object' && payload.error && 'message' in payload.error
                    ? String((payload.error as { message?: unknown }).message)
                    : 'Stash request failed'));
            }
        }
        if (eventName === 'mail') {
            const action = payload?.event?.action;
            const isStatePush = action === undefined || action === 'update.state' || action === 'get.state';
            if (isStatePush && payload?.data !== undefined && looksLikeMailState(payload.data)) {
                this.lastMailState = payload.data;
                const record = payload.data as { messages?: unknown };
                this.notifyHost('debug', 'Mail state received', {
                    action: action ?? 'push',
                    messages: Array.isArray(record.messages) ? record.messages.length : 'wrapped',
                });
                if (this.pendingMail) {
                    const pending = this.pendingMail;
                    this.pendingMail = null;
                    window.clearTimeout(pending.timer);
                    pending.resolve(payload.data);
                }
            } else if (isStatePush && payload?.error !== undefined && this.pendingMail) {
                const pending = this.pendingMail;
                this.pendingMail = null;
                window.clearTimeout(pending.timer);
                pending.reject(new Error(typeof payload.error === 'object' && payload.error && 'message' in payload.error
                    ? String((payload.error as { message?: unknown }).message)
                    : 'Mail request failed'));
            }
        }
        const action = payload?.event?.action;
        if (eventName === 'sai') this.handleSaiEvent(action, payload.data);
        if (eventName === 'expeditions'
            && action !== 'get.mercenaries'
            && action !== 'get.config'
            && action !== 'configure'
            && action !== 'get.archived'
            && action !== 'get.active'
            && payload.data !== undefined) {
            this.rememberExpeditionData(payload.data);
        }
        if (eventName === 'expeditions' && this.pendingExpeditions) {
            const isExplicitActiveResponse = action === 'get.active';
            const isRoomPush = action === undefined && payload.data !== undefined && looksLikeExpeditionData(payload.data);
            if (isExplicitActiveResponse || payload.error !== undefined) {
                const pending = this.pendingExpeditions;
                const fallback = this.pendingExpeditionsFallback;
                const preferFallback = payload.error === undefined
                    && expeditionDataEmpty(payload.data)
                    && fallback?.data !== undefined
                    && !expeditionDataEmpty(fallback.data);
                this.pendingExpeditions = null;
                window.clearTimeout(pending.timer);
                this.clearExpeditionFallback();
                pending.resolve(preferFallback && fallback
                    ? { data: fallback.data, error: fallback.error }
                    : { data: payload.data, error: payload.error });
            } else if (isRoomPush) {
                // A room push can arrive before the explicit get.active reply and may
                // be a partial update. Keep it as a fallback and give the explicit
                // reply a short window to win.
                this.pendingExpeditionsFallback = { data: payload.data };
                if (this.pendingExpeditionsFallbackTimer === null) {
                    this.pendingExpeditionsFallbackTimer = window.setTimeout(() => {
                        this.pendingExpeditionsFallbackTimer = null;
                        const pending = this.pendingExpeditions;
                        const fallback = this.pendingExpeditionsFallback;
                        this.pendingExpeditionsFallback = null;
                        if (!pending || !fallback) return;
                        this.pendingExpeditions = null;
                        window.clearTimeout(pending.timer);
                        pending.resolve({ data: fallback.data, error: fallback.error });
                    }, 1_000);
                }
            }
        }
        if (eventName === 'minigames' && action === 'start.minigame') {
            const data = payload.data as { lockExpiresAt?: unknown; token?: unknown } | null;
            const lockValue = data?.lockExpiresAt;
            const lockExpiresAt = typeof lockValue === 'number'
                ? lockValue
                : typeof lockValue === 'string' ? Date.parse(lockValue) : Number.NaN;
            if (data && !data.token && Number.isFinite(lockExpiresAt)) {
                this.minigameLock = { lockExpiresAt, at: Date.now() };
            }
        }
        if (eventName === 'drone-missions' && action === 'event') this.lastDroneEvent = payload.data;
        if (eventName === 'drone-missions' && action === 'completed') this.lastDroneCompleted = payload.data;
        if (eventName === 'specialists' && (action === undefined || action === 'get.state')) {
            // Some game builds return the specialist state as a room push
            // without echoing the action. Resolve the pending get.state request
            // so the warehouse expansion panel does not fall back to
            // "service unavailable" after a successful response.
            const pending = this.pendingRequests.get('specialists:get.state');
            if (pending && payload?.data !== undefined && looksLikeSpecialistState(payload.data)) {
                window.clearTimeout(pending.timer);
                this.pendingRequests.delete('specialists:get.state');
                pending.resolve({ data: payload.data, error: payload.error });
            }
        }
        if (!action) return;

        if (eventName === 'network-map' && action === 'get.map') {
            const map = payload.data as RawNetworkMap | undefined;
            if (map && Array.isArray(map.servers) && Array.isArray(map.connections)) {
                this.mapLoadedAt = Date.now();
                this.notifyReadiness();
                const pending = this.pendingMap;
                if (pending) {
                    window.clearTimeout(pending.timer);
                    this.pendingMap = null;
                    pending.resolve(map);
                }
            } else if (payload.error !== undefined) {
                const pending = this.pendingMap;
                if (pending) {
                    window.clearTimeout(pending.timer);
                    this.pendingMap = null;
                    const message = payloadErrorMessage(payload.error, 'get.map failed');
                    this.notifyHost('warn', 'get.map failed', { reason: message, socketUrl: sanitizeSocketUrl(this.sockets.get(ws)?.url ?? null) });
                    pending.reject(new Error(message));
                }
            }
        }
        if (eventName === 'market' && /^get\.(options|lots|jobs)$/.test(action) && payload.data) {
            this.updateMarketCache(action, payload.data);
            this.marketLoadedAt = Date.now();
            this.notifyReadiness();
        }
        if (eventName === 'loadout' && action === 'get.options' && payload.data) {
            this.loadoutLoadedAt = Date.now();
            this.notifyReadiness();
        }
        if (eventName === 'desktop' && action === 'get.options' && payload.data) {
            this.desktopOptions = payload.data;
        }

        const key = `${eventName}:${action}`;
        const pending = this.pendingRequests.get(key);
        if (pending) {
            window.clearTimeout(pending.timer);
            this.pendingRequests.delete(key);
            pending.resolve({ data: payload.data, error: payload.error });
        }
    }

    private async decode(raw: unknown): Promise<string | null> {
        if (typeof raw === 'string') return raw;
        const codec = window.__cor3MsgpackCodec;
        if (!codec) return null;
        try {
            const packet = await codec.decodeBinaryPacketAsync(raw);
            return codec.packetToString(packet);
        } catch {
            return null;
        }
    }
}


function redactFrameText(value: string): string {
    return value
        .replace(/("jwtToken"\s*:\s*")[^"]+(")/g, '$1[REDACTED]$2')
        .replace(/("token"\s*:\s*")[^"]+(")/g, '$1[REDACTED]$2')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
}


function decodeJwtExpiry(token: string): number | null {
    const raw = token.replace(/^Bearer\s+/i, '');
    const parts = raw.split('.');
    if (parts.length < 2 || !parts[1]) return null;
    try {
        const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
        const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
        return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : null;
    } catch {
        return null;
    }
}
