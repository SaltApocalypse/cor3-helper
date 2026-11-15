import { z } from 'zod';
import { cancelMinigame, detectMinigameKind, solveMinigame, type MinigameKind } from './minigame-solver.js';
import { cancelDailyHack, solveDailyHack } from './daily-solver.js';
import { err, ok } from '../../kernel/result.js';
import { BridgeServer } from '../../infrastructure/bridge/bridge-server.js';
import { WindowBridgeTransport } from '../../infrastructure/bridge/window-transport.js';
import { ConsoleLogger } from '../../infrastructure/logging/logger.js';
import { GameSocketHub } from '../../infrastructure/game-ws/game-socket-hub.js';

const logger = new ConsoleLogger({ now: () => Date.now() });
const hub = new GameSocketHub();
hub.install();

interface AutoSolverSettings {
    decrypt: boolean;
    iceWall: boolean;
    simpleDecrypt: boolean;
}

let autoSolverSettings: AutoSolverSettings = { decrypt: false, iceWall: false, simpleDecrypt: false };
let autoSolverTimer: number | null = null;
let autoSolverRunning = false;

function autoSolverKinds(): Set<MinigameKind> {
    const allowed = new Set<MinigameKind>();
    if (autoSolverSettings.decrypt) allowed.add('config-hack');
    if (autoSolverSettings.iceWall) allowed.add('ice-wall');
    if (autoSolverSettings.simpleDecrypt) allowed.add('simple-decrypt');
    return allowed;
}

