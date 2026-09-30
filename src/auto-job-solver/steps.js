// Auto Job Solver — step functions (set endpoint, login, take job, complete job, discover folder).

import { getMarketNameById } from '../shared/server-constants.js';
import { humanDelay, safeTimeout, safeClearTimeout } from '../shared/ws-utils.js';
import { formatMinigameLockError, ensureDecryptSolverEnabled, ensureIceWallSolverEnabled, ensureSimpleDecryptSolverEnabled } from '../shared/hack-utils.js';
import { friendlyError } from '../shared/error-map.js';
import { state, serverMap, sendCmd, delay, waitForEvent, log, waitForHackToBeDone, DARK_MARKET_SERVER_ID, SOYUZ_MARKET_SERVER_ID, USOL_MARKET_SERVER_ID } from './state.js';
import { getServerNameById, getPathForServerId, checkPathMaintenance, fetchMapData, tryLoadoutSwapForError, jobLabel } from './helpers.js';

// Internal: send set.endpoint and wait for result
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
            safeClearTimeout(timer);
        }
        window.addEventListener('message', endpointHandler);
        timer = safeTimeout(function () {
            window.removeEventListener('message', endpointHandler);
            resolve({ ok: true, timeout: true });
        }, 10000);
    });
}

// Step: Set endpoint to target server, with path-through hack on failure
export async function stepSetEndpoint(serverId) {
    var endpointLabel = getServerNameById(serverId) || serverId;

    if (state._lastEndpointServerId === serverId) {
        log('Endpoint already set to ' + endpointLabel + ' — skipping duplicate set.endpoint');
        return;
    }

    await fetchMapData(true);

    log('Setting endpoint to ' + endpointLabel);
    var raceResult = await _sendSetEndpoint(serverId);

    if (raceResult.unreachable) {
        if (raceResult.errorMsg === 'server-in-maintenance') {
            var initMaint = serverMap.isReady() ? serverMap.getServer(serverId) : null;
            var initRemaining = (initMaint && initMaint.maintenanceEndsAt) ? new Date(initMaint.maintenanceEndsAt).getTime() - Date.now() : 0;
            var initMins = initRemaining > 0 ? Math.ceil(initRemaining / 60000) : 0;
            var initSuffix = initMins > 0 ? ' (~' + initMins + 'm remaining)' : '';
            throw new Error(endpointLabel + ' is in maintenance' + initSuffix);
        }
        var allPaths = serverMap.isReady() ? serverMap.findAllPaths(serverId) : [];
        var path = serverMap.isReady() ? serverMap.findBestReachablePath(serverId) : null;
        if (!path) path = getPathForServerId(serverId);
        if (!path || path.length <= 1) {
            var noPathCheck = await checkPathMaintenance(endpointLabel);
            if (noPathCheck.blocked) {
                var nMins = Math.ceil(noPathCheck.remainingMs / 60000);
                throw new Error(endpointLabel + ' unreachable (' + noPathCheck.blockerName + ' in maintenance, ~' + nMins + 'm remaining)');
            }
            throw new Error(endpointLabel + ' unreachable (no path to server)');
        }
        var pathThroughSuccess = false;
        var triedPathCount = 0;
        var pathsToTry = allPaths.length > 0 ? allPaths : [path];

        for (var pathIdx = 0; pathIdx < pathsToTry.length; pathIdx++) {
            var currentPath = pathsToTry[pathIdx];
            if (currentPath.length <= 1) continue;
            if (triedPathCount > 0) await fetchMapData(true);
            if (serverMap.isReady()) {
                var targetSrv = serverMap.getServer(serverId);
                if (targetSrv && targetSrv.isInMaintenance) {
                    var mRemaining = targetSrv.maintenanceEndsAt ? new Date(targetSrv.maintenanceEndsAt).getTime() - Date.now() : 0;
                    if (mRemaining > 0) {
                        var mMins = Math.ceil(mRemaining / 60000);
                        throw new Error(endpointLabel + ' is in maintenance (~' + mMins + 'm remaining) — skipping path-through');
                    }
                }
            }
            triedPathCount++;
            var pathNames = currentPath.map(function (s) { return s.name; }).join(' → ');
            log('⚡ Server unreachable — attempting path-through hack (path ' + triedPathCount + '/' + pathsToTry.length + ': ' + pathNames + ')');
            var pathFailed = false;
            for (var pi = 0; pi < currentPath.length - 1; pi++) {
                var intermediate = currentPath[pi];
                log('⚡ Path-through: setting endpoint to ' + intermediate.name + ' (' + (pi + 1) + '/' + (currentPath.length - 1) + ')');
                var intResult = await _sendSetEndpoint(intermediate.id);
                if (intResult.unreachable) {
                    var intMsg = intermediate.name + ' unreachable on this path';
                    log('⚡ Path-through: ' + intMsg + ' — will try next path', 'warn');
                    pathFailed = true;
                    break;
                }
                await delay(humanDelay());
                try {
                    await stepLogin(intermediate.id);
                } catch (e) {
                    log('⚡ Path-through: login/hack failed on ' + intermediate.name + ': ' + e.message + ' — will try next path', 'warn');
                    pathFailed = true;
                    break;
                }
                await delay(humanDelay());
            }
            if (pathFailed) continue;
            log('⚡ Path-through complete — retrying endpoint to target server');
            raceResult = await _sendSetEndpoint(serverId);
            if (!raceResult.unreachable) {
                pathThroughSuccess = true;
                break;
            }
            if (raceResult.errorMsg === 'server-in-maintenance') {
                var maintCheck = serverMap.isReady() ? serverMap.getServer(serverId) : null;
                var maintRemaining = (maintCheck && maintCheck.maintenanceEndsAt) ? new Date(maintCheck.maintenanceEndsAt).getTime() - Date.now() : 0;
                var maintMins = maintRemaining > 0 ? Math.ceil(maintRemaining / 60000) : 0;
                var maintSuffix = maintMins > 0 ? ' (~' + maintMins + 'm remaining)' : '';
                throw new Error(endpointLabel + ' is in maintenance' + maintSuffix + ' — aborting path-through');
            }
            log('⚡ Endpoint still unreachable after path ' + triedPathCount + ' — trying next', 'warn');
        }

        if (!pathThroughSuccess && raceResult.unreachable) {
            var finalCheck = await checkPathMaintenance(endpointLabel);
            if (finalCheck.blocked) {
                var fMins = Math.ceil(finalCheck.remainingMs / 60000);
                throw new Error(endpointLabel + ' still unreachable after ' + triedPathCount + ' path(s) (' + finalCheck.blockerName + ' in maintenance, ~' + fMins + 'm remaining)');
            }
            throw new Error(endpointLabel + ' still unreachable after ' + triedPathCount + ' path attempt(s)');
        }
    }

    if (raceResult.timeout) {
        log('Endpoint set timeout (may already be set)', 'warn');
    }
    state._lastEndpointServerId = serverId;
    await delay(humanDelay());
}

