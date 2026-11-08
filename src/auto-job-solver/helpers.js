// Auto Job Solver — helper functions: tracker, map fetch, loadout orchestration, priority.

import { MARKET_DISPLAY_NAMES, JOB_TYPE_PRIORITY, LOG_JOB_TYPES, getMarketNameById } from '../shared/server-constants.js';
import { humanDelay, safeTimeout, safeClearTimeout } from '../shared/ws-utils.js';
import { formatMinigameLockError, ensureDecryptSolverEnabled, ensureIceWallSolverEnabled, ensureSimpleDecryptSolverEnabled } from '../shared/hack-utils.js';
import { friendlyError } from '../shared/error-map.js';
import { calculateAnalysis, abilityPower, findHackSoftwareForServerType, findDecryptSoftwareForFileType, findBestSoftwareForAbility, sameHardware, getServerTypeName } from '../shared/loadout-resolver.js';
import { state, serverMap, sendCmd, delay, waitForEvent, log, SERVER_PRIORITY, SERVER_PATH_MAP } from './state.js';

// ---- Priority helpers ----

export function isJobBugged(job) {
    return job.serverName === 'D4RK RM7CE' && LOG_JOB_TYPES.indexOf(job.type || job.name) >= 0;
}

export function getServerPriority(serverName) {
    if (!serverName || serverName === 'None') return -1;
    if (serverMap.isReady()) {
        return serverMap.getServerPriorityIndex(serverName);
    }
    var idx = SERVER_PRIORITY.indexOf(serverName);
    return idx >= 0 ? idx : SERVER_PRIORITY.length;
}

export function getJobTypePriority(typeName) {
    var idx = JOB_TYPE_PRIORITY.indexOf(typeName);
    return idx >= 0 ? idx : JOB_TYPE_PRIORITY.length;
}

// ---- Tracker / persistence ----

export function updateTracker() {
    window.postMessage({ type: 'COR3_AUTOJOB_TRACKER_UPDATE', tracker: state.jobQueue }, '*');
}

export function saveCompletedResultsIncremental() {
    var results = state.jobQueue.filter(function (j) { return j.status === 'done' || j.status === 'failed' || j.status === 'skipped' || j.status === 'bugged'; }).map(function (j) {
        return {
            jobId: j.jobId, name: j.name, type: j.type, serverName: j.serverName,
            marketKey: j.marketKey, status: j.status, reward: j.reward || null,
            error: j.error || null, completedAt: Date.now(),
            maintenanceEndsAt: j.maintenanceEndsAt || null,
            lockExpiresAt: j.lockExpiresAt || null
        };
    });
    window.postMessage({ type: 'COR3_AUTOJOB_SAVE_COMPLETED', jobs: results }, '*');
}

export function signalDone() {
    state.running = false;
    state._currentJobRef = null;
    window.postMessage({ type: 'COR3_AUTOJOB_DONE', tokenExpired: state.tokenExpired }, '*');
}

// ---- Network map fetch ----

export async function fetchMapData(forceRefresh) {
    if (!forceRefresh && state._cachedMapData) return state._cachedMapData;
    var oldFingerprint = serverMap.isReady() ? serverMap.getMaintenanceFingerprint() : null;
    var fullDataPromise = new Promise(function (resolve) {
        var t;
        function onFullMap(evt) {
            if (evt.data && evt.data.type === 'COR3_WS_MAP_DATA' && evt.data.servers) {
                window.removeEventListener('message', onFullMap);
                clearTimeout(t);
                resolve({ servers: evt.data.servers, connections: evt.data.connections || [] });
            }
        }
        window.addEventListener('message', onFullMap);
        t = setTimeout(function () { window.removeEventListener('message', onFullMap); resolve(null); }, 12000);
    });
    sendCmd('get.map', {});
    var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
    if (mapData && mapData.servers) {
        state._cachedMapData = mapData;
        var fullData = await fullDataPromise;
        if (fullData) {
            serverMap.update(fullData);
            var newFingerprint = serverMap.getMaintenanceFingerprint();
            if (oldFingerprint !== null && oldFingerprint !== newFingerprint) {
                log('Server state changed — path cache refreshed');
            }
        }
    }
    return mapData;
}

