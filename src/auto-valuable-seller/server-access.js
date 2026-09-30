// Server access helpers for auto-valuable-seller.
// Handles endpoint setting, login/hack flow, path-through hacking,
// and maintenance checks.

import {
    sendCmd, delay, waitForEvent, log, humanDelay,
    running,
    _cachedMapData, setCachedMapData,
    _loginStatusCache, LOGIN_STATUS_CACHE_TTL,
    SERVER_PATH_MAP,
    getServerName, ensureSolversEnabled,
    waitForHackToBeDone
} from './state.js';

import { ensureHackOnlyLoadout, tryHackLoadoutSwap } from './loadout.js';
import { isHackMinigameOpen } from '../shared/hack-utils.js';

// ---- Maintenance check ----

export async function checkPathMaintenance(serverName) {
    var path = SERVER_PATH_MAP[serverName];
    if (!path || path.length === 0) return { blocked: false };
    var mapData = _cachedMapData;
    if (!mapData) {
        sendCmd('get.map', {});
        try {
            mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
            setCachedMapData(mapData);
        } catch (e) {
            log('\u26a0\ufe0f Could not fetch network map: ' + e.message, 'warn');
            return { blocked: false };
        }
    }
    if (mapData && mapData.servers) {
        for (var i = 0; i < path.length; i++) {
            var srv = path[i];
            var info = mapData.servers[srv.id];
            if (info && info.isInMaintenance) {
                var remaining = info.maintenanceEndsAt ? new Date(info.maintenanceEndsAt).getTime() - Date.now() : 0;
                if (remaining > 0) {
                    return { blocked: true, blockerName: srv.name, remainingMs: remaining };
                }
            }
        }
    }
    return { blocked: false };
}

// ---- Internal: send set.endpoint and wait for result ----

async function _sendSetEndpoint(serverId) {
    sendCmd('set.endpoint', { serverId: serverId });
    return await new Promise(function (resolve) {
        var timer;
        function endpointHandler(evt) {
            if (evt.data && evt.data.type === 'COR3_WS_ENDPOINT_RESULT') {
                cleanup();
                if (evt.data.success === false && evt.data.error &&
                    (evt.data.error.message === 'no-path-to-server' || evt.data.error.message === 'server-in-maintenance')) {
                    resolve({ ok: false, unreachable: true, errorMsg: evt.data.error.message });
                } else {
                    resolve({ ok: true, data: evt.data });
                }
            }
            if (evt.data && (evt.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE' || evt.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE' || evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE')) {
                cleanup();
                resolve({ ok: false, unreachable: true });
            }
        }
        function cleanup() {
            window.removeEventListener('message', endpointHandler);
            clearTimeout(timer);
        }
        window.addEventListener('message', endpointHandler);
        timer = setTimeout(function () {
            window.removeEventListener('message', endpointHandler);
            resolve({ ok: true, timeout: true });
        }, 10000);
    });
}

export { _sendSetEndpoint };

// ---- Find path map entry for server name ----

function getPathForServerName(serverName) {
    var path = SERVER_PATH_MAP[serverName];
    if (path && path.length > 0) return path;
    return null;
}

// ---- Set endpoint with path-through hack on unreachable ----

export async function setEndpoint(serverId) {
    var name = getServerName(serverId);
    log('Setting endpoint to ' + name);
    var raceResult = await _sendSetEndpoint(serverId);

    if (raceResult.unreachable) {
        if (raceResult.errorMsg === 'server-in-maintenance') {
            log(name + ' is in maintenance — skipping', 'error');
            return false;
        }
        // Try path-through: hack intermediate servers on the path
        var path = getPathForServerName(name);
        if (!path || path.length <= 1) {
            var noPathCheck = await checkPathMaintenance(name);
            if (noPathCheck.blocked) {
                var nMins = Math.ceil(noPathCheck.remainingMs / 60000);
                log(name + ' unreachable (' + noPathCheck.blockerName + ' in maintenance, ~' + nMins + 'm remaining)', 'error');
                return false;
            }
            log(name + ' unreachable (no path to server)', 'error');
            return false;
        }
        log('\u26a1 Server unreachable \u2014 attempting path-through hack (' + path.length + ' servers on path)');
        // Walk through each intermediate server (excluding the target itself which is the last)
        for (var pi = 0; pi < path.length - 1; pi++) {
            var intermediate = path[pi];
            log('\u26a1 Path-through: setting endpoint to ' + intermediate.name + ' (' + (pi + 1) + '/' + (path.length - 1) + ')');
            var intResult = await _sendSetEndpoint(intermediate.id);
            if (intResult.unreachable) {
                var intCheck = await checkPathMaintenance(intermediate.name);
                var intMsg = intermediate.name + ' unreachable';
                if (intCheck.blocked) {
                    var iMins = Math.ceil(intCheck.remainingMs / 60000);
                    intMsg += ' (' + intCheck.blockerName + ' in maintenance, ~' + iMins + 'm remaining)';
                }
                log('\u26a1 Path-through: ' + intMsg, 'warn');
                return false;
            }
            await delay(humanDelay());
            // Login/hack to this intermediate server
            if (!await loginOrHack(intermediate.id)) {
                log('\u26a1 Path-through: login/hack failed on ' + intermediate.name, 'warn');
                return false;
            }
            await delay(humanDelay());
        }
        // Retry the original endpoint
        log('\u26a1 Path-through complete \u2014 retrying endpoint to target server');
        raceResult = await _sendSetEndpoint(serverId);
        if (raceResult.unreachable) {
            if (raceResult.errorMsg === 'server-in-maintenance') {
                log(name + ' is in maintenance — aborting path-through', 'error');
                return false;
            }
            var finalCheck = await checkPathMaintenance(name);
            if (finalCheck.blocked) {
                var fMins = Math.ceil(finalCheck.remainingMs / 60000);
                log(name + ' still unreachable after path-through (' + finalCheck.blockerName + ' in maintenance, ~' + fMins + 'm remaining)', 'error');
            } else {
                log(name + ' still unreachable after path-through hack', 'error');
            }
            return false;
        }
    }

    if (raceResult.timeout) {
        log('Endpoint set timeout (may already be set)', 'warn');
    }
    await delay(humanDelay());
    return true;
}

// ---- Check login status for a server (cached) ----

export async function getLoginStatus(serverId, forceRefresh) {
    if (!forceRefresh) {
        var cached = _loginStatusCache[serverId];
        if (cached && (Date.now() - cached.ts) < LOGIN_STATUS_CACHE_TTL) {
            return cached.data;
        }
    }
    sendCmd('get.login.status', { serverId: serverId });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
        if (resp.error) return null;
        var data = resp.data || null;
        _loginStatusCache[serverId] = { data: data, ts: Date.now() };
        return data;
    } catch (e) {
        return null;
    }
}

