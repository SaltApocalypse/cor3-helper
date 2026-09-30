// Market request functions: HOME, D4RK, SOYUZ, USOL — full fetch, jobs-only, path-through, refresh
import {
    HOME_MARKET_ID, DARK_MARKET_ID, DARK_SERVER_ID,
    SOYUZ_MARKET_ID, SOYUZ_SERVER_ID,
    USOL_MARKET_ID, USOL_SERVER_ID,
    getMarketRefreshAbortId
} from './state.js';
import { wsSend } from './ws-send.js';

function trackMarketRequest(marketId) {
    window.__cor3CurrentMarketFetch = marketId;
}

// Helper: wait for a specific postMessage event type with timeout (MAIN world)
export function __cor3WaitForMsg(eventType, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var timer;
        function handler(evt) {
            if (evt.data && evt.data.type === eventType) {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
                resolve(evt.data);
            }
        }
        window.addEventListener('message', handler);
        timer = setTimeout(function () {
            window.removeEventListener('message', handler);
            reject(new Error('Timeout waiting for ' + eventType));
        }, timeoutMs || 10000);
    });
}

// Ensure access to a server (login status check → hack if needed)
export function __cor3EnsureServerAccess(serverId, serverName) {
    return new Promise(function (resolve, reject) {
        console.log('[COR3 Helper] Path-through: checking access to ' + serverName);
        var getLoginStatus = '42["event",{"event":{"name":"sai","action":"get.login.status"},"data":{"serverId":"' + serverId + '"}}]';
        wsSend(getLoginStatus);
        __cor3WaitForMsg('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000).then(function (loginData) {
            if (loginData.data && loginData.data.activeAccesses && loginData.data.activeAccesses.length > 0) {
                console.log('[COR3 Helper] Path-through: ' + serverName + ' already has access');
                resolve();
                return;
            }
            // Need to hack
            console.log('[COR3 Helper] Path-through: ' + serverName + ' no access — hacking...');
            // Enable decrypt solver for the hack minigame
            window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
            var hackStart = '42["event",{"event":{"name":"sai","action":"hack.start"},"data":{"serverId":"' + serverId + '"}}]';
            wsSend(hackStart);
            __cor3WaitForMsg('COR3_AUTOJOB_SAI_HACK_START', 30000).then(function (hackData) {
                if (hackData.error) {
                    reject(new Error(serverName + ' hack failed: ' + (hackData.error.message || JSON.stringify(hackData.error))));
                    return;
                }
                console.log('[COR3 Helper] Path-through: ' + serverName + ' hack started, waiting for solver...');
                // Wait briefly for SAI update, then check login status
                __cor3WaitForMsg('COR3_AUTOJOB_SAI_UPDATE', 5000).catch(function () {}).then(function () {
                    // Whether SAI update arrived or timed out, check login status
                    var retries = 3;
                    function checkAccess(attempt) {
                        console.log('[COR3 Helper] Path-through: ' + serverName + ' checking access (attempt ' + attempt + '/' + retries + ')');
                        wsSend(getLoginStatus);
                        __cor3WaitForMsg('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000).then(function (data) {
                            if (data.data && data.data.activeAccesses && data.data.activeAccesses.length > 0) {
                                console.log('[COR3 Helper] Path-through: ' + serverName + ' access confirmed');
                                resolve();
                            } else if (attempt < retries) {
                                setTimeout(function () { checkAccess(attempt + 1); }, 3000);
                            } else {
                                reject(new Error(serverName + ' no access after hack'));
                            }
                        }).catch(function () {
                            if (attempt < retries) {
                                setTimeout(function () { checkAccess(attempt + 1); }, 3000);
                            } else {
                                reject(new Error(serverName + ' login status timeout'));
                            }
                        });
                    }
                    setTimeout(function () { checkAccess(1); }, 1500);
                });
            }).catch(function (e) {
                reject(new Error(serverName + ' hack start timeout'));
            });
        }).catch(function () {
            reject(new Error(serverName + ' login status timeout'));
        });
    });
}

// Market config lookup: marketType → { serverId, marketId, flag, unreachableMsg }
var MARKET_CONFIG = {
    dark:  { serverId: DARK_SERVER_ID,  marketId: DARK_MARKET_ID,  flag: '__cor3DarkMarketPathThrough',  unreachableMsg: 'COR3_WS_DARK_MARKET_UNREACHABLE' },
    soyuz: { serverId: SOYUZ_SERVER_ID, marketId: SOYUZ_MARKET_ID, flag: '__cor3SoyuzMarketPathThrough', unreachableMsg: 'COR3_WS_SOYUZ_MARKET_UNREACHABLE' },
    usol:  { serverId: USOL_SERVER_ID,  marketId: USOL_MARKET_ID,  flag: '__cor3UsolMarketPathThrough',  unreachableMsg: 'COR3_WS_USOL_MARKET_UNREACHABLE' }
};