export async function checkPathMaintenance(serverName) {
    if (serverMap.isReady()) {
        return serverMap.checkPathMaintenance(serverName);
    }
    var path = SERVER_PATH_MAP[serverName];
    if (!path) return { blocked: false };
    var mapData = await fetchMapData();
    if (!mapData || !mapData.servers) return { blocked: false };
    for (var i = 0; i < path.length; i++) {
        var srv = path[i];
        var srvInfo = mapData.servers[srv.id];
        if (srvInfo && srvInfo.isInMaintenance) {
            var remaining = srvInfo.maintenanceEndsAt ? new Date(srvInfo.maintenanceEndsAt).getTime() - Date.now() : 0;
            if (remaining > 0) {
                return { blocked: true, blockerName: srv.name, endsAt: srvInfo.maintenanceEndsAt, remainingMs: remaining };
            }
        }
    }
    return { blocked: false };
}

// ---- Server name/path lookups ----

export function getServerNameById(serverId) {
    if (serverMap.isReady()) {
        var s = serverMap.getServer(serverId);
        if (s) return s.name;
    }
    for (var name in SERVER_PATH_MAP) {
        var path = SERVER_PATH_MAP[name];
        for (var i = 0; i < path.length; i++) {
            if (path[i].id === serverId) return path[i].name;
        }
    }
    return null;
}

export function getPathForServerId(serverId) {
    if (serverMap.isReady()) {
        var path = serverMap.getShortestPath(serverId);
        if (path) return path;
    }
    for (var name in SERVER_PATH_MAP) {
        var path = SERVER_PATH_MAP[name];
        if (path.length > 0 && path[path.length - 1].id === serverId) {
            return path;
        }
    }
    return null;
}

// ---- Loadout orchestration ----

export function invalidateLoadoutCache() {
    state._cachedLoadout = null;
    state._cachedLoadoutAt = 0;
}

function hardwareLabel(hw) {
    if (!hw) return 'none';
    return ['cpu', 'gpu', 'ram', 'psu'].map(function (slot) {
        return hw[slot] ? hw[slot].name : 'none';
    }).join(' / ');
}

export async function getLoadoutData(forceRefresh) {
    if (!forceRefresh && state._cachedLoadout && (Date.now() - state._cachedLoadoutAt < 60000)) {
        log('Loadout: using cached data (age: ' + Math.round((Date.now() - state._cachedLoadoutAt) / 1000) + 's)');
        return state._cachedLoadout;
    }
    var now = Date.now();
    if (!forceRefresh && now - state._lastLoadoutFetchAt < state.LOADOUT_COOLDOWN_MS) {
        log('Loadout: fetch cooldown active (' + Math.round(state.LOADOUT_COOLDOWN_MS - (now - state._lastLoadoutFetchAt)) + 'ms remaining) — using cached', 'warn');
        return state._cachedLoadout;
    }
    state._lastLoadoutFetchAt = now;
    log('Loadout: fetching fresh data...');
    sendCmd('loadout.get', {});
    try {
        var data = await waitForEvent('COR3_AUTOJOB_LOADOUT', 10000);
        if (data && data.data) {
            state._cachedLoadout = data.data;
            state._cachedLoadoutAt = Date.now();
            var eqSw = state._cachedLoadout.equippedSoftware || [];
            log('Loadout: got ' + ((state._cachedLoadout.ownedSoftware || []).length) + ' owned, ' + eqSw.length + ' equipped software');
            return state._cachedLoadout;
        }
    } catch (e) {
        log('Loadout: fetch timed out — ' + e.message, 'warn');
    }
    log('Loadout: no data available', 'warn');
    return null;
}

