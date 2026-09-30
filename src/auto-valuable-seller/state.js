// Shared mutable state for auto-valuable-seller submodules.
// Every submodule imports from here to read/write the common running flag,
// caches, and wired utility instances.

import { humanDelay, createSendCmd, createDelay, createWaitForEvent, createLogger } from '../shared/ws-utils.js';
import { createWaitForHackToBeDone, ensureDecryptSolverEnabled, ensureIceWallSolverEnabled, ensureSimpleDecryptSolverEnabled } from '../shared/hack-utils.js';
import { MARKET_SELL_ORDER as SHARED_MARKET_SELL_ORDER } from '../shared/server-constants.js';
import { FALLBACK_PATH_MAP, FALLBACK_SERVER_PRIORITY } from '../shared/server-map.js';

// ---- Running / abort state ----
export var running = false;
export var mode = null; // 'search' or 'seller'

export function setRunning(v) { running = v; }
export function setMode(v) { mode = v; }
export function isAborted() { return !running; }

// ---- Caches ----
export var _cachedMapData = null;
export var _lastServersData = null;
export var _fileAnalysisCache = {};
export var _loginStatusCache = {};
export var LOGIN_STATUS_CACHE_TTL = 3000;
export var _desktopToServerMap = {};

export function setCachedMapData(v) { _cachedMapData = v; }
export function setLastServersData(v) { _lastServersData = v; }
export function clearFileAnalysisCache() { _fileAnalysisCache = {}; }
export function clearDesktopToServerMap() { _desktopToServerMap = {}; }

// ---- Loadout cache ----
export var _cachedLoadout = null;
export var _cachedLoadoutAt = 0;
export var LOADOUT_COOLDOWN_MS = 2000;
export var _lastLoadoutFetchAt = 0;

export function setCachedLoadout(v) { _cachedLoadout = v; _cachedLoadoutAt = v ? Date.now() : 0; }
export function setLastLoadoutFetchAt(v) { _lastLoadoutFetchAt = v; }
export function invalidateLoadoutCache() { _cachedLoadout = null; _cachedLoadoutAt = 0; }

// ---- Force maintenance state ----
export var _forceMaintenanceRunning = false;
export function setForceMaintenanceRunning(v) { _forceMaintenanceRunning = v; }

// ---- Wired utility instances ----
export var sendCmd = createSendCmd('COR3_AUTOJOB_CMD');
export var delay = createDelay(isAborted);
export var waitForEvent = createWaitForEvent(isAborted);
export var log = createLogger('[COR3 ValuableSeller]', 'COR3_VALUABLE_LOG');
export var waitForHackToBeDone = createWaitForHackToBeDone(log, isAborted);

export function ensureSolversEnabled() {
    ensureDecryptSolverEnabled();
    ensureIceWallSolverEnabled();
    ensureSimpleDecryptSolverEnabled();
}

// ---- Market selling priority: USOL -> SOYUZ -> D4RK -> HOME ----
export var MARKET_SELL_ORDER = SHARED_MARKET_SELL_ORDER;

export var SERVER_PATH_MAP = FALLBACK_PATH_MAP;
export var SERVER_PRIORITY = FALLBACK_SERVER_PRIORITY;

// Build ALL_SERVERS lookup from SERVER_PATH_MAP: serverId → serverName
export var ALL_SERVERS = {};
for (var sName in SERVER_PATH_MAP) {
    var path = SERVER_PATH_MAP[sName];
    var last = path[path.length - 1];
    ALL_SERVERS[last.id] = sName;
}

// Get server name from ID using ALL_SERVERS or global map cache
export function getServerName(serverId) {
    if (ALL_SERVERS[serverId]) return ALL_SERVERS[serverId];
    var map = window.__cor3ServerTypeMap;
    if (map && map[serverId] && map[serverId].serverName) return map[serverId].serverName;
    return serverId.substring(0, 8);
}

// Get path length for a server by ID (used for sorting furthest-first)
export function getServerPathLength(serverId) {
    for (var sName in SERVER_PATH_MAP) {
        var p = SERVER_PATH_MAP[sName];
        var last = p[p.length - 1];
        if (last.id === serverId) return p.length;
    }
    return 0;
}

// UI update helpers
export function signalDone() {
    running = false;
    mode = null;
    window.postMessage({ type: 'COR3_VALUABLE_DONE' }, '*');
}

export function updateServersUI(serversData) {
    window.postMessage({ type: 'COR3_VALUABLE_SERVERS_UPDATE', data: serversData }, '*');
}

export function updateDownloadsUI(downloadsData) {
    window.postMessage({ type: 'COR3_VALUABLE_DOWNLOADS_UPDATE', data: downloadsData }, '*');
}

export function updateMaintenanceUI(maintData) {
    window.postMessage({ type: 'COR3_VALUABLE_MAINTENANCE_UPDATE', data: maintData }, '*');
}

export { humanDelay };