// Fetch network-map data (servers + connections) from game WS.
// Returns Promise<{ servers: Array, connections: Array }> or null on timeout.
export function __cor3FetchMapData() {
    return new Promise(function (resolve) {
        var getMap = '42["event",{"event":{"name":"network-map","action":"get.map"},"data":{}}]';
        wsSend(getMap);
        var done = false;
        function onMap(evt) {
            if (done) return;
            if (evt.data && evt.data.type === 'COR3_WS_MAP_DATA' && evt.data.servers) {
                done = true;
                window.removeEventListener('message', onMap);
                clearTimeout(mapTimer);
                resolve({ servers: evt.data.servers, connections: evt.data.connections || [] });
            }
        }
        window.addEventListener('message', onMap);
        var mapTimer = setTimeout(function () {
            if (!done) {
                done = true;
                window.removeEventListener('message', onMap);
                resolve(null);
            }
        }, 10000);
    });
}

// DFS pathfinder: find all paths from Home to targetServerId.
// Skips intermediate servers that are in maintenance. Returns array of paths,
// each path being an array of { id, name } objects (excluding Home, including target).
// Paths are sorted shortest-first.
export function __cor3FindPathsToServer(servers, connections, targetServerId) {
    var serverLookup = {};
    var adjacency = {};
    var homeId = null;
    for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        serverLookup[s.id] = s;
        adjacency[s.id] = [];
        if (s.serverTypeName === 'Home' || s.serverName === 'Home Server') {
            homeId = s.id;
        }
    }
    for (var j = 0; j < connections.length; j++) {
        var c = connections[j];
        if (adjacency[c.serverA] && adjacency[c.serverB]) {
            adjacency[c.serverA].push(c.serverB);
            adjacency[c.serverB].push(c.serverA);
        }
    }
    if (!homeId) return [];

    var allPaths = [];
    var visited = {};
    var now = Date.now();
    function dfs(currentId, path) {
        if (currentId === targetServerId) {
            allPaths.push(path.slice());
            return;
        }
        var neighbors = adjacency[currentId] || [];
        for (var ni = 0; ni < neighbors.length; ni++) {
            var nb = neighbors[ni];
            if (!visited[nb]) {
                if (nb !== targetServerId) {
                    var nbInfo = serverLookup[nb];
                    if (nbInfo && nbInfo.isInMaintenance) {
                        var mEnd = nbInfo.maintenanceEndsAt ? new Date(nbInfo.maintenanceEndsAt).getTime() - now : 0;
                        if (mEnd > 0) continue;
                    }
                }
                visited[nb] = true;
                var nbSrv = serverLookup[nb];
                path.push({ id: nb, name: nbSrv ? nbSrv.serverName : nb.substring(0, 8) });
                dfs(nb, path);
                path.pop();
                visited[nb] = false;
            }
        }
    }
    visited[homeId] = true;
    dfs(homeId, []);
    allPaths.sort(function (a, b) { return a.length - b.length; });
    return allPaths;
}

// Find the first maintenance blocker on any path to target using map data.
// Returns { blockerName, maintenanceEndsAt } or null.
function __cor3FindMaintenanceBlocker(servers, connections, targetServerId) {
    var serverLookup = {};
    var adjacency = {};
    var homeId = null;
    for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        serverLookup[s.id] = s;
        adjacency[s.id] = [];
        if (s.serverTypeName === 'Home' || s.serverName === 'Home Server') homeId = s.id;
    }
    for (var j = 0; j < connections.length; j++) {
        var c = connections[j];
        if (adjacency[c.serverA] && adjacency[c.serverB]) {
            adjacency[c.serverA].push(c.serverB);
            adjacency[c.serverB].push(c.serverA);
        }
    }
    if (!homeId) return null;
    // Find any path (including through maintenance servers) to identify the blocker
    var visited = {};
    var queue = [homeId];
    var parent = {};
    visited[homeId] = true;
    while (queue.length > 0) {
        var cur = queue.shift();
        if (cur === targetServerId) break;
        var nbrs = adjacency[cur] || [];
        for (var ni = 0; ni < nbrs.length; ni++) {
            if (!visited[nbrs[ni]]) {
                visited[nbrs[ni]] = true;
                parent[nbrs[ni]] = cur;
                queue.push(nbrs[ni]);
            }
        }
    }
    if (!visited[targetServerId]) return { blockerName: 'no-path', maintenanceEndsAt: null };
    // Walk the BFS path and find first maintenance server
    var pathIds = [];
    var at = targetServerId;
    while (at && at !== homeId) { pathIds.unshift(at); at = parent[at]; }
    var now = Date.now();
    for (var pi = 0; pi < pathIds.length; pi++) {
        var srv = serverLookup[pathIds[pi]];
        if (srv && srv.isInMaintenance) {
            var rem = srv.maintenanceEndsAt ? new Date(srv.maintenanceEndsAt).getTime() - now : 0;
            if (rem > 0) return { blockerName: srv.serverName, maintenanceEndsAt: srv.maintenanceEndsAt };
        }
    }
    return null;
}