// Step: Login to server (use existing access or hack)
export async function stepLogin(serverId) {
    var serverLabel = getServerNameById(serverId) || serverId;
    log('Checking login status for ' + serverLabel);
    sendCmd('get.login.status', { serverId: serverId });
    var loginData;
    try {
        loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
    } catch (e) {
        throw new Error('Failed to get login status: ' + e.message);
    }

    if (loginData.error) {
        throw new Error('Login status error: ' + friendlyError(loginData.error.message || JSON.stringify(loginData.error)));
    }

    var data = loginData.data;
    if (data && data.activeAccesses && data.activeAccesses.length > 0) {
        var accessObj = data.activeAccesses[0];
        var accessId = accessObj.id;
        var accessType = accessObj.accessType || accessObj.type || 'unknown';
        log('Using existing access on ' + serverLabel + ' (' + accessType + ')');
        sendCmd('login.with-access', { serverId: serverId, accessGrantId: accessId });
        var loginResult;
        try {
            loginResult = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
        } catch (e) {
            throw new Error('Login with access timed out');
        }
        if (loginResult.error || !(loginResult.data && loginResult.data.success)) {
            throw new Error('Login with access failed');
        }
        log('Logged in via existing access to ' + serverLabel, 'success');
    } else {
        // Log hack power info
        var loginDefenceRate = (data && data.serverDefenceRate) ? data.serverDefenceRate : 0;
        var loginHackPower = 0;
        if (data && data.hackTools && data.hackTools.length > 0) {
            loginHackPower = data.hackTools[0].hackPower || 0;
            log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', equipped hackPower: ' + loginHackPower + ' (' + (data.hackTools[0].name || 'unknown') + ')' + (loginDefenceRate > 0 ? (loginHackPower >= loginDefenceRate ? ' ✓' : ' ✗ INSUFFICIENT') : ''));
        } else if (loginDefenceRate > 0) {
            log('Hack info — serverDefenceRate: ' + loginDefenceRate + ', no hack tools equipped', 'warn');
        }

        var MAX_HACK_ATTEMPTS = 6;
        var hackAttempt = 0;
        var loggedIn = false;

        while (hackAttempt < MAX_HACK_ATTEMPTS && !loggedIn) {
            hackAttempt++;
            if (hackAttempt > 1) {
                log('Hack attempt ' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ' on ' + serverLabel, 'warn');
            } else {
                log('No active access to ' + serverLabel + ' — starting hack');
            }
            ensureDecryptSolverEnabled();
            ensureIceWallSolverEnabled();
            ensureSimpleDecryptSolverEnabled();
            await delay(300);
            sendCmd('hack.start', { serverId: serverId });
            var hackResult;
            try {
                hackResult = await new Promise(function (resolve, reject) {
                    var done = false;
                    var timer = safeTimeout(function () {
                        if (!done) { done = true; window.removeEventListener('message', onMsg); reject(new Error('Timeout')); }
                    }, 30000);
                    function onMsg(evt) {
                        if (!evt.data) return;
                        if (evt.data.type === 'COR3_AUTOJOB_SAI_HACK_START') {
                            if (!done) { done = true; safeClearTimeout(timer); window.removeEventListener('message', onMsg); resolve(evt.data); }
                        } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_LOCKED') {
                            if (!done) { done = true; safeClearTimeout(timer); window.removeEventListener('message', onMsg); resolve({ data: { minigameLocked: true, lockData: evt.data.data }, error: null }); }
                        } else if (evt.data.type === 'COR3_AUTOJOB_MINIGAME_START') {
                            if (!done) { done = true; safeClearTimeout(timer); window.removeEventListener('message', onMsg); resolve({ data: { minigameStarted: true }, error: null }); }
                        }
                    }
                    window.addEventListener('message', onMsg);
                });
            } catch (e) {
                log('Hack start event timed out — checking if hack already completed...', 'warn');
                sendCmd('get.login.status', { serverId: serverId });
                try {
                    var fallbackLogin = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
                    if (fallbackLogin.data && fallbackLogin.data.activeAccesses && fallbackLogin.data.activeAccesses.length > 0) {
                        var fbAccess = fallbackLogin.data.activeAccesses[0];
                        var fbAccessId = fbAccess.id;
                        var fbType = fbAccess.accessType || fbAccess.type || 'unknown';
                        log('Hack already completed (found ' + fbType + ' access after timeout) — logging in', 'success');
                        sendCmd('login.with-access', { serverId: serverId, accessGrantId: fbAccessId });
                        try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                        await delay(humanDelay());
                        return;
                    }
                } catch (e2) { /* login status also failed */ }
                if (hackAttempt < MAX_HACK_ATTEMPTS) {
                    log('Hack timed out — will retry', 'warn');
                    await delay(2000);
                    continue;
                }
                throw new Error('Hack start timed out after ' + MAX_HACK_ATTEMPTS + ' attempts');
            }
            if (hackResult.error) {
                log('Hack returned error: ' + friendlyError(hackResult.error.message || JSON.stringify(hackResult.error)) + ' — checking access...', 'warn');
                sendCmd('get.login.status', { serverId: serverId });
                try {
                    var errLogin = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 10000);
                    if (errLogin.data && errLogin.data.activeAccesses && errLogin.data.activeAccesses.length > 0) {
                        var errAccess = errLogin.data.activeAccesses[0];
                        var errAccessId = errAccess.id;
                        var errType = errAccess.accessType || errAccess.type || 'unknown';
                        log('Already have ' + errType + ' access despite hack error — logging in', 'success');
                        sendCmd('login.with-access', { serverId: serverId, accessGrantId: errAccessId });
                        try { await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000); } catch (e2) { /* proceed */ }
                        await delay(humanDelay());
                        return;
                    }
                } catch (e2) { /* login status also failed */ }

                var hackErrMsg = hackResult.error.message || JSON.stringify(hackResult.error);
                if (hackErrMsg.indexOf('sai-no-hack-software') >= 0 || hackErrMsg.indexOf('sai-hack-impossible') >= 0) {
                    log('Loadout: attempting software swap for hack retry...');
                    var loadoutSwapped = await tryLoadoutSwapForError(hackErrMsg, { serverId: serverId, type: state._currentJobRef ? state._currentJobRef.type : '' });
                    if (loadoutSwapped) {
                        log('Loadout: swap successful — will retry hack');
                        await delay(1000);
                        continue;
                    }
                }
                if (hackAttempt < MAX_HACK_ATTEMPTS) {
                    log('Hack failed — will retry', 'warn');
                    await delay(2000);
                    continue;
                }
                throw new Error('Hack failed after ' + MAX_HACK_ATTEMPTS + ' attempts: ' + friendlyError(hackErrMsg));
            }
            if (hackResult.data && hackResult.data.minigameLocked) {
                var lockInfo = formatMinigameLockError(hackResult.data.lockData);
                if (lockInfo) {
                    log('🔒 Hack minigame locked — ' + lockInfo.message, 'warn');
                    var lockErr = new Error('minigame-locked: ' + lockInfo.message);
                    lockErr.lockExpiresAt = lockInfo.lockExpiresAt;
                    lockErr.remainingMs = lockInfo.remainingMs;
                    throw lockErr;
                }
            }
            if (hackResult.data && hackResult.data.autoHacked) {
                log('Server auto-hacked (no minigame) — skipping solver wait', 'success');
            } else if (hackResult.data && hackResult.data.minigameStarted) {
                log('Hack minigame detected via minigame event');
                await waitForHackToBeDone();
            } else {
                await waitForHackToBeDone();
            }

            // Poll for active access after hack completes
            await delay(humanDelay());
            var maxPolls = 5;
            for (var attempt = 0; attempt < maxPolls; attempt++) {
                sendCmd('get.login.status', { serverId: serverId });
                try {
                    loginData = await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_STATUS', 5000);
                } catch (e) {
                    log('Login status not received after hack (poll ' + (attempt + 1) + '/' + maxPolls + '), retrying...', 'warn');
                    continue;
                }
                if (loginData.data && loginData.data.activeAccesses && loginData.data.activeAccesses.length > 0) {
                    var postHackAccess = loginData.data.activeAccesses[0];
                    var aid = postHackAccess.id;
                    var postHackType = postHackAccess.accessType || postHackAccess.type || 'unknown';
                    sendCmd('login.with-access', { serverId: serverId, accessGrantId: aid });
                    try {
                        await waitForEvent('COR3_AUTOJOB_SAI_LOGIN_RESULT', 10000);
                    } catch (e) { /* proceed anyway */ }
                    loggedIn = true;
                    log('Logged in to ' + serverLabel + ' (' + postHackType + ')', 'success');
                    break;
                } else {
                    log('No active access after hack (poll ' + (attempt + 1) + '/' + maxPolls + '), retrying...', 'warn');
                    await delay(5000);
                }
            }
            if (!loggedIn) {
                if (hackAttempt < MAX_HACK_ATTEMPTS) {
                    log('Hack completed but no access granted — hack likely failed, retrying (' + hackAttempt + '/' + MAX_HACK_ATTEMPTS + ')', 'warn');
                    await delay(2000);
                    continue;
                }
                throw new Error('Hack failed after ' + MAX_HACK_ATTEMPTS + ' attempts — no access granted');
            }
        }
    }
    await delay(humanDelay());
}

