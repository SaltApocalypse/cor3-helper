import { safeTimeout, safeClearTimeout, nextTick } from './ws-utils.js';

export function detectHackType(pollMs) {
    pollMs = pollMs || 5000;
    return new Promise(function (resolve) {
        var elapsed = 0;
        var interval = 200;
        function check() {
            if (document.querySelector('[data-component-name="WallBoard"]') ||
                document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
                document.querySelector('[data-sentry-component="IceWallBreakApplication"]')) return resolve('ice-wall');
            if (document.querySelector('[data-sentry-component="ConfigHackApplication"]')) return resolve('decrypt');
            if (document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
                document.querySelector('[data-sentry-component="SimpleDecryptApplication"]')) return resolve('simple-decrypt');
            elapsed += interval;
            if (elapsed >= pollMs) return resolve(null);
            safeTimeout(check, interval);
        }
        check();
    });
}

export function isHackMinigameOpen() {
    return !!(document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
        document.querySelector('[data-sentry-component="IceWallBreakApplication"]') ||
        document.querySelector('[data-component-name="WallBoard"]') ||
        document.querySelector('[data-sentry-component="ConfigHackApplication"]') ||
        document.querySelector('[data-component-name="SimpleDecryptApplication"]') ||
        document.querySelector('[data-sentry-component="SimpleDecryptApplication"]'));
}

export function waitForHackMinigameClose(waitMs) {
    waitMs = waitMs || 120000;
    return new Promise(function (resolve) {
        var elapsed = 0;
        var interval = 300;
        function check() {
            if (!isHackMinigameOpen()) return resolve(true);
            elapsed += interval;
            if (elapsed >= waitMs) return resolve(false);
            safeTimeout(check, interval);
        }
        check();
    });
}

export function formatMinigameLockError(lockData) {
    var expiresAt = lockData && lockData.lockExpiresAt;
    if (!expiresAt) return null;
    var remaining = new Date(expiresAt).getTime() - Date.now();
    if (remaining <= 0) return null;
    var mins = Math.ceil(remaining / 60000);
    return { message: 'Minigame locked (~' + mins + 'm remaining)', lockExpiresAt: expiresAt, remainingMs: remaining };
}

export function createWaitForHackToBeDone(logFn, abortFlagFn) {
    return async function waitForHackToBeDone() {
        logFn('Hack minigame started, waiting for solver to complete...');
        var hackSolverTimeout = 60000;
        var hackType = await detectHackType(5000);
        if (hackType === 'ice-wall') {
            hackSolverTimeout = 120000;
            logFn('ICE Wall hack detected — waiting up to 2 minutes');
        } else if (hackType) {
            logFn(hackType + ' hack detected — waiting up to 60s');
        } else {
            logFn('Could not detect hack type — using default 60s timeout', 'warn');
        }

        var saiUpdateReceived = false;
        var canPollClose = !!hackType;
        try {
            await new Promise(function (resolve, reject) {
                var done = false;
                function onEvent(evt) {
                    if (evt.data && evt.data.type === 'COR3_AUTOJOB_SAI_UPDATE') {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(pollTimerId); safeClearTimeout(timeoutTimerId); saiUpdateReceived = true; resolve(); }
                    }
                }
                window.addEventListener('message', onEvent);
                var pollTimerId = 0;
                function pollClose() {
                    if (done) return;
                    if (abortFlagFn && abortFlagFn()) {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(timeoutTimerId); reject(new Error('Aborted')); }
                        return;
                    }
                    if (canPollClose && !isHackMinigameOpen()) {
                        if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(timeoutTimerId); resolve(); }
                    } else {
                        pollTimerId = safeTimeout(pollClose, 500);
                    }
                }
                pollTimerId = safeTimeout(pollClose, 500);
                var timeoutTimerId = safeTimeout(function () {
                    if (!done) { done = true; window.removeEventListener('message', onEvent); safeClearTimeout(pollTimerId); reject(new Error('timeout')); }
                }, hackSolverTimeout);
            });
        } catch (e) {
            if (abortFlagFn && abortFlagFn()) {
                logFn('Hack wait aborted by user', 'warn');
                return;
            }
            logFn('Hack solver did not complete in ' + (hackSolverTimeout / 1000) + 's — checking login status directly', 'warn');
        }
        if (saiUpdateReceived) {
            logFn('Hack completed (SAI update)', 'success');
        } else if (canPollClose && !isHackMinigameOpen()) {
            logFn('Hack completed (minigame closed)', 'success');
        }

        if (isHackMinigameOpen()) {
            logFn('Waiting for hack minigame dialog to close...');
            await waitForHackMinigameClose(30000);
        }
    };
}