// Post an UNREACHABLE message with maintenance info fetched dynamically from network-map
export function __cor3PostUnreachable(marketType, serverName) {
    var cfg = MARKET_CONFIG[marketType];
    var msgType = cfg ? cfg.unreachableMsg : 'COR3_WS_DARK_MARKET_UNREACHABLE';
    var targetServerId = cfg ? cfg.serverId : null;
    __cor3FetchMapData().then(function (mapData) {
        var blocker = null;
        if (mapData && targetServerId) {
            blocker = __cor3FindMaintenanceBlocker(mapData.servers, mapData.connections, targetServerId);
        }
        if (blocker) {
            window.__cor3UnreachableMarkets[marketType] = {
                blockerName: blocker.blockerName,
                maintenanceEndsAt: blocker.maintenanceEndsAt,
                detectedAt: Date.now()
            };
            console.log('[COR3 Helper] Cached unreachable ' + marketType + ': ' + blocker.blockerName + ' maintenance until ' + (blocker.maintenanceEndsAt || 'unknown'));
        }
        window.postMessage({
            type: msgType,
            error: 'no-path-to-server',
            blockerServerName: blocker ? blocker.blockerName : (serverName || null),
            maintenanceEndsAt: blocker ? blocker.maintenanceEndsAt : null
        }, '*');
    });
}

// ==================== UNIFIED DYNAMIC PATH-THROUGH ====================

window.__cor3DarkMarketPathThrough = false;
window.__cor3SoyuzMarketPathThrough = false;
window.__cor3UsolMarketPathThrough = false;