// Step: Take a job from market (tracks deposit paid)
export async function stepTakeJob(job) {
    if (job.alreadyTaken) {
        log('Job already taken — skipping take step');
        return;
    }
    log('Taking job: ' + jobLabel(job));

    var depositPaid = 0;
    var depositHandler = function (evt) {
        if (evt.data && evt.data.type === 'COR3_AUTOJOB_PROFILE_CREDITS' && evt.data.data) {
            if (evt.data.data.amount < 0) {
                depositPaid = Math.abs(evt.data.data.amount);
            }
        }
    };
    window.addEventListener('message', depositHandler);

    var capturedFileInfo = null;
    var fileHandler = function (evt) {
        if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_FILE' && evt.data.data && evt.data.data.file) {
            var fileData = evt.data.data.file;
            capturedFileInfo = fileData;
            log('Captured file info: ' + fileData.name + ' (id: ' + fileData.id + ')');
            var fId = fileData.folderId;
            if (fId) {
                state.downloadFolderId = fId;
                log('Captured download folder ID: ' + fId);
            }
        }
    };
    window.addEventListener('message', fileHandler);

    sendCmd('job.take', { marketId: job.marketId, jobId: job.jobId });
    try {
        var result = await waitForEvent('COR3_AUTOJOB_JOB_TAKEN', 10000);
        if (result.error) {
            window.removeEventListener('message', depositHandler);
            window.removeEventListener('message', fileHandler);
            throw new Error('Job take error: ' + friendlyError(result.error.message || JSON.stringify(result.error)));
        }
    } catch (e) {
        window.removeEventListener('message', depositHandler);
        window.removeEventListener('message', fileHandler);
        throw new Error('Failed to take job: ' + e.message);
    }
    window.removeEventListener('message', depositHandler);

    if (depositPaid > 0) {
        job.depositPaid = depositPaid;
        log('Job taken (deposit: ' + depositPaid + ' credits)', 'success');
    } else {
        log('Job taken successfully', 'success');
    }
    await delay(humanDelay());

    log('Refreshing market data for job conditions...');
    sendCmd('get.jobs', { marketId: job.marketId });
    var updatedConditions = await new Promise(function (resolve) {
        var timer;
        function handler(evt) {
            if (evt.data && (evt.data.type === 'COR3_WS_MARKET' || evt.data.type === 'COR3_WS_DARK_MARKET' || evt.data.type === 'COR3_WS_SOYUZ_MARKET' || evt.data.type === 'COR3_WS_USOL_MARKET')) {
                var md = evt.data.market;
                if (md && md.recentJobs) {
                    var rj = md.recentJobs.find(function (j) { return j.id === job.jobId; });
                    if (rj) {
                        cleanup();
                        resolve(rj);
                        return;
                    }
                }
            }
        }
        function cleanup() {
            window.removeEventListener('message', handler);
            safeClearTimeout(timer);
        }
        window.addEventListener('message', handler);
        timer = safeTimeout(function () {
            window.removeEventListener('message', handler);
            resolve(null);
        }, 5000);
    });

    window.removeEventListener('message', fileHandler);

    if (capturedFileInfo) {
        job.fileInfo = capturedFileInfo;
    }

    if (updatedConditions) {
        if (updatedConditions.conditions && updatedConditions.conditions.items) {
            job.conditions = updatedConditions.conditions.items;
            log('Updated job conditions from server');
        }
        if (updatedConditions.canComplete !== undefined) {
            job.canComplete = updatedConditions.canComplete;
        }
    }
}