async function waitForEquippedSoftware(targetSwIds) {
    for (var attempt = 0; attempt < 3; attempt++) {
        var fresh = await getLoadoutData(true);
        var equipped = (fresh && fresh.equippedSoftware) || [];
        var ids = equipped.map(function (s) { return s.id; });
        var ok = targetSwIds.every(function (id) { return ids.indexOf(id) >= 0; });
        if (ok) return fresh;
        if (attempt < 2) await delay(1000);
    }
    return null;
}

export async function applyLoadoutChange(loadout, targetHw, targetSwIds) {
    var currentHw = loadout.equippedHardware || {};
    var currentSw = (loadout.equippedSoftware || []).map(function (s) { return s.id; });

    var hwCategories = ['cpu', 'gpu', 'ram', 'psu'];
    for (var ci = 0; ci < hwCategories.length; ci++) {
        var cat = hwCategories[ci];
        var tgt = targetHw[cat];
        var cur = currentHw[cat];
        if (tgt && (!cur || cur.id !== tgt.id)) {
            log('Loadout: equipping ' + cat.toUpperCase() + ': ' + tgt.name);
            sendCmd('loadout.equip.hardware', { moduleConfigId: tgt.id });
            try { await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000); } catch (e) { /* continue */ }
            await delay(humanDelay());
        }
    }

    for (var ui = 0; ui < currentSw.length; ui++) {
        if (targetSwIds.indexOf(currentSw[ui]) < 0) {
            log('Loadout: unequipping software: ' + currentSw[ui]);
            sendCmd('loadout.unequip.software', { moduleConfigId: currentSw[ui] });
            try { await waitForEvent('COR3_AUTOJOB_LOADOUT', 5000); } catch (e) { /* continue */ }
            await delay(500);
        }
    }

    for (var ei = 0; ei < targetSwIds.length; ei++) {
        if (currentSw.indexOf(targetSwIds[ei]) < 0) {
            log('Loadout: equipping software: ' + targetSwIds[ei]);
            sendCmd('loadout.equip.software', { moduleConfigId: targetSwIds[ei] });
            try { await waitForEvent('COR3_AUTOJOB_LOADOUT', 5000); } catch (e) { /* continue */ }
            await delay(500);
        }
    }

    invalidateLoadoutCache();
    await delay(humanDelay());

    if (changed) {
        var verified = await waitForEquippedSoftware(targetSwIds);
        if (!verified) {
            log('Loadout: target software not visible after apply — re-equipping once', 'warn');
            for (var rei = 0; rei < targetSwIds.length; rei++) {
                sendCmd('loadout.equip.software', { moduleConfigId: targetSwIds[rei] });
                try { await waitForEvent('COR3_AUTOJOB_LOADOUT', 5000); } catch (e) { /* continue */ }
                await delay(500);
            }
            verified = await waitForEquippedSoftware(targetSwIds);
        }
        if (verified) log('Loadout: verified target software is equipped');
        return verified || await getLoadoutData(true);
    }
    return loadout;
}