// Shared path-through function for any market (dark/soyuz/usol).
// Fetches network map, finds paths via DFS, walks intermediates (set endpoint + hack),
// then retries the target market endpoint.
function __cor3MarketPathThroughRetry(marketType) {
    var cfg = MARKET_CONFIG[marketType];
    if (!cfg) return;
    var label = marketType.toUpperCase();
    window[cfg.flag] = true;
    console.log('[COR3 Helper] Path-through: fetching network map for ' + label + ' dynamic pathing');

    __cor3FetchMapData().then(function (mapData) {
        if (!mapData) {
            window[cfg.flag] = false;
            console.log('[COR3 Helper] Path-through: map data timeout — aborting ' + label);
            __cor3PostUnreachable(marketType, null);
            return;
        }

        var paths = __cor3FindPathsToServer(mapData.servers, mapData.connections, cfg.serverId);
        if (paths.length === 0) {
            window[cfg.flag] = false;
            console.log('[COR3 Helper] Path-through: no viable paths to ' + label + ' (all blocked by maintenance)');
            __cor3PostUnreachable(marketType, null);
            return;
        }

        console.log('[COR3 Helper] Path-through: found ' + paths.length + ' viable path(s) to ' + label);

        var pathIdx = 0;
        function tryNextPath() {
            if (pathIdx >= paths.length) {
                window[cfg.flag] = false;
                console.log('[COR3 Helper] Path-through: all ' + paths.length + ' path(s) exhausted for ' + label);
                __cor3PostUnreachable(marketType, null);
                return;
            }
            var currentPath = paths[pathIdx];
            pathIdx++;
            // Intermediates = all except the last node (the target itself)
            var intermediates = currentPath.length > 1 ? currentPath.slice(0, currentPath.length - 1) : [];
            if (intermediates.length === 0) {
                // Path has no intermediates to hack — retry endpoint directly
                retryTargetEndpoint();
                return;
            }
            var pathNames = currentPath.map(function (s) { return s.name; }).join(' → ');
            console.log('[COR3 Helper] Path-through: trying path ' + pathIdx + '/' + paths.length + ': ' + pathNames);

            var stepIdx = 0;
            function nextStep() {
                if (stepIdx >= intermediates.length) {
                    retryTargetEndpoint();
                    return;
                }
                var server = intermediates[stepIdx];
                stepIdx++;
                console.log('[COR3 Helper] Path-through: step ' + stepIdx + '/' + intermediates.length + ': setting endpoint to ' + server.name);
                var setEp = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + server.id + '"}}]';
                wsSend(setEp);

                var epDone = false;
                function onEndpoint(evt) {
                    if (epDone) return;
                    if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                        epDone = true;
                        window.removeEventListener('message', onEndpoint);
                        clearTimeout(epTimer);
                        if (evt.data.success === false) {
                            var errMsg = evt.data.error && evt.data.error.message ? evt.data.error.message : 'unknown';
                            if (errMsg === 'server-in-maintenance') {
                                console.log('[COR3 Helper] Path-through: ' + server.name + ' in maintenance — trying next path');
                                tryNextPath();
                            } else {
                                console.log('[COR3 Helper] Path-through: ' + server.name + ' unreachable (' + errMsg + ') — trying next path');
                                tryNextPath();
                            }
                            return;
                        }
                        __cor3EnsureServerAccess(server.id, server.name).then(function () {
                            setTimeout(nextStep, 500);
                        }).catch(function (e) {
                            console.log('[COR3 Helper] Path-through: ' + server.name + ' access failed — ' + e.message + ' — trying next path');
                            tryNextPath();
                        });
                    }
                }
                window.addEventListener('message', onEndpoint);
                var epTimer = setTimeout(function () {
                    if (!epDone) {
                        epDone = true;
                        window.removeEventListener('message', onEndpoint);
                        __cor3EnsureServerAccess(server.id, server.name).then(function () {
                            setTimeout(nextStep, 500);
                        }).catch(function () {
                            tryNextPath();
                        });
                    }
                }, 10000);
            }
            nextStep();
        }

        function retryTargetEndpoint() {
            window[cfg.flag] = false;
            console.log('[COR3 Helper] Path-through: all intermediates done, retrying ' + label + ' endpoint');
            var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + cfg.serverId + '"}}]';
            wsSend(setEndpoint);
            var retryDone = false;
            function onRetryResult(evt) {
                if (retryDone) return;
                if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                    retryDone = true;
                    window.removeEventListener('message', onRetryResult);
                    clearTimeout(retryTimer);
                    if (evt.data.success === false) {
                        var retryErr = evt.data.error && evt.data.error.message ? evt.data.error.message : 'unknown';
                        console.log('[COR3 Helper] Path-through: ' + label + ' endpoint retry failed (' + retryErr + ')');
                        __cor3PostUnreachable(marketType, null);
                        return;
                    }
                    console.log('[COR3 Helper] Path-through: ' + label + ' endpoint set successfully');
                    var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + cfg.marketId + '"}}]';
                    wsSend(getOptions);
                }
                if (evt.data && evt.data.type === cfg.unreachableMsg) {
                    retryDone = true;
                    window.removeEventListener('message', onRetryResult);
                    clearTimeout(retryTimer);
                    console.log('[COR3 Helper] Path-through: ' + label + ' endpoint still unreachable after path-through');
                }
            }
            window.addEventListener('message', onRetryResult);
            var retryTimer = setTimeout(function () {
                if (!retryDone) {
                    retryDone = true;
                    window.removeEventListener('message', onRetryResult);
                }
            }, 10000);
        }

        tryNextPath();
    });
}

// ==================== HOME MARKET ====================

window.__cor3RequestMarket = function (callback) {
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Requesting HOME market (batch: options+lots+jobs)');
    trackMarketRequest(HOME_MARKET_ID);
    var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
    var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
    var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
    wsSend(getOptions);
    wsSend(getLots);
    wsSend(getJobs);
    function onComplete(evt) {
        if (!evt.data) return;
        if (myAbortId !== getMarketRefreshAbortId()) {
            window.removeEventListener('message', onComplete);
            clearTimeout(homeTimer);
            console.log('[COR3 Helper] HOME market fetch aborted (token-expired)');
            return;
        }
        if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'home') {
            window.removeEventListener('message', onComplete);
            clearTimeout(homeTimer);
            console.log('[COR3 Helper] HOME market fetch complete');
            if (callback) callback();
        }
    }
    window.addEventListener('message', onComplete);
    var homeTimer = setTimeout(function () {
        window.removeEventListener('message', onComplete);
        console.log('[COR3 Helper] HOME market fetch timeout');
        if (callback) callback();
    }, 15000);
    return true;
};

// ==================== D4RK MARKET ====================