// Step: Check job completion status
export async function stepCheckJobComplete(marketId, jobId) {
    log('Checking job completion status');
    sendCmd('get.jobs', { marketId: marketId });
    await delay(1000);
    return true;
}

// Step: Complete job and claim reward
export async function stepCompleteJob(job) {
    log('Completing job and claiming reward');

    var earnedCredits = 0;
    var earnedRenown = 0;
    var profileHandler = function (evt) {
        if (!evt.data) return;
        if (evt.data.type === 'COR3_AUTOJOB_PROFILE_PROGRESS' && evt.data.data) {
            earnedRenown = evt.data.data.amount || 0;
        }
        if (evt.data.type === 'COR3_AUTOJOB_PROFILE_CREDITS' && evt.data.data) {
            earnedCredits = evt.data.data.amount || 0;
        }
    };
    window.addEventListener('message', profileHandler);

    if (getMarketNameById(job.marketId) === 'D4RK') {
        await stepSetEndpoint(DARK_MARKET_SERVER_ID);
    } else if (getMarketNameById(job.marketId) === 'SOYUZ') {
        await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
    } else if (getMarketNameById(job.marketId) === 'USOL') {
        await stepSetEndpoint(USOL_MARKET_SERVER_ID);
    }

    var completeRetries = 0;
    var MAX_COMPLETE_RETRIES = 2;
    while (true) {
        sendCmd('job.complete', { marketId: job.marketId, jobId: job.jobId });
        try {
            var result = await waitForEvent('COR3_AUTOJOB_JOB_COMPLETED', 20000);

            if (result.error) {
                var errMsg = result.error.message || '';
                if (errMsg.indexOf('not found') >= 0) {
                    window.removeEventListener('message', profileHandler);
                    log('Job not found (stale ID) — skipping this job', 'error');
                    throw new Error('job-not-found');
                }
                if (errMsg.indexOf('market-not-reachable') >= 0 && completeRetries < MAX_COMPLETE_RETRIES) {
                    completeRetries++;
                    log('Market not reachable during job.complete — re-setting endpoint and retrying (' + completeRetries + '/' + MAX_COMPLETE_RETRIES + ')', 'warn');
                    await delay(1500);
                    var marketName = getMarketNameById(job.marketId);
                    if (marketName === 'D4RK') await stepSetEndpoint(DARK_MARKET_SERVER_ID);
                    else if (marketName === 'SOYUZ') await stepSetEndpoint(SOYUZ_MARKET_SERVER_ID);
                    else if (marketName === 'USOL') await stepSetEndpoint(USOL_MARKET_SERVER_ID);
                    await delay(500);
                    continue;
                }
                window.removeEventListener('message', profileHandler);
                var friendlyMsg = friendlyError(errMsg, result.error.failedConditions) || 'Unknown completion error';
                log('Job completion error: ' + friendlyMsg, 'error');
                throw new Error(errMsg);
            }

            window.removeEventListener('message', profileHandler);

            var grossCredits = earnedCredits || job.rewardCredits || 0;
            var deposit = job.depositPaid || 0;
            var netCredits = grossCredits - deposit;
            var reputation = job.rewardReputation || 0;
            var renown = earnedRenown || 0;
            log('Job completed!', 'success');

            return {
                credits: netCredits,
                reputation: reputation,
                renown: renown,
                grossCredits: grossCredits,
                deposit: deposit
            };
        } catch (e) {
            window.removeEventListener('message', profileHandler);
            log('Job completion timed out: ' + e.message, 'error');
            throw e;
        }
    }
}

