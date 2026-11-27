import { z } from 'zod';
import { BridgeClient } from '../../infrastructure/bridge/bridge-client.js';
import { WindowBridgeTransport } from '../../infrastructure/bridge/window-transport.js';
import { rawNetworkMapSchema, type RawNetworkMap } from '../../contracts/map.js';
import { rawMarketSnapshotSchema, type RawMarketSnapshot } from '../../contracts/market.js';
import type { BridgeResult } from '../../contracts/bridge.js';
import { gameReadinessSchema } from '../../application/game/readiness.js';
import { saiFileSnapshotSchema } from '../../contracts/sai.js';
import { encodeTabRequest, encodeTabResponse, tabRequestSchema } from '../../contracts/tab.js';
import { parseTabCommand } from '../../contracts/tab-commands.js';
import { startQol } from './qol.js';
import { startSaiHighlighter } from './sai-highlighter.js';

function sendToBackground(message: Record<string, unknown>): void {
    try {
        void chrome.runtime.sendMessage(encodeTabRequest(message) ?? message).catch(() => undefined);
    } catch {
        // The content script may outlive an extension reload.
    }
}

const transport = new WindowBridgeTransport('main-world', crypto.randomUUID());
const game = new BridgeClient(transport, 'content', 'main-world');

function publishReadiness(value: unknown): void {
    const parsed = gameReadinessSchema.safeParse(value);
    if (!parsed.success) return;
    try {
        sendToBackground({ type: 'V2_GAME_READY', readiness: parsed.data });
    } catch {
        // The content script may outlive an extension reload.
    }
}

function publishMarketCache(value: unknown, marketId: unknown, source: unknown): void {
    if (typeof marketId !== 'string') return;
    const parsed = rawMarketSnapshotSchema.safeParse(value);
    if (!parsed.success) return;
    const component = source === 'jobs' || source === 'options' || source === 'lots' ? source : undefined;
    try {
        sendToBackground({
            type: 'V2_MARKET_CACHE',
            marketId,
            snapshot: parsed.data,
            ...(component !== undefined ? { source: component } : {}),
        });
    } catch {
        // The content script may outlive an extension reload.
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data as { version?: unknown; type?: unknown; readiness?: unknown; marketId?: unknown; snapshot?: unknown; source?: unknown; level?: unknown; message?: unknown; data?: unknown; decisions?: unknown; serverId?: unknown; reason?: unknown } | null;
    if (data?.version !== undefined && data.version !== 2) return;
    if (data?.type === 'V2_GAME_READINESS_CHANGED') publishReadiness(data.readiness);
    if (data?.type === 'V2_MARKET_CACHE_UPDATED') publishMarketCache(data.snapshot, data.marketId, data.source);
    if (data?.type === 'V2_EXPEDITION_DECISIONS' && Array.isArray(data.decisions)) {
        try {
            sendToBackground({ type: 'V2_EXPEDITION_DECISIONS', decisions: data.decisions });
        } catch {
            // The content script may outlive an extension reload.
        }
    }
    if (data?.type === 'V2_WS_NOTICE' && typeof data.message === 'string') {
        try {
            sendToBackground({
                type: 'V2_WS_NOTICE',
                level: typeof data.level === 'string' ? data.level : 'info',
                message: data.message,
                ...(data.data !== undefined ? { data: data.data } : {}),
            });
        } catch {
            // The content script may outlive an extension reload.
        }
    }
    if (data?.type === 'V2_MAINTENANCE_STARTED') {
        try {
            sendToBackground({
                type: 'V2_MAINTENANCE_STARTED',
                ...(typeof data.serverId === 'string' && data.serverId.length > 0 ? { serverId: data.serverId } : {}),
                ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
            });
        } catch {
            // The content script may outlive an extension reload.
        }
    }
});

void game.request('game.readiness', {}, gameReadinessSchema, 5000).then((result) => {
    if (result.ok) publishReadiness(result.value);
});

async function requestMap(): Promise<BridgeResult<RawNetworkMap>> {
    return game.request('game.getMap', {}, rawNetworkMapSchema, 12000);
}