window.__cor3RequestDarkMarket = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('dark');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] D4RK market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
        window.postMessage({
            type: 'COR3_WS_DARK_MARKET_UNREACHABLE',
            error: 'no-path-to-server',
            blockerServerName: cachedUnreachable.blockerName,
            maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
            cached: true
        }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting D4RK endpoint');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + DARK_SERVER_ID + '"}}]';
    window.__cor3DarkMarketPending = true;
    wsSend(setEndpoint);

    function fetchDarkBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) {
            console.log('[COR3 Helper] D4RK market fetch aborted (token-expired)');
            return;
        }
        console.log('[COR3 Helper] Requesting D4RK market (batch: options+lots+jobs)');
        trackMarketRequest(DARK_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
        var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getLots);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] D4RK market fetch aborted (token-expired)');
                return;
            }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'dark') {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] D4RK market fetch complete');
                if (cb) cb();
            }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () {
            window.removeEventListener('message', onComplete);
            console.log('[COR3 Helper] D4RK market fetch timeout');
            if (cb) cb();
        }, 15000);
    }

    var handled = false;
    function onDarkEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) {
            handled = true;
            window.removeEventListener('message', onDarkEndpoint);
            clearTimeout(darkEpTimer);
            window.__cor3DarkMarketPending = false;
            console.log('[COR3 Helper] D4RK endpoint aborted (token-expired)');
            return;
        }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
            handled = true;
            window.removeEventListener('message', onDarkEndpoint);
            clearTimeout(darkEpTimer);
            window.__cor3DarkMarketPending = false;
            fetchDarkBatch(callback);
        }
        if (evt.data && evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
            handled = true;
            window.removeEventListener('message', onDarkEndpoint);
            clearTimeout(darkEpTimer);
            window.__cor3DarkMarketPending = false;
            console.log('[COR3 Helper] D4RK endpoint unreachable — attempting path-through');
            __cor3MarketPathThroughRetry('dark');
            if (callback) callback();
        }
    }
    window.addEventListener('message', onDarkEndpoint);
    var darkEpTimer = setTimeout(function () {
        if (!handled) {
            handled = true;
            window.removeEventListener('message', onDarkEndpoint);
            window.__cor3DarkMarketPending = false;
            console.log('[COR3 Helper] D4RK endpoint timeout — requesting market data anyway');
            fetchDarkBatch(callback);
        }
    }, 5000);
    return true;
};

window.__cor3RefreshMarket = function (callback) {
    window.__cor3RequestMarket(callback);
    return true;
};

window.__cor3RefreshDarkMarket = function (callback) {
    window.__cor3RequestDarkMarket(callback);
    return true;
};

// ==================== SOYUZ MARKET ====================

window.__cor3RequestSoyuzMarket = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('soyuz');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] SOYUZ market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
        window.postMessage({
            type: 'COR3_WS_SOYUZ_MARKET_UNREACHABLE',
            error: 'no-path-to-server',
            blockerServerName: cachedUnreachable.blockerName,
            maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
            cached: true
        }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting SOYUZ endpoint');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + SOYUZ_SERVER_ID + '"}}]';
    window.__cor3SoyuzMarketPending = true;
    wsSend(setEndpoint);

    function fetchSoyuzBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) {
            console.log('[COR3 Helper] SOYUZ market fetch aborted (token-expired)');
            return;
        }
        console.log('[COR3 Helper] Requesting SOYUZ market (batch: options+lots+jobs)');
        trackMarketRequest(SOYUZ_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
        var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getLots);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] SOYUZ market fetch aborted (token-expired)');
                return;
            }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'soyuz') {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] SOYUZ market fetch complete');
                if (cb) cb();
            }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () {
            window.removeEventListener('message', onComplete);
            console.log('[COR3 Helper] SOYUZ market fetch timeout');
            if (cb) cb();
        }, 15000);
    }

    var handled = false;
    function onSoyuzEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) {
            handled = true;
            window.removeEventListener('message', onSoyuzEndpoint);
            clearTimeout(soyuzEpTimer);
            window.__cor3SoyuzMarketPending = false;
            console.log('[COR3 Helper] SOYUZ endpoint aborted (token-expired)');
            return;
        }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
            handled = true;
            window.removeEventListener('message', onSoyuzEndpoint);
            clearTimeout(soyuzEpTimer);
            window.__cor3SoyuzMarketPending = false;
            fetchSoyuzBatch(callback);
        }
        if (evt.data && evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
            handled = true;
            window.removeEventListener('message', onSoyuzEndpoint);
            clearTimeout(soyuzEpTimer);
            window.__cor3SoyuzMarketPending = false;
            console.log('[COR3 Helper] SOYUZ endpoint unreachable — attempting path-through');
            __cor3MarketPathThroughRetry('soyuz');
            if (callback) callback();
        }
    }
    window.addEventListener('message', onSoyuzEndpoint);
    var soyuzEpTimer = setTimeout(function () {
        if (!handled) {
            handled = true;
            window.removeEventListener('message', onSoyuzEndpoint);
            window.__cor3SoyuzMarketPending = false;
            console.log('[COR3 Helper] SOYUZ endpoint timeout');
            if (callback) callback();
        }
    }, 10000);
    return true;
};

