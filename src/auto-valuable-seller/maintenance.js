// Maintenance data fetching and force-maintenance batch for auto-valuable-seller.

import {
    log, delay, sendCmd, waitForEvent, humanDelay,
    running, setRunning,
    setCachedMapData, _cachedMapData,
    _forceMaintenanceRunning, setForceMaintenanceRunning,
    getServerName, getServerPathLength,
    updateMaintenanceUI
} from './state.js';

import { setEndpoint, checkPathMaintenance } from './server-access.js';
import { ensureSearchOnlyLoadout } from './loadout.js';

// ---- Fetch maintenance data and update UI ----

export async function fetchMaintenanceData() {
    log('Fetching maintenance data...');
    setCachedMapData(null);
    sendCmd('get.map', {});
    try {
        var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
        setCachedMapData(mapData);
        if (!mapData || !mapData.servers) return;
        var maintServers = [];
        for (var sid in mapData.servers) {
            var srv = mapData.servers[sid];
            if (srv.timeUntilMaintenance || srv.maintenanceEndsAt) {
                maintServers.push({
                    id: sid,
                    serverName: srv.serverName,
                    timeUntilMaintenance: srv.timeUntilMaintenance || null,
                    maintenanceEndsAt: srv.maintenanceEndsAt || null
                });
            }
        }
        maintServers.sort(function (a, b) {
            var aInMaint = a.maintenanceEndsAt ? 0 : 1;
            var bInMaint = b.maintenanceEndsAt ? 0 : 1;
            if (aInMaint !== bInMaint) return aInMaint - bInMaint;
            var tA = a.timeUntilMaintenance || a.maintenanceEndsAt || '';
            var tB = b.timeUntilMaintenance || b.maintenanceEndsAt || '';
            return tA < tB ? -1 : tA > tB ? 1 : 0;
        });
        log('Maintenance: ' + maintServers.length + ' server(s) with upcoming/active maintenance');
        updateMaintenanceUI({ servers: maintServers });
    } catch (e) {
        log('Maintenance data fetch timeout', 'warn');
    }
}

// ---- Force maintenance batch ----

export async function forceMaintenanceBatch(servers) {
    if (_forceMaintenanceRunning) {
        log('Force maintenance already in progress', 'warn');
        return;
    }
    setForceMaintenanceRunning(true);
    setRunning(true);

    servers.sort(function (a, b) { return getServerPathLength(b.id) - getServerPathLength(a.id); });
    var serverIds = servers.map(function (s) { return s.id; });
    log('\ud83d\udd27 Batch force maintenance: ' + servers.length + ' server(s) \u2014 order: ' + servers.map(function (s) { return s.name; }).join(', '));

    var completed = 0;
    var failed = [];

    for (var i = 0; i < servers.length; i++) {
        var srv = servers[i];
        window.postMessage({ type: 'COR3_VALUABLE_FORCE_MAINT_BATCH_PROGRESS', currentServerId: srv.id, serverIds: serverIds }, '*');

        log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 equipping search software...');

        try {
            var searchPower = await ensureSearchOnlyLoadout(srv.id);
            if (!searchPower) {
                log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: could not equip search software for ' + srv.name, 'error');
                failed.push(srv.name);
                if (i < servers.length - 1) await delay(2000);
                continue;
            }

            log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 sending search-valuable requests...');
            var MAX_ATTEMPTS = 50;
            var maintStarted = false;

            for (var j = 0; j < MAX_ATTEMPTS; j++) {
                if (!running) { log('Batch force maintenance stopped', 'warn'); break; }
                sendCmd('file.search-valuable', { serverId: srv.id });
                var searchResult = await new Promise(function (resolve) {
                    var done = false;
                    var timer = setTimeout(function () {
                        if (done) return;
                        done = true;
                        window.removeEventListener('message', onMsg);
                        resolve('timeout');
                    }, 15000);
                    function onMsg(evt) {
                        if (done) return;
                        if (evt.data && evt.data.type === 'COR3_WS_MAINTENANCE_STARTED') {
                            done = true; clearTimeout(timer);
                            window.removeEventListener('message', onMsg);
                            resolve('maintenance');
                        } else if (evt.data && evt.data.type === 'COR3_VALUABLE_FILE_SEARCH') {
                            done = true; clearTimeout(timer);
                            window.removeEventListener('message', onMsg);
                            var errMsg = evt.data.error && evt.data.error.message;
                            if (errMsg === 'sai-access-denied') {
                                resolve('access-denied');
                            } else {
                                resolve('ok');
                            }
                        }
                    }
                    window.addEventListener('message', onMsg);
                });
                if (searchResult === 'maintenance') { maintStarted = true; break; }
                if (searchResult === 'access-denied') {
                    setCachedMapData(null);
                    sendCmd('get.map', {});
                    try {
                        var mapCheck = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
                        setCachedMapData(mapCheck);
                        if (mapCheck && mapCheck.servers && mapCheck.servers[srv.id] && mapCheck.servers[srv.id].maintenanceEndsAt) {
                            log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 confirmed in maintenance', 'success');
                            maintStarted = true;
                            break;
                        }
                        var reachOk = await setEndpoint(srv.id);
                        if (!reachOk) {
                            var pathBlock = await checkPathMaintenance(getServerName(srv.id));
                            if (pathBlock.blocked) {
                                var bMins = Math.ceil(pathBlock.remainingMs / 60000);
                                log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: cannot reach ' + srv.name + ' \u2014 ' + pathBlock.blockerName + ' in maintenance (~' + bMins + 'm)', 'error');
                                failed.push(srv.name + ' (blocked by ' + pathBlock.blockerName + ')');
                                break;
                            }
                            log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: cannot reach ' + srv.name + ' \u2014 path-through failed', 'error');
                            failed.push(srv.name + ' (unreachable)');
                            break;
                        }
                        await delay(humanDelay());
                    } catch (e) {
                        log('\ud83d\udd27 Batch: map check failed for ' + srv.name + ' \u2014 retrying...', 'warn');
                    }
                    continue;
                }
                await delay(humanDelay());
            }

            if (maintStarted) {
                completed++;
                log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 maintenance started!', 'success');
                window.postMessage({ type: 'COR3_VALUABLE_FORCE_MAINT_SERVER_DONE', serverId: srv.id, serverName: srv.name }, '*');
            } else if (running) {
                log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 did not trigger after ' + MAX_ATTEMPTS + ' attempts', 'warn');
                failed.push(srv.name + ' (max attempts)');
            }
        } catch (e) {
            log('\ud83d\udd27 Batch [' + (i + 1) + '/' + servers.length + ']: ' + srv.name + ' \u2014 error: ' + e.message, 'error');
            failed.push(srv.name + ' (error)');
        }

        if (!running) break;
        if (i < servers.length - 1) await delay(2000);
    }

    log('\ud83d\udd27 Batch force maintenance complete: ' + completed + '/' + servers.length + ' succeeded' + (failed.length > 0 ? ' \u2014 failed: ' + failed.join(', ') : ''), completed === servers.length ? 'success' : 'warn');

    await delay(1500);
    await fetchMaintenanceData();

    setForceMaintenanceRunning(false);
    setRunning(false);
    window.postMessage({ type: 'COR3_VALUABLE_FORCE_MAINT_DONE', success: failed.length === 0 }, '*');
}