/**
 * Options and lots change far less often than jobs. Cache them briefly so a
 * market refresh only costs one `get.jobs` request in steady state. Jobs are
 * always fetched live.
 */
const MARKET_AUX_TTL_MS = 5 * 60_000;
const marketAuxCache = new Map<string, { readonly options?: unknown; readonly lots?: unknown; readonly at: number }>();

async function fetchMarket(marketId: string): Promise<BridgeResult<RawMarketSnapshot>> {
    // Jobs are the only mandatory component for automation. Options/lots are
    // best-effort: a slow or unavailable shop must not hide newly posted jobs.
    const jobs = await game.request('game.requestMarketJobs', { marketId }, z.unknown(), 35_000);
    if (!jobs.ok) return jobs;
    let aux = marketAuxCache.get(marketId);
    if (!aux || Date.now() - aux.at >= MARKET_AUX_TTL_MS) {
        // Options/lots are optional and independent; fetch them in parallel with
        // a short timeout so a slow shop cannot delay or block the job refresh.
        const [options, lots] = await Promise.all([
            game.request('game.requestMarketOptions', { marketId }, z.unknown(), 10_000),
            game.request('game.requestMarketLots', { marketId }, z.unknown(), 10_000),
        ]);
        if (options.ok || lots.ok) {
            aux = {
                ...(options.ok ? { options: options.value } : aux?.options !== undefined ? { options: aux.options } : {}),
                ...(lots.ok ? { lots: lots.value } : aux?.lots !== undefined ? { lots: aux.lots } : {}),
                at: Date.now(),
            };
            marketAuxCache.set(marketId, aux);
        }
    }
    const parsed = rawMarketSnapshotSchema.safeParse({
        options: aux?.options ?? {},
        lots: aux?.lots ?? [],
        jobs: jobs.value,
    });
    if (!parsed.success) {
        return { ok: false, error: { code: 'MARKET_INVALID', message: 'Market snapshot failed schema validation' } };
    }
    return { ok: true, value: parsed.data };
}