// ---- Internal: attempt a hack ----

async function _attemptHack(serverId, name) {
    log('Starting hack on ' + name);
    ensureSolversEnabled();
    await delay(300);
    sendCmd('hack.start', { serverId: serverId });

    var hackResult;
    try {
        hackResult = await new Promise(function (resolve, reject) {
            var done = false;
            var timer = setTimeout(function () {
                if (!done) { done = true; window.removeEventListener('message', onMsg); reject(new Error('Timeout')); }
            }, 30000);
            function onMsg(evt) {
                if (!evt.data) return;
                if (evt.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
                    if (!done) { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); resolve(evt.data); }
                } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                    if (!done) { done = true; clearTimeout(timer); window.removeEventListener('message', onMsg); resolve({ data: { minigameStarted: true }, error: null }); }
                }
            }
            window.addEventListener('message', onMsg);
        });
    } catch (e) {
        log('Hack start event timed out \u2014 checking if hack already completed...', 'warn');
        var fallbackLogin = await getLoginStatus(serverId, true);
        if (fallbackLogin && fallbackLogin.activeAccesses && fallbackLogin.activeAccesses.length > 0) {
            var fbAccess = fallbackLogin.activeAccesses[0];
            log('Hack already completed (found ' + (fbAccess.accessType || fbAccess.type || 'unknown') + ' access after timeout) \u2014 logging in', 'success');
            sendCmd('login.with-access', { serverId: serverId, accessGrantId: fbAccess.id });
            try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
            await delay(humanDelay());
            return true;
        }
        log(name + ': hack start timed out', 'error');
        return false;
    }

    if (hackResult.error) {
        var errMsg = hackResult.error.message || JSON.stringify(hackResult.error);
        log('Hack returned error: ' + errMsg + ' \u2014 checking access...', 'warn');
        var errLogin = await getLoginStatus(serverId, true);
        if (errLogin && errLogin.activeAccesses && errLogin.activeAccesses.length > 0) {
            var errAccess = errLogin.activeAccesses[0];
            log('Already have ' + (errAccess.accessType || errAccess.type || 'unknown') + ' access despite hack error \u2014 logging in', 'success');
            sendCmd('login.with-access', { serverId: serverId, accessGrantId: errAccess.id });
            try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
            await delay(humanDelay());
            return true;
        }
        if (errMsg.indexOf('sai-hack-impossible') >= 0 || errMsg.indexOf('sai-no-hack-software') >= 0) {
            return 'retry-loadout';
        }
        log(name + ': hack failed: ' + errMsg, 'error');
        return false;
    }

    if (hackResult.data && hackResult.data.autoHacked) {
        log('Server auto-hacked (no minigame) \u2014 skipping solver wait', 'success');
    } else if (hackResult.data && hackResult.data.minigameStarted) {
        log('Hack minigame detected via minigame event');
        await waitForHackToBeDone();
    } else {
        await waitForHackToBeDone();
    }

    await delay(humanDelay());
    var maxRetries = 3;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
        var postHackLogin = await getLoginStatus(serverId, true);
        if (postHackLogin && postHackLogin.activeAccesses && postHackLogin.activeAccesses.length > 0) {
            var postHackAccess = postHackLogin.activeAccesses[0];
            var postHackType = postHackAccess.accessType || postHackAccess.type || 'unknown';
            sendCmd('login.with-access', { serverId: serverId, accessGrantId: postHackAccess.id });
            try {
                await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
            } catch (e) { /* proceed anyway */ }
            log('Logged in to ' + name + ' (' + postHackType + ')', 'success');
            return true;
        } else {
            log('No active access after hack (attempt ' + (attempt + 1) + '/' + maxRetries + '), retrying...', 'warn');
            await delay(5000);
        }
    }
    log(name + ': no active access after hack (' + maxRetries + ' attempts) \u2014 hack may have failed', 'error');
    return false;
}