window.__cor3RefreshSoyuzMarket = function (callback) {
    window.__cor3RequestSoyuzMarket(callback);
    return true;
};

// ==================== USOL MARKET ====================

window.__cor3RequestUsolMarket = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('usol');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] USOL market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping set.endpoint');
        window.postMessage({
            type: 'COR3_WS_USOL_MARKET_UNREACHABLE',
            error: 'no-path-to-server',
            blockerServerName: cachedUnreachable.blockerName,
            maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt,
            cached: true
        }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting USOL endpoint');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
    window.__cor3UsolMarketPending = true;
    wsSend(setEndpoint);

    function fetchUsolBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) {
            console.log('[COR3 Helper] USOL market fetch aborted (token-expired)');
            return;
        }
        console.log('[COR3 Helper] Requesting USOL market (batch: options+lots+jobs)');
        trackMarketRequest(USOL_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
        var getLots = '42["event",{"event":{"name":"market","action":"get.lots"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getLots);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] USOL market fetch aborted (token-expired)');
                return;
            }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'usol') {
                window.removeEventListener('message', onComplete);
                clearTimeout(tmr);
                console.log('[COR3 Helper] USOL market fetch complete');
                if (cb) cb();
            }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () {
            window.removeEventListener('message', onComplete);
            console.log('[COR3 Helper] USOL market fetch timeout');
            if (cb) cb();
        }, 15000);
    }

    var handled = false;
    function onUsolEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) {
            handled = true;
            window.removeEventListener('message', onUsolEndpoint);
            clearTimeout(usolEpTimer);
            window.__cor3UsolMarketPending = false;
            console.log('[COR3 Helper] USOL endpoint aborted (token-expired)');
            return;
        }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
            handled = true;
            window.removeEventListener('message', onUsolEndpoint);
            clearTimeout(usolEpTimer);
            window.__cor3UsolMarketPending = false;
            fetchUsolBatch(callback);
        }
        if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
            handled = true;
            window.removeEventListener('message', onUsolEndpoint);
            clearTimeout(usolEpTimer);
            window.__cor3UsolMarketPending = false;
            console.log('[COR3 Helper] USOL endpoint unreachable — attempting path-through');
            __cor3MarketPathThroughRetry('usol');
            if (callback) callback();
        }
    }
    window.addEventListener('message', onUsolEndpoint);
    var usolEpTimer = setTimeout(function () {
        if (!handled) {
            handled = true;
            window.removeEventListener('message', onUsolEndpoint);
            window.__cor3UsolMarketPending = false;
            console.log('[COR3 Helper] USOL endpoint timeout');
            if (callback) callback();
        }
    }, 10000);
    return true;
};

window.__cor3RefreshUsolMarket = function (callback) {
    window.__cor3RequestUsolMarket(callback);
    return true;
};

// ==================== SEQUENTIAL ALL-MARKETS REFRESH ====================

window.__cor3RefreshAllMarketsSequential = function (callback, opts) {
    opts = opts || {};
    var order = opts.order || ['usol', 'soyuz', 'dark', 'home'];
    var skipLots = !!opts.skipLots;
    var idx = 0;
    var myAbortId = getMarketRefreshAbortId();

    function refreshNext() {
        if (myAbortId !== getMarketRefreshAbortId()) {
            console.log('[COR3 Helper] Sequential refresh aborted (token-expired)');
            window.postMessage({ type: 'COR3_ALL_MARKETS_REFRESHED' }, '*');
            return;
        }
        if (idx >= order.length) {
            console.log('[COR3 Helper] Sequential refresh: all markets done');
            window.postMessage({ type: 'COR3_ALL_MARKETS_REFRESHED' }, '*');
            if (callback) callback();
            return;
        }
        var market = order[idx];
        idx++;
        console.log('[COR3 Helper] Sequential refresh: starting ' + market.toUpperCase());
        if (market === 'usol') {
            if (skipLots) {
                window.__cor3RequestUsolMarketJobsOnly(function () { refreshNext(); });
            } else {
                window.__cor3RequestUsolMarket(function () { refreshNext(); });
            }
        } else if (market === 'soyuz') {
            if (skipLots) {
                window.__cor3RequestSoyuzMarketJobsOnly(function () { refreshNext(); });
            } else {
                window.__cor3RequestSoyuzMarket(function () { refreshNext(); });
            }
        } else if (market === 'dark') {
            if (skipLots) {
                window.__cor3RequestDarkMarketJobsOnly(function () { refreshNext(); });
            } else {
                window.__cor3RequestDarkMarket(function () { refreshNext(); });
            }
        } else {
            if (skipLots) {
                window.__cor3RequestMarketJobsOnly(function () { refreshNext(); });
            } else {
                window.__cor3RequestMarket(function () { refreshNext(); });
            }
        }
    }
    refreshNext();
    return true;
};