export async function ensureLoadoutForJob(job) {
    var serverId = job.serverId;
    if (!serverId) {
        log('Loadout: job has no target server — skipping loadout check');
        return true;
    }

    var serverTypeName = getServerTypeName(serverId);
    state._lastLoadoutServerType = serverTypeName || state._lastLoadoutServerType;
    log('Loadout: pre-check for job "' + (job.type || job.name || '?') + '" on server ' + (serverTypeName || serverId));

    var serverDefenceRate = 0;
    var needsHack = true;
    try {
        sendCmd('get.login.status', { serverId: serverId });
        var preLoginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
        if (preLoginData && preLoginData.data) {
            if (preLoginData.data.serverDefenceRate) {
                serverDefenceRate = preLoginData.data.serverDefenceRate;
            }
            if (preLoginData.data.activeAccesses && preLoginData.data.activeAccesses.length > 0) {
                var existingAccess = preLoginData.data.activeAccesses[0];
                var existingType = existingAccess.accessType || existingAccess.type || 'unknown';
                log('Loadout: already have ' + existingType + ' access on target server — skipping hack loadout');
                needsHack = false;
            }
        }
    } catch (e) {
        log('Loadout: could not check login status — assuming hack needed', 'warn');
    }

    if (!needsHack) {
        log('Loadout: pre-check complete — no hack needed for "' + (job.type || job.name || '?') + '"');
        return true;
    }

    if (!serverTypeName) {
        log('Loadout: cannot determine server type — skipping hack loadout');
        return true;
    }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data — proceeding without loadout check', 'warn');
        return true;
    }

    var allSw = loadout.ownedSoftware || [];
    var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
    log('Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName);
    if (hackCandidates.length === 0) {
        log('Loadout: no hack software available for ' + serverTypeName + ' — proceeding (may use existing access)', 'warn');
        return true;
    }

    var plan = findBestSoftwareForAbility(loadout, hackCandidates, 'HACK', serverDefenceRate, serverTypeName);
    if (!plan) {
        log('Loadout: no bootable HACK plan found for ' + serverTypeName, 'warn');
        return true;
    }

    log('Loadout: best HACK plan "' + plan.software.name + '" — power: ' + plan.power +
        (serverDefenceRate > 0 ? ' / required: ' + serverDefenceRate : '') +
        (plan.sufficient ? ' ✓' : ' ✗') + ' — hardware: ' + hardwareLabel(plan.hardware));
    if (serverDefenceRate > 0 && !plan.sufficient) {
        log('Loadout: best achievable HACK power is below serverDefenceRate (' + serverDefenceRate + ')', 'error');
    }

    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var currentHw = loadout.equippedHardware || {};
    var sameSw = currentSwIds.length === 1 && currentSwIds[0] === plan.softwareId;
    var sameHw = sameHardware(currentHw, plan.hardware);
    if (sameSw && sameHw) {
        log('Loadout: best HACK software and hardware already equipped');
    } else {
        log('Loadout: equipping HACK software "' + plan.software.name + '" (computed power: ' + plan.power + ') for ' + serverTypeName);
        await applyLoadoutChange(loadout, plan.hardware, [plan.softwareId]);
    }

    log('Loadout: pre-check complete for "' + (job.type || job.name || '?') + '"');
    return true;
}

export async function ensureDecryptOnlyLoadout(job) {
    var fileType = null;
    if (job.conditions && job.conditions.items) {
        for (var ci = 0; ci < job.conditions.items.length; ci++) {
            var cond = job.conditions.items[ci];
            if (cond.details && cond.details.fileExtension) {
                fileType = cond.details.fileExtension;
                if (fileType && fileType[0] !== '.') fileType = '.' + fileType;
                break;
            }
        }
    }
    if (!fileType && job.fileType) {
        fileType = job.fileType;
    }
    if (!fileType) {
        log('Loadout: decrypt job but file type unknown — will rely on error retry', 'warn');
        return;
    }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data — proceeding without decrypt loadout', 'warn');
        return;
    }

    var allSw = loadout.ownedSoftware || [];
    var decryptCandidates = findDecryptSoftwareForFileType(allSw, fileType);
    if (decryptCandidates.length === 0) {
        log('Loadout: no decrypt software available for ' + fileType, 'warn');
        return;
    }

    var plan = findBestSoftwareForAbility(loadout, decryptCandidates, 'DECRYPT', 0, fileType);
    if (!plan) {
        log('Loadout: no bootable DECRYPT plan found for ' + fileType, 'warn');
        return;
    }

    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var currentHw = loadout.equippedHardware || {};
    var sameSw = currentSwIds.length === 1 && currentSwIds[0] === plan.softwareId;
    var sameHw = sameHardware(currentHw, plan.hardware);
    if (sameSw && sameHw) {
        log('Loadout: best DECRYPT software and hardware already equipped (power: ' + plan.power + ')');
        return;
    }

    log('Loadout: equipping DECRYPT software "' + plan.software.name + '" (computed power: ' + plan.power + ', hardware: ' + hardwareLabel(plan.hardware) + ') for ' + fileType);
    await applyLoadoutChange(loadout, plan.hardware, [plan.softwareId]);
}