// ---- Login/hack to a server (used by path-through and ensureServerAccess) ----

export async function loginOrHack(serverId) {
    var name = getServerName(serverId);
    log('Checking login status for ' + name);
    var loginData = await getLoginStatus(serverId);

    // Check for active access
    if (loginData && loginData.activeAccesses && loginData.activeAccesses.length > 0) {
        var accessObj = loginData.activeAccesses[0];
        var accessId = accessObj.id;
        var accessType = accessObj.accessType || accessObj.type || 'unknown';
        log('Using existing access on ' + name + ' (' + accessType + ')');
        sendCmd('login.with-access', { serverId: serverId, accessGrantId: accessId });
        try {
            var loginResult = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
            if (loginResult.error || !(loginResult.data && loginResult.data.success)) {
                log(name + ': login with access failed', 'warn');
                return false;
            }
        } catch (e) {
            log(name + ': login with access timed out', 'warn');
            return false;
        }
        log('Logged in via existing access to ' + name, 'success');
        return true;
    }

    var loginDefenceRate = (loginData && loginData.serverDefenceRate) ? loginData.serverDefenceRate : 0;
    var loginHackPower = 0;
    if (loginData && loginData.hackTools && loginData.hackTools.length > 0) {
        loginHackPower = loginData.hackTools[0].hackPower || 0;
        log('Hack info \u2014 serverDefenceRate: ' + loginDefenceRate + ', equipped hackPower: ' + loginHackPower + ' (' + (loginData.hackTools[0].name || 'unknown') + ')' + (loginDefenceRate > 0 ? (loginHackPower >= loginDefenceRate ? ' \u2713' : ' \u2717 INSUFFICIENT') : ''));
    } else if (loginDefenceRate > 0) {
        log('Hack info \u2014 serverDefenceRate: ' + loginDefenceRate + ', no hack tools equipped', 'warn');
    }

    log('No active access to ' + name + ' \u2014 equipping hack loadout');
    var loadoutResult = await ensureHackOnlyLoadout(serverId, getLoginStatus);
    if (loadoutResult && !loadoutResult.ok && loadoutResult.reason === 'insufficient-power') {
        log(name + ': skipping (hack power ' + loadoutResult.hackPower + ' < serverDefenceRate ' + loadoutResult.defenceRate + ')', 'error');
        return false;
    }
    await delay(humanDelay());

    var MAX_HACK_ATTEMPTS = 6;
    for (var hackAttempt = 1; hackAttempt <= MAX_HACK_ATTEMPTS; hackAttempt++) {
        if (!running) { return false; }
        if (hackAttempt > 1) {
            log('Hack attempt ' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ' on ' + name, 'warn');
        }

        var hackAttemptResult = await _attemptHack(serverId, name);
        if (hackAttemptResult === true) return true;

        if (hackAttemptResult === 'retry-loadout') {
            log(name + ': hack failed with sai-hack-impossible \u2014 trying loadout swap and retry');
            var swapResult = await tryHackLoadoutSwap(serverId, getLoginStatus);
            if (!swapResult) {
                log(name + ': loadout swap failed \u2014 skipping (no access)', 'error');
                return false;
            }
            await delay(humanDelay());
            continue;
        }

        if (hackAttempt < MAX_HACK_ATTEMPTS) {
            log(name + ': hack failed \u2014 will retry (' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ')', 'warn');
            await delay(2000);
            continue;
        }
    }

    log(name + ': hack failed after ' + MAX_HACK_ATTEMPTS + ' attempts \u2014 no access granted', 'error');
    return false;
}

// ---- Ensure server access: set endpoint -> check login -> hack if needed ----

export async function ensureServerAccess(serverId) {
    var name = getServerName(serverId);
    log('Ensuring access to ' + name);

    // Check maintenance
    if (SERVER_PATH_MAP[name]) {
        var maint = await checkPathMaintenance(name);
        if (maint.blocked) {
            log('\u26a0\ufe0f ' + name + ' unreachable \u2014 ' + maint.blockerName + ' in maintenance', 'warn');
            return false;
        }
    }

    // Set endpoint (includes path-through hacking if unreachable)
    if (!await setEndpoint(serverId)) return false;

    // Login or hack
    return await loginOrHack(serverId);
}
