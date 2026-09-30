// Auto Job Solver — shared mutable state and wired utility instances.
// Every sub-module imports from here so they share one set of state.

import { MARKET_SERVER_IDS } from '../shared/server-constants.js';
import { createSendCmd, createDelay, createWaitForEvent, createLogger } from '../shared/ws-utils.js';
import { createWaitForHackToBeDone } from '../shared/hack-utils.js';
import { ServerMap, FALLBACK_PATH_MAP, FALLBACK_SERVER_PRIORITY } from '../shared/server-map.js';

// ---- Mutable solver state ----
export var state = {
    jobQueue: [],
    running: false,
    abortFlag: false,
    tokenExpired: false,
    solverSettings: {},
    _currentJobRef: null,
    currentJobIndex: 0,
    downloadFolderId: null,
    _lastEndpointServerId: null,
    _cachedMapData: null,
    _cachedLoadout: null,
    _cachedLoadoutAt: 0,
    _lastLoadoutFetchAt: 0,
    _lastLoadoutServerType: null,
    LOADOUT_COOLDOWN_MS: 2000,
};

// Market server IDs (convenience aliases from shared constants)
export var DARK_MARKET_SERVER_ID = MARKET_SERVER_IDS.dark;
export var SOYUZ_MARKET_SERVER_ID = MARKET_SERVER_IDS.soyuz;
export var USOL_MARKET_SERVER_ID = MARKET_SERVER_IDS.usol;

// Dynamic server map instance (shared across all sub-modules)
export var serverMap = new ServerMap();

// ---- Wired utilities (bound to solver abortFlag) ----
export var sendCmd = createSendCmd('COR3_AUTOJOB_CMD');
export var delay = createDelay(function () { return state.abortFlag; });
export var waitForEvent = createWaitForEvent(function () { return state.abortFlag; });
export var log = createLogger('[COR3 Auto-Jobs]', 'COR3_AUTOJOB_LOG');
export var waitForHackToBeDone = createWaitForHackToBeDone(log, function () { return state.abortFlag; });

export var SERVER_PRIORITY = FALLBACK_SERVER_PRIORITY;
export var SERVER_PATH_MAP = FALLBACK_PATH_MAP;

// Listen for full map data to update ServerMap dynamically
window.addEventListener('message', function (evt) {
    if (evt.data && evt.data.type === 'COR3_WS_MAP_DATA' && evt.data.servers) {
        serverMap.update({ servers: evt.data.servers, connections: evt.data.connections || [] });
    }
});