// ==================== JOBS-ONLY FETCH VARIANTS ====================

window.__cor3RequestMarketJobsOnly = function (callback) {
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Requesting HOME market (batch: options+jobs, jobs-only)');
    trackMarketRequest(HOME_MARKET_ID);
    var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
    var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + HOME_MARKET_ID + '"}}]';
    wsSend(getOptions);
    wsSend(getJobs);
    function onComplete(evt) {
        if (!evt.data) return;
        if (myAbortId !== getMarketRefreshAbortId()) {
            window.removeEventListener('message', onComplete);
            clearTimeout(tmr);
            return;
        }
        if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'home') {
            window.removeEventListener('message', onComplete);
            clearTimeout(tmr);
            console.log('[COR3 Helper] HOME market jobs-only fetch complete');
            if (callback) callback();
        }
    }
    window.addEventListener('message', onComplete);
    var tmr = setTimeout(function () {
        window.removeEventListener('message', onComplete);
        console.log('[COR3 Helper] HOME market jobs-only fetch timeout');
        if (callback) callback();
    }, 15000);
};

window.__cor3RequestDarkMarketJobsOnly = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('dark');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] D4RK market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
        window.postMessage({ type: 'COR3_WS_DARK_MARKET_UNREACHABLE', error: 'no-path-to-server', blockerServerName: cachedUnreachable.blockerName, maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt, cached: true }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting D4RK endpoint (jobs-only)');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + DARK_SERVER_ID + '"}}]';
    window.__cor3DarkMarketPending = true;
    wsSend(setEndpoint);

    function fetchDarkJobsBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) { console.log('[COR3 Helper] D4RK market jobs-only fetch aborted (token-expired)'); return; }
        console.log('[COR3 Helper] Requesting D4RK market (batch: options+jobs, jobs-only)');
        trackMarketRequest(DARK_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + DARK_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) { window.removeEventListener('message', onComplete); clearTimeout(tmr); return; }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'dark') { window.removeEventListener('message', onComplete); clearTimeout(tmr); console.log('[COR3 Helper] D4RK market jobs-only fetch complete'); if (cb) cb(); }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () { window.removeEventListener('message', onComplete); console.log('[COR3 Helper] D4RK market jobs-only fetch timeout'); if (cb) cb(); }, 15000);
    }

    var handled = false;
    function onEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3DarkMarketPending = false; return; }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3DarkMarketPending = false; fetchDarkJobsBatch(callback); }
        if (evt.data && evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3DarkMarketPending = false; console.log('[COR3 Helper] D4RK endpoint unreachable (jobs-only) — attempting path-through'); __cor3MarketPathThroughRetry('dark'); if (callback) callback(); }
    }
    window.addEventListener('message', onEndpoint);
    var epTmr = setTimeout(function () { if (!handled) { handled = true; window.removeEventListener('message', onEndpoint); window.__cor3DarkMarketPending = false; console.log('[COR3 Helper] D4RK endpoint timeout (jobs-only) — requesting data anyway'); fetchDarkJobsBatch(callback); } }, 5000);
};