async function autoSolverTick(): Promise<void> {
    if (autoSolverRunning) return;
    const allowed = autoSolverKinds();
    if (allowed.size === 0) return;
    const kind = detectMinigameKind();
    if (kind === null || !allowed.has(kind)) return;
    autoSolverRunning = true;
    try {
        await solveMinigame(15_000, allowed);
    } catch (error) {
        logger.warn('minigame', 'Auto solver tick failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
        autoSolverRunning = false;
    }
}

function setAutoSolverSettings(next: AutoSolverSettings): void {
    autoSolverSettings = next;
    if (autoSolverKinds().size === 0) {
        if (autoSolverTimer !== null) {
            window.clearInterval(autoSolverTimer);
            autoSolverTimer = null;
        }
        return;
    }
    if (autoSolverTimer === null) {
        autoSolverTimer = window.setInterval(() => { void autoSolverTick(); }, 1_000);
    }
    void autoSolverTick();
}

const server = new BridgeServer('main-world', logger);
server.register('game.authStatus', z.object({}).strict(), async () => ok(hub.authStatus()));
server.register('game.readiness', z.object({}).strict(), async () => ok(hub.readiness()));
server.register('game.wsLogs', z.object({}).strict(), async () => ok(hub.wsLogs()));
server.register('game.clearWsLogs', z.object({}).strict(), async () => {
    hub.clearWsLogs();
    return ok(undefined);
});
server.register('game.sendWsMessage', z.object({ message: z.string().min(1) }).strict(), async ({ message }) => {
    const result = hub.sendRawFrame(message);
    return result.ok ? ok(undefined) : { ok: false, error: result.error };
});
server.register('game.minigameLock', z.object({}).strict(), async () => ok(hub.latestMinigameLock()));
server.register('game.setAutoSolvers', z.object({
    decrypt: z.boolean(),
    iceWall: z.boolean(),
    simpleDecrypt: z.boolean(),
}).strict(), async (settings) => {
    setAutoSolverSettings(settings);
    return ok(undefined);
});
server.register('game.solveDailyHack', z.object({ timeoutMs: z.number().int().positive().optional() }).strict(), async ({ timeoutMs }) => {
    return ok(await solveDailyHack(timeoutMs));
});
server.register('game.cancelDailyHack', z.object({}).strict(), async () => {
    cancelDailyHack();
    return ok(undefined);
});
server.register('game.specialistAction', z.object({ kind: z.string().min(1), payload: z.record(z.string(), z.unknown()) }).strict(), async ({ kind, payload }) => {
    const result = await hub.specialistAction(kind, payload);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.expeditionAction', z.object({ kind: z.string().min(1), payload: z.record(z.string(), z.unknown()) }).strict(), async ({ kind, payload }) => {
    const result = await hub.expeditionAction(kind, payload);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.droneAction', z.object({ kind: z.string().min(1), payload: z.record(z.string(), z.unknown()) }).strict(), async ({ kind, payload }) => {
    if (kind === 'getEvent') {
        // Keep the event until it is successfully resolved. Clearing on every
        // poll lost events that could not be handled on the first attempt.
        return ok(hub.latestDroneEvent());
    }
    if (kind === 'getCompleted') {
        const completed = hub.latestDroneCompleted();
        hub.clearDroneCompleted();
        return ok(completed);
    }
    const result = await hub.droneAction(kind, payload);
    if (kind === 'resolveEvent' && result.ok) hub.clearDroneEvent();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.getDailyOps', z.object({}).strict(), async () => {
    const result = await hub.getDailyOps();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.getDailyRewards', z.object({}).strict(), async () => {
    const result = await hub.getDailyRewards();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.getMail', z.object({}).strict(), async () => {
    const result = await hub.getMail();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.mailClaimAll', z.object({ messageId: z.string().min(1) }).strict(), async ({ messageId }) => {
    const result = await hub.claimMailAll(messageId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.mailClaimItem', z.object({
    attachmentId: z.string().min(1),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    rotated: z.boolean(),
}).strict(), async ({ attachmentId, x, y, rotated }) => {
    const result = await hub.claimMailItem(attachmentId, x, y, rotated);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.getStash', z.object({}).strict(), async () => {
    const result = await hub.getStash();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.sellStashItem', z.object({ itemId: z.string().min(1), quantity: z.number().int().positive() }).strict(), async ({ itemId, quantity }) => {
    const result = await hub.sellStashItem(itemId, quantity);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.moveStashItem', z.object({
    itemId: z.string().min(1),
    location: z.enum(['stash', 'sorting_table']),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    rotated: z.boolean(),
}).strict(), async (move) => {
    const result = await hub.moveStashItem(move);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.getMap', z.object({}).strict(), async () => {
    try {
        return ok(await hub.requestMap(10000));
    } catch (error) {
        return err({
            code: 'GAME_MAP_FAILED',
            message: error instanceof Error ? error.message : String(error),
        });
    }
});
server.register('game.connectIp', z.object({ ip: z.string().min(1) }).strict(), async ({ ip }) => {
    if (!hub.connectIp(ip)) return err({ code: 'GAME_NO_SOCKET', message: 'No game WebSocket is available' });
    return ok(undefined);
});
server.register('game.setEndpoint', z.object({ serverId: z.string().min(1) }).strict(), async ({ serverId }) => {
    const result = await hub.setEndpoint(serverId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.getLoginStatus', z.object({ serverId: z.string().min(1) }).strict(), async ({ serverId }) => {
    const result = await hub.getLoginStatus(serverId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.hackStart', z.object({ serverId: z.string().min(1) }).strict(), async ({ serverId }) => {
    const result = await hub.hackStart(serverId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.loginWithAccess', z.object({ serverId: z.string().min(1), accessGrantId: z.string().min(1) }).strict(), async ({ serverId, accessGrantId }) => {
    const result = await hub.loginWithAccess(serverId, accessGrantId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.takeJob', z.object({ marketId: z.string().min(1), jobId: z.string().min(1) }).strict(), async ({ marketId, jobId }) => {
    const result = await hub.takeJob(marketId, jobId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.completeJob', z.object({ marketId: z.string().min(1), jobId: z.string().min(1) }).strict(), async ({ marketId, jobId }) => {
    const result = await hub.completeJob(marketId, jobId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.dismissJob', z.object({ marketId: z.string().min(1), jobId: z.string().min(1) }).strict(), async ({ marketId, jobId }) => {
    const result = await hub.dismissJob(marketId, jobId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.jobAction', z.object({
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
}).strict(), async ({ kind, payload }) => {
    const result = await hub.jobAction(kind, payload);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.valuableAction', z.object({
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
}).strict(), async ({ kind, payload }) => {
    const result = await hub.valuableAction(kind, payload);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.solveMinigame', z.object({ timeoutMs: z.number().int().positive().optional() }).strict(), async ({ timeoutMs }) => {
    return ok(await solveMinigame(timeoutMs));
});
server.register('game.cancelMinigame', z.object({}).strict(), async () => {
    cancelMinigame();
    return ok(undefined);
});
server.register('game.getLoadout', z.object({}).strict(), async () => {
    const result = await hub.getLoadout();
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.equipHardware', z.object({ moduleConfigId: z.string().min(1) }).strict(), async ({ moduleConfigId }) => {
    const result = await hub.equipHardware(moduleConfigId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.equipSoftware', z.object({ moduleConfigId: z.string().min(1) }).strict(), async ({ moduleConfigId }) => {
    const result = await hub.equipSoftware(moduleConfigId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.unequipSoftware', z.object({ moduleConfigId: z.string().min(1) }).strict(), async ({ moduleConfigId }) => {
    const result = await hub.unequipSoftware(moduleConfigId);
    return result.ok ? ok(undefined) : err(result.error);
});
server.register('game.getCachedMarket', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
    return ok(hub.cachedMarket(marketId));
});
server.register('game.requestMarketOptions', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
    const result = await hub.requestMarketOptions(marketId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.requestMarketLots', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
    const result = await hub.requestMarketLots(marketId);
    return result.ok ? ok(result.value) : err(result.error);
});
server.register('game.requestMarketJobs', z.object({ marketId: z.string().min(1) }).strict(), async ({ marketId }) => {
    const result = await hub.requestMarketJobs(marketId);
    return result.ok ? ok(result.value) : err(result.error);
});

const transport = new WindowBridgeTransport('main-world');
transport.start((request) => server.handle(request));

console.info('[cor3-helper 2.0] main-world game socket hub ready');