// Step: Discover Downloads folder ID
export async function stepDiscoverDownloadFolder() {
    if (state.downloadFolderId) return state.downloadFolderId;

    if (window.__cor3DownloadFolderId) {
        state.downloadFolderId = window.__cor3DownloadFolderId;
        log('Using cached Downloads folder ID: ' + state.downloadFolderId);
        return state.downloadFolderId;
    }

    log('Waiting for Downloads folder ID from polling/WS...');
    for (var attempt = 0; attempt < 10; attempt++) {
        await delay(500);
        if (window.__cor3DownloadFolderId) {
            state.downloadFolderId = window.__cor3DownloadFolderId;
            log('Got Downloads folder ID from polling: ' + state.downloadFolderId);
            return state.downloadFolderId;
        }
    }

    log('Sending explicit desktop.get.options command...');
    sendCmd('desktop.get.options', {});
    var result = await new Promise(function (resolve) {
        var timer;
        function handler(evt) {
            if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_OPTIONS') {
                cleanup();
                resolve(evt.data.data || null);
            }
        }
        function cleanup() {
            window.removeEventListener('message', handler);
            safeClearTimeout(timer);
        }
        window.addEventListener('message', handler);
        timer = safeTimeout(function () {
            window.removeEventListener('message', handler);
            log('desktop.get.options WS command timed out after 8s', 'warn');
            resolve(null);
        }, 8000);
    });

    if (!result && window.__cor3DownloadFolderId) {
        state.downloadFolderId = window.__cor3DownloadFolderId;
        log('Got Downloads folder ID from global after WS attempt: ' + state.downloadFolderId);
        return state.downloadFolderId;
    }

    if (result) {
        log('desktop.get.options response — folders: ' + (result.folders ? result.folders.length : 0) + ', files: ' + (result.files ? result.files.length : 0));
        if (result.folders) {
            var dlFolder = result.folders.find(function (f) { return f.name === 'Downloads'; });
            if (dlFolder) {
                state.downloadFolderId = dlFolder.id;
                log('Discovered Downloads folder ID: ' + dlFolder.id);
                return dlFolder.id;
            }
            log('No "Downloads" folder found in: ' + result.folders.map(function(f) { return f.name; }).join(', '), 'warn');
        }
    } else {
        log('desktop.get.options returned null/empty', 'warn');
    }
    log('Could not discover Downloads folder ID', 'warn');
    return null;
}