window.__cor3RequestSoyuzMarketJobsOnly = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('soyuz');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] SOYUZ market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
        window.postMessage({ type: 'COR3_WS_SOYUZ_MARKET_UNREACHABLE', error: 'no-path-to-server', blockerServerName: cachedUnreachable.blockerName, maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt, cached: true }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting SOYUZ endpoint (jobs-only)');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + SOYUZ_SERVER_ID + '"}}]';
    window.__cor3SoyuzMarketPending = true;
    wsSend(setEndpoint);

    function fetchSoyuzJobsBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) { console.log('[COR3 Helper] SOYUZ market jobs-only fetch aborted (token-expired)'); return; }
        console.log('[COR3 Helper] Requesting SOYUZ market (batch: options+jobs, jobs-only)');
        trackMarketRequest(SOYUZ_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + SOYUZ_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) { window.removeEventListener('message', onComplete); clearTimeout(tmr); return; }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'soyuz') { window.removeEventListener('message', onComplete); clearTimeout(tmr); console.log('[COR3 Helper] SOYUZ market jobs-only fetch complete'); if (cb) cb(); }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () { window.removeEventListener('message', onComplete); console.log('[COR3 Helper] SOYUZ market jobs-only fetch timeout'); if (cb) cb(); }, 15000);
    }

    var handled = false;
    function onEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3SoyuzMarketPending = false; return; }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3SoyuzMarketPending = false; fetchSoyuzJobsBatch(callback); }
        if (evt.data && evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3SoyuzMarketPending = false; console.log('[COR3 Helper] SOYUZ endpoint unreachable (jobs-only) — attempting path-through'); __cor3MarketPathThroughRetry('soyuz'); if (callback) callback(); }
    }
    window.addEventListener('message', onEndpoint);
    var epTmr = setTimeout(function () { if (!handled) { handled = true; window.removeEventListener('message', onEndpoint); window.__cor3SoyuzMarketPending = false; console.log('[COR3 Helper] SOYUZ endpoint timeout (jobs-only)'); if (callback) callback(); } }, 10000);
};

window.__cor3RequestUsolMarketJobsOnly = function (callback) {
    var cachedUnreachable = window.__cor3IsMarketUnreachable('usol');
    if (cachedUnreachable) {
        console.log('[COR3 Helper] USOL market known unreachable (' + cachedUnreachable.blockerName + ' maintenance) — skipping jobs-only');
        window.postMessage({ type: 'COR3_WS_USOL_MARKET_UNREACHABLE', error: 'no-path-to-server', blockerServerName: cachedUnreachable.blockerName, maintenanceEndsAt: cachedUnreachable.maintenanceEndsAt, cached: true }, '*');
        if (callback) callback();
        return true;
    }
    var myAbortId = getMarketRefreshAbortId();
    console.log('[COR3 Helper] Setting USOL endpoint (jobs-only)');
    var setEndpoint = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + USOL_SERVER_ID + '"}}]';
    window.__cor3UsolMarketPending = true;
    wsSend(setEndpoint);

    function fetchUsolJobsBatch(cb) {
        if (myAbortId !== getMarketRefreshAbortId()) { console.log('[COR3 Helper] USOL market jobs-only fetch aborted (token-expired)'); return; }
        console.log('[COR3 Helper] Requesting USOL market (batch: options+jobs, jobs-only)');
        trackMarketRequest(USOL_MARKET_ID);
        var getOptions = '42["event",{"event":{"name":"market","action":"get.options"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
        var getJobs = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + USOL_MARKET_ID + '"}}]';
        wsSend(getOptions);
        wsSend(getJobs);
        function onComplete(evt) {
            if (!evt.data) return;
            if (myAbortId !== getMarketRefreshAbortId()) { window.removeEventListener('message', onComplete); clearTimeout(tmr); return; }
            if (evt.data.type === 'COR3_MARKET_FETCH_COMPLETE' && evt.data.marketType === 'usol') { window.removeEventListener('message', onComplete); clearTimeout(tmr); console.log('[COR3 Helper] USOL market jobs-only fetch complete'); if (cb) cb(); }
        }
        window.addEventListener('message', onComplete);
        var tmr = setTimeout(function () { window.removeEventListener('message', onComplete); console.log('[COR3 Helper] USOL market jobs-only fetch timeout'); if (cb) cb(); }, 15000);
    }

    var handled = false;
    function onEndpoint(evt) {
        if (handled) return;
        if (myAbortId !== getMarketRefreshAbortId()) { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3UsolMarketPending = false; return; }
        if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3UsolMarketPending = false; fetchUsolJobsBatch(callback); }
        if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') { handled = true; window.removeEventListener('message', onEndpoint); clearTimeout(epTmr); window.__cor3UsolMarketPending = false; console.log('[COR3 Helper] USOL endpoint unreachable (jobs-only) — attempting path-through'); __cor3MarketPathThroughRetry('usol'); if (callback) callback(); }
    }
    window.addEventListener('message', onEndpoint);
    var epTmr = setTimeout(function () { if (!handled) { handled = true; window.removeEventListener('message', onEndpoint); window.__cor3UsolMarketPending = false; console.log('[COR3 Helper] USOL endpoint timeout (jobs-only)'); if (callback) callback(); } }, 10000);
};