export async function checkDecryptPowerViaAnalysis(fileId, job) {
    sendCmd('get.file.analysis', { fileId: fileId });
    try {
        var analysis = await waitForEvent('COR3_AUTOJOB_FILE_ANALYSIS', 8000);
        if (analysis && analysis.data) {
            var canDecrypt = analysis.data.canDecrypt;
            if (canDecrypt === false) {
                log('Decrypt power check: insufficient (required: ' + (analysis.data.decryptPower || '?') + ')', 'warn');
                return false;
            }
            log('Decrypt power check: OK');
            return true;
        }
    } catch (e) {
        log('Decrypt power check: analysis timed out — proceeding anyway', 'warn');
    }
    return true;
}

export async function tryLoadoutSwapForError(errorMsg, job, errorObj) {
    if (!errorMsg) return false;
    log('Loadout: tryLoadoutSwapForError — error="' + errorMsg + '"');

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: cannot retry — no loadout data available', 'warn');
        return false;
    }

    var allSw = loadout.ownedSoftware || [];
    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var currentHw = loadout.equippedHardware || {};

    function targetPower(abilityType, target) {
        var analysis = calculateAnalysis(loadout, currentSwIds);
        var best = 0;
        for (var i = 0; i < currentSwIds.length; i++) {
            var power = abilityPower(analysis, currentSwIds[i], abilityType, target);
            if (power > best) best = power;
        }
        return best;
    }

    async function applyPlan(plan, abilityType, target, requiredPower) {
        if (!plan) {
            log('Loadout: no bootable ' + abilityType + ' plan found', 'warn');
            return false;
        }
        var currentPower = targetPower(abilityType, target);
        var sameSw = currentSwIds.length === 1 && currentSwIds[0] === plan.softwareId;
        var sameHw = sameHardware(currentHw, plan.hardware);
        log('Loadout: best ' + abilityType + ' plan "' + plan.software.name + '" — power: ' + plan.power +
            (requiredPower > 0 ? ' / required: ' + requiredPower : '') +
            ' / current: ' + currentPower +
            (plan.sufficient ? ' ✓' : ' ✗'));
        if (sameSw && sameHw) {
            log('Loadout: best ' + abilityType + ' plan is already equipped');
            return false;
        }
        if (requiredPower > 0 && !plan.sufficient) {
            log('Loadout: no ' + abilityType + ' plan can meet the required power (' + requiredPower + ')', 'error');
            return false;
        }
        if (plan.power <= currentPower && sameSw) {
            log('Loadout: no ' + abilityType + ' improvement available without changing software', 'warn');
            return false;
        }
        log('Loadout: applying ' + abilityType + ' plan "' + plan.software.name + '" (power: ' + plan.power + ', hardware: ' + hardwareLabel(plan.hardware) + ')');
        await applyLoadoutChange(loadout, plan.hardware, [plan.softwareId]);
        return true;
    }

    if (errorMsg.indexOf('sai-no-hack-software') >= 0 || errorMsg.indexOf('sai-hack-impossible') >= 0) {
        var serverId = job.serverId;
        var serverTypeName = getServerTypeName(serverId);
        if (!serverTypeName) {
            log('Loadout: cannot determine server type for ' + serverId, 'warn');
            return false;
        }

        var serverDefenceRate = 0;
        try {
            sendCmd('get.login.status', { serverId: serverId });
            var loginStatus = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
            if (loginStatus && loginStatus.data && loginStatus.data.serverDefenceRate) {
                serverDefenceRate = loginStatus.data.serverDefenceRate;
            }
        } catch (e) { }

        var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
        if (hackCandidates.length === 0) {
            log('Loadout: no hack software available for ' + serverTypeName, 'warn');
            return false;
        }
        var hackPlan = findBestSoftwareForAbility(loadout, hackCandidates, 'HACK', serverDefenceRate, serverTypeName);
        return await applyPlan(hackPlan, 'HACK', serverTypeName, serverDefenceRate);
    }

    if (errorMsg.indexOf('missing-software') >= 0 || errorMsg.indexOf('File is encrypted') >= 0 ||
        errorMsg.indexOf('insufficient_power') >= 0 || errorMsg.indexOf('insufficient-power') >= 0) {
        var fileType = null;
        if (job.conditions && job.conditions.items) {
            for (var ci = 0; ci < job.conditions.items.length; ci++) {
                var cond = job.conditions.items[ci];
                if (cond.details && cond.details.fileExtension) {
                    fileType = cond.details.fileExtension;
                    if (fileType && fileType[0] !== '.') fileType = '.' + fileType;
                    break;
                }
            }
        }
        if (!fileType && job.fileType) fileType = job.fileType;
        if (!fileType) {
            var extMatch = errorMsg.match(/decrypt\s+(\.\w+)\s+extension/i);
            if (extMatch) fileType = extMatch[1];
        }
        if (!fileType) {
            log('Loadout: decrypt failed but file type unknown — cannot swap software', 'warn');
            return false;
        }

        var requiredPower = (errorObj && errorObj.required) || 0;
        var decryptCandidates = findDecryptSoftwareForFileType(allSw, fileType);
        if (decryptCandidates.length === 0) {
            log('Loadout: no decrypt software available for ' + fileType, 'warn');
            return false;
        }
        var decryptPlan = findBestSoftwareForAbility(loadout, decryptCandidates, 'DECRYPT', requiredPower, fileType);
        return await applyPlan(decryptPlan, 'DECRYPT', fileType, requiredPower);
    }

    return false;
}