export function ensureDecryptSolverEnabled() {
    window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER' }, '*');
}

export function ensureIceWallSolverEnabled() {
    window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER' }, '*');
}

export function ensureSimpleDecryptSolverEnabled() {
    window.postMessage({ type: 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER' }, '*');
}

export function waitForMinigameWindow(graceMs) {
    graceMs = graceMs || 5000;
    return new Promise(function (resolve) {
        var elapsed = 0;
        var interval = 500;
        function poll() {
            var iceWall = document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
                document.querySelector('[data-sentry-component="IceWallBreakApplication"]');
            if (iceWall) { resolve('icewall'); return; }
            var decrypt = document.querySelector('[data-component-name="DecryptionApplication"]') ||
                document.querySelector('[data-sentry-component="DecryptionApplication"]');
            if (decrypt) { resolve('decrypt'); return; }
            var simpleDecrypt = document.querySelector('[data-component-name="SimpleDecryptionApplication"]') ||
                document.querySelector('[data-sentry-component="SimpleDecryptionApplication"]');
            if (simpleDecrypt) { resolve('simple-decrypt'); return; }
            elapsed += interval;
            if (elapsed >= graceMs) { resolve(null); return; }
            safeTimeout(poll, interval);
        }
        poll();
    });
}

export function isIceWallAwaitingStuck() {
    var app = document.querySelector('[data-component-name="IceWallBreakApplication"]') ||
        document.querySelector('[data-sentry-component="IceWallBreakApplication"]');
    if (!app) return false;
    var emptyStage = app.querySelector('[data-component-name="EmptyStage"]');
    if (!emptyStage) return false;
    var text = (emptyStage.textContent || '').trim();
    return text.indexOf('Awaiting secure channel') >= 0;
}

export function waitForIceWallStuckClear(logFn, maxWaitMs) {
    maxWaitMs = maxWaitMs || 10000;
    return new Promise(function (resolve) {
        if (!isIceWallAwaitingStuck()) {
            resolve({ stuck: false, reloaded: false });
            return;
        }
        logFn('ICE Wall stuck on "Awaiting secure channel…" — waiting up to ' + (maxWaitMs / 1000) + 's for it to clear');
        var elapsed = 0;
        var interval = 500;
        function poll() {
            if (!isIceWallAwaitingStuck()) {
                logFn('ICE Wall "Awaiting secure channel…" screen cleared');
                resolve({ stuck: true, reloaded: false });
                return;
            }
            elapsed += interval;
            if (elapsed >= maxWaitMs) {
                logFn('ICE Wall still stuck after ' + (maxWaitMs / 1000) + 's — page reload required to clear stuck UI', 'warn');
                resolve({ stuck: true, reloaded: true });
                return;
            }
            safeTimeout(poll, interval);
        }
        poll();
    });
}

export function closeAppWindows(count) {
    count = count || 1;
    for (var i = 0; i < count; i++) {
        (function (idx) {
            setTimeout(function () {
                var closeBtn = document.querySelector('[data-component-name="ApplicationCloseButton"]') ||
                    document.querySelector('[data-sentry-component="ApplicationCloseButton"]');
                if (closeBtn) closeBtn.click();
            }, idx * 500);
        })(i);
    }
}