console.info('[cor3-helper 2.0] content bridge loaded');
void startQol();
const saiHighlighter = startSaiHighlighter();
void game.request('game.saiFiles', {}, saiFileSnapshotSchema, 5000).then((result) => {
    if (result.ok) saiHighlighter.setFiles(result.value.files);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = tabRequestSchema.safeParse(message);
    if (!request.success) {
        sendResponse({ ok: false, error: { code: 'INVALID_TAB_ENVELOPE', message: 'Tab request envelope is missing or invalid' } });
        return true;
    }
    const requestId = request.data.requestId;
    const rawSendResponse = sendResponse;
    sendResponse = ((response: unknown) => {
        rawSendResponse(encodeTabResponse(requestId, response));
    }) as typeof sendResponse;
    const type = request.data.type;
    const payload = parseTabCommand(type, request.data.payload);
    if (!payload) {
        sendResponse({ ok: false, error: { code: 'INVALID_TAB_COMMAND', message: `Invalid or unknown tab command: ${type}` } });
        return true;
    }
    message = { type, ...payload };
    if (type === 'V2_GAME_READINESS') {
        void game.request('game.readiness', {}, gameReadinessSchema, 5000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_AUTH_EXECUTE') {
        const operation = (message as { operation?: unknown }).operation;
        if (operation === 'dailyOps') {
            void game.request('game.getDailyOps', {}, z.unknown(), 20000).then((result) => sendResponse(result));
            return true;
        }
        if (operation === 'dailyRewards') {
            void game.request('game.getDailyRewards', {}, z.unknown(), 20000).then((result) => sendResponse(result));
            return true;
        }
        sendResponse({ ok: false, error: { code: 'AUTH_OPERATION_UNKNOWN', message: 'Unknown auth operation' } });
        return true;
    }
    if (type === 'V2_AUTH_STATUS') {
        void game.request('game.authStatus', {}, z.unknown(), 5000).then((result) => {
            if (result.ok && result.value && typeof result.value === 'object') {
                const value = result.value as { authenticated?: unknown; expiresAt?: unknown };
                const authenticated = value.authenticated === true;
                sendResponse({
                    authenticated,
                    source: authenticated ? 'content' : 'none',
                    ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}),
                });
                return;
            }
            sendResponse({ authenticated: false, source: 'none' });
        });
        return true;
    }
    if (type === 'V2_EXPEDITION_ACTION') {
        const kind = (message as { kind?: unknown }).kind;
        const payload = (message as { payload?: unknown }).payload;
        if (typeof kind !== 'string' || !payload || typeof payload !== 'object') {
            sendResponse({ ok: false, error: { code: 'INVALID_EXPEDITION_ACTION', message: 'Invalid expedition action' } });
            return true;
        }
        void game.request('game.expeditionAction', { kind, payload }, z.unknown(), 25000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_DRONE_ACTION') {
        const kind = (message as { kind?: unknown }).kind;
        const payload = (message as { payload?: unknown }).payload;
        if (typeof kind !== 'string' || !payload || typeof payload !== 'object') {
            sendResponse({ ok: false, error: { code: 'INVALID_DRONE_ACTION', message: 'Invalid drone action' } });
            return true;
        }
        void game.request('game.droneAction', { kind, payload }, z.unknown(), 25000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_SPECIALISTS_GET') {
        void game.request('game.specialistAction', { kind: 'getState', payload: {} }, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_SPECIALISTS_PURCHASE') {
        const specialistType = (message as { specialistType?: unknown }).specialistType;
        const kind = (message as { kind?: unknown }).kind;
        const level = (message as { level?: unknown }).level;
        const priceId = (message as { priceId?: unknown }).priceId;
        if (typeof specialistType !== 'string' || typeof kind !== 'string' || typeof level !== 'number' || typeof priceId !== 'string') {
            sendResponse({ ok: false, error: { code: 'INVALID_SPECIALIST', message: 'Invalid specialist purchase' } });
            return true;
        }
        void game.request('game.specialistAction', { kind: 'purchase', payload: { specialistType, kind, level, priceId } }, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_SET_AUTO_SOLVERS') {
        const payload = message as { decrypt?: unknown; iceWall?: unknown; simpleDecrypt?: unknown };
        if (typeof payload.decrypt !== 'boolean' || typeof payload.iceWall !== 'boolean' || typeof payload.simpleDecrypt !== 'boolean') {
            sendResponse({ ok: false, error: { code: 'INVALID_AUTO_SOLVERS', message: 'Invalid auto solver settings' } });
            return true;
        }
        void game.request('game.setAutoSolvers', {
            decrypt: payload.decrypt,
            iceWall: payload.iceWall,
            simpleDecrypt: payload.simpleDecrypt,
        }, z.undefined(), 5000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_WS_LOGS') {
        void game.request('game.wsLogs', {}, z.unknown(), 10000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_CLEAR_WS_LOGS') {
        void game.request('game.clearWsLogs', {}, z.undefined(), 10000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_WS_SEND') {
        const text = (message as { message?: unknown }).message;
        if (typeof text !== 'string' || text.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_WS_MESSAGE', message: 'Invalid WebSocket message' } });
            return true;
        }
        void game.request('game.sendWsMessage', { message: text }, z.undefined(), 10000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_DAILY_HACK') {
        const timeoutMs = (message as { timeoutMs?: unknown }).timeoutMs;
        void game.request('game.solveDailyHack', timeoutMs === undefined ? {} : { timeoutMs }, z.unknown(), 130000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_DAILY_HACK_CANCEL') {
        void game.request('game.cancelDailyHack', {}, z.unknown(), 10000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_DAILY_OPS_GET') {
        void game.request('game.getDailyOps', {}, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_DAILY_REWARDS_GET') {
        void game.request('game.getDailyRewards', {}, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_MAIL_GET') {
        void game.request('game.getMail', {}, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_MAIL_CLAIM_ALL') {
        const messageId = (message as { messageId?: unknown }).messageId;
        if (typeof messageId !== 'string' || messageId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_MAIL', message: 'Invalid message id' } });
            return true;
        }
        void game.request('game.mailClaimAll', { messageId }, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_MAIL_CLAIM_ITEM') {
        const attachmentId = (message as { attachmentId?: unknown }).attachmentId;
        const x = (message as { x?: unknown }).x;
        const y = (message as { y?: unknown }).y;
        const rotated = (message as { rotated?: unknown }).rotated;
        if (typeof attachmentId !== 'string' || typeof x !== 'number' || typeof y !== 'number' || typeof rotated !== 'boolean') {
            sendResponse({ ok: false, error: { code: 'INVALID_MAIL', message: 'Invalid mail item claim' } });
            return true;
        }
        void game.request('game.mailClaimItem', { attachmentId, x, y, rotated }, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_STASH_GET') {
        void game.request('game.getStash', {}, z.unknown(), 20000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_STASH_SELL') {
        const itemId = (message as { itemId?: unknown }).itemId;
        const quantity = (message as { quantity?: unknown }).quantity;
        if (typeof itemId !== 'string' || typeof quantity !== 'number') {
            sendResponse({ ok: false, error: { code: 'INVALID_STASH_SELL', message: 'Invalid stash sell' } });
            return true;
        }
        void game.request('game.sellStashItem', { itemId, quantity }, z.unknown(), 15000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_STASH_MOVE') {
        const itemId = (message as { itemId?: unknown }).itemId;
        const location = (message as { location?: unknown }).location;
        const x = (message as { x?: unknown }).x;
        const y = (message as { y?: unknown }).y;
        const rotated = (message as { rotated?: unknown }).rotated;
        if (typeof itemId !== 'string' || (location !== 'stash' && location !== 'sorting_table')
            || typeof x !== 'number' || typeof y !== 'number' || typeof rotated !== 'boolean') {
            sendResponse({ ok: false, error: { code: 'INVALID_STASH_MOVE', message: 'Invalid stash move' } });
            return true;
        }
        void game.request('game.moveStashItem', { itemId, location, x, y, rotated }, z.unknown(), 15000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_GET_MAP') {
        void requestMap().then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_CONNECT_IP') {
        const ip = (message as { ip?: unknown }).ip;
        if (typeof ip !== 'string' || ip.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_IP', message: 'Invalid IP' } });
            return true;
        }
        void game.request('game.connectIp', { ip }, z.unknown()).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_SET_ENDPOINT') {
        const serverId = (message as { serverId?: unknown }).serverId;
        if (typeof serverId !== 'string' || serverId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_SERVER', message: 'Invalid server id' } });
            return true;
        }
        void game.request('game.setEndpoint', { serverId }, z.unknown(), 15000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_LOGIN_STATUS') {
        const serverId = (message as { serverId?: unknown }).serverId;
        if (typeof serverId !== 'string' || serverId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_SERVER', message: 'Invalid server id' } });
            return true;
        }
        void game.request('game.getLoginStatus', { serverId }, z.unknown(), 12000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_HACK_START') {
        const serverId = (message as { serverId?: unknown }).serverId;
        if (typeof serverId !== 'string' || serverId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_SERVER', message: 'Invalid server id' } });
            return true;
        }
        void game.request('game.hackStart', { serverId }, z.unknown(), 35000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_LOGIN_WITH_ACCESS') {
        const serverId = (message as { serverId?: unknown }).serverId;
        const accessGrantId = (message as { accessGrantId?: unknown }).accessGrantId;
        if (typeof serverId !== 'string' || typeof accessGrantId !== 'string') {
            sendResponse({ ok: false, error: { code: 'INVALID_LOGIN', message: 'Invalid login data' } });
            return true;
        }
        void game.request('game.loginWithAccess', { serverId, accessGrantId }, z.unknown(), 12000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_SOLVE_MINIGAME') {
        const timeoutMs = (message as { timeoutMs?: unknown }).timeoutMs;
        void game.request('game.solveMinigame', timeoutMs === undefined ? {} : { timeoutMs }, z.unknown(), 190000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_CANCEL_MINIGAME') {
        void game.request('game.cancelMinigame', {}, z.unknown(), 10000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_VALUABLE_ACTION') {
        const kind = (message as { kind?: unknown }).kind;
        const payload = (message as { payload?: unknown }).payload;
        if (typeof kind !== 'string' || !payload || typeof payload !== 'object') {
            sendResponse({ ok: false, error: { code: 'INVALID_VALUABLE_ACTION', message: 'Invalid valuable action' } });
            return true;
        }
        void game.request('game.valuableAction', { kind, payload }, z.unknown(), 45000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_JOB_ACTION') {
        const kind = (message as { kind?: unknown }).kind;
        const payload = (message as { payload?: unknown }).payload;
        if (typeof kind !== 'string' || !payload || typeof payload !== 'object') {
            sendResponse({ ok: false, error: { code: 'INVALID_JOB_ACTION', message: 'Invalid job action' } });
            return true;
        }
        void game.request('game.jobAction', { kind, payload }, z.unknown(), 18000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_JOB_TAKE' || type === 'V2_JOB_COMPLETE' || type === 'V2_JOB_DISMISS') {
        const marketId = (message as { marketId?: unknown }).marketId;
        const jobId = (message as { jobId?: unknown }).jobId;
        if (typeof marketId !== 'string' || typeof jobId !== 'string') {
            sendResponse({ ok: false, error: { code: 'INVALID_JOB', message: 'Invalid job data' } });
            return true;
        }
        const action = type === 'V2_JOB_TAKE' ? 'game.takeJob' : type === 'V2_JOB_COMPLETE' ? 'game.completeJob' : 'game.dismissJob';
        void game.request(action, { marketId, jobId }, z.unknown(), 18000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_MINIGAME_LOCK') {
        void game.request('game.minigameLock', {}, z.number().nullable(), 5000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_LOADOUT_GET') {
        void game.request('game.getLoadout', {}, z.unknown(), 35_000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_EQUIP_HARDWARE' || type === 'V2_EQUIP_SOFTWARE' || type === 'V2_UNEQUIP_SOFTWARE') {
        const moduleConfigId = (message as { moduleConfigId?: unknown }).moduleConfigId;
        if (typeof moduleConfigId !== 'string' || moduleConfigId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_MODULE', message: 'Invalid module id' } });
            return true;
        }
        const action = type === 'V2_EQUIP_HARDWARE'
            ? 'game.equipHardware'
            : type === 'V2_EQUIP_SOFTWARE' ? 'game.equipSoftware' : 'game.unequipSoftware';
        void game.request(action, { moduleConfigId }, z.unknown(), 12000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_MARKET_OPTIONS') {
        const marketId = (message as { marketId?: unknown }).marketId;
        if (typeof marketId !== 'string' || marketId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_MARKET', message: 'Invalid market id' } });
            return true;
        }
        void game.request('game.requestMarketOptions', { marketId }, z.unknown(), 35_000).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_FETCH_MARKET') {
        const marketId = (message as { marketId?: unknown }).marketId;
        if (typeof marketId !== 'string' || marketId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_MARKET', message: 'Invalid market id' } });
            return true;
        }
        void fetchMarket(marketId).then((result) => sendResponse(result));
        return true;
    }
    if (type === 'V2_REQUEST_MARKET_JOBS') {
        const marketId = (message as { marketId?: unknown }).marketId;
        const requestedTimeout = (message as { timeoutMs?: unknown }).timeoutMs;
        if (typeof marketId !== 'string' || marketId.length === 0) {
            sendResponse({ ok: false, error: { code: 'INVALID_MARKET', message: 'Invalid market id' } });
            return true;
        }
        const timeoutMs = typeof requestedTimeout === 'number' && requestedTimeout > 0
            ? Math.min(requestedTimeout, 35_000)
            : 35_000;
        void game.request('game.requestMarketJobs', {
            marketId,
            timeoutMs,
        }, z.unknown(), timeoutMs + 500).then((result) => sendResponse(result));
        return true;
    }
    return false;
});