// ---- Job label formatting ----

export function jobLabel(job) {
    var parts = [job.name || job.type];
    if (job.serverName && job.serverName !== 'None') parts.push('on ' + job.serverName);
    var mkt = MARKET_DISPLAY_NAMES[job.marketKey] || '';
    if (mkt) parts.push('[' + mkt + ']');
    return parts.join(' ');
}

export function jobConditionsRequireDecrypt(job) {
    if (!job.conditions) return false;
    for (var i = 0; i < job.conditions.length; i++) {
        var cond = job.conditions[i];
        if (cond.type === 'DecryptFile' || cond.type === 'DecryptDownloadedFile') return true;
    }
    return false;
}

export function extractFileInfoFromConditions(job) {
    if (!job.conditions) return null;
    for (var i = 0; i < job.conditions.length; i++) {
        var cond = job.conditions[i];
        if ((cond.type === 'DecryptFile' || cond.type === 'DecryptDownloadedFile') && cond.details && cond.details.files && cond.details.files.length > 0) {
            return cond.details.files[0];
        }
    }
    return null;
}

// ---- Shared minigame helpers (used by multiple solvers) ----

export function waitForMinigameOrError(timeoutMs) {
    return new Promise(function (resolve) {
        var done = false;
        var timer = safeTimeout(function () { if (!done) { done = true; cleanup(); resolve({ timeout: true }); } }, timeoutMs);
        function onDesktopFile(evt) {
            if (!evt.data || done) return;
            if (evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.error) {
                done = true; cleanup(); resolve({ error: evt.data.error });
            }
        }
        function onMinigame(evt) {
            if (!evt.data || done) return;
            if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_LOCKED') {
                done = true; cleanup(); resolve({ locked: evt.data.data });
            } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                done = true; cleanup(); resolve({ minigame: evt.data });
            }
        }
        function cleanup() { safeClearTimeout(timer); window.removeEventListener('message', onDesktopFile); window.removeEventListener('message', onMinigame); }
        window.addEventListener('message', onDesktopFile);
        window.addEventListener('message', onMinigame);
    });
}

export function throwMinigameLockError(lockData) {
    var lockInfo = formatMinigameLockError(lockData);
    if (lockInfo) {
        log('🔒 Minigame locked — ' + lockInfo.message, 'warn');
        var lockErr = new Error('minigame-locked: ' + lockInfo.message);
        lockErr.lockExpiresAt = lockInfo.lockExpiresAt;
        lockErr.remainingMs = lockInfo.remainingMs;
        throw lockErr;
    }
}
