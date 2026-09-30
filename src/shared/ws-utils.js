export function humanDelay() {
    return 800 + Math.floor(Math.random() * 700);
}

export function createSendCmd(messageType) {
    messageType = messageType || 'COR3_AUTOJOB_CMD';
    return function sendCmd(cmd, data) {
        window.postMessage({ type: messageType, cmd: cmd, data: data || {} }, '*');
    };
}

var _mcChannel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
var _mcCallbacks = [];
if (_mcChannel) {
    _mcChannel.port1.onmessage = function () {
        var cbs = _mcCallbacks.slice();
        _mcCallbacks.length = 0;
        for (var i = 0; i < cbs.length; i++) cbs[i]();
    };
}

export function nextTick(fn) {
    if (_mcChannel) {
        _mcCallbacks.push(fn);
        _mcChannel.port2.postMessage(0);
    } else {
        setTimeout(fn, 0);
    }
}

var _safeTimeoutId = 0;
var _safeTimeouts = {};

export function safeTimeout(fn, ms) {
    var id = ++_safeTimeoutId;
    var target = Date.now() + ms;
    _safeTimeouts[id] = true;
    function tick() {
        if (!_safeTimeouts[id]) return;
        if (Date.now() >= target) { delete _safeTimeouts[id]; fn(); return; }
        var rem = target - Date.now();
        if (rem > 200) { setTimeout(function () { nextTick(tick); }, Math.min(rem - 50, 1000)); }
        else { nextTick(tick); }
    }
    nextTick(tick);
    return id;
}

export function safeClearTimeout(id) { delete _safeTimeouts[id]; }

export function createDelay(abortFlagFn) {
    return function delay(ms) {
        return new Promise(function (resolve, reject) {
            var target = Date.now() + ms;
            function check() {
                if (abortFlagFn && abortFlagFn()) { reject(new Error('Aborted')); return; }
                if (Date.now() >= target) { resolve(); return; }
                var remaining = target - Date.now();
                if (remaining > 200) {
                    setTimeout(function () { nextTick(check); }, Math.min(remaining - 50, 1000));
                } else {
                    nextTick(check);
                }
            }
            nextTick(check);
        });
    };
}

export function createWaitForEvent(abortFlagFn) {
    return function waitForEvent(eventType, timeoutMs) {
        timeoutMs = timeoutMs || 15000;
        return new Promise(function (resolve, reject) {
            var done = false;
            var deadline = Date.now() + timeoutMs;
            function handler(evt) {
                if (evt.data && evt.data.type === eventType) {
                    if (done) return;
                    done = true;
                    window.removeEventListener('message', handler);
                    resolve(evt.data);
                }
            }
            window.addEventListener('message', handler);
            function checkTimeout() {
                if (done) return;
                if (abortFlagFn && abortFlagFn()) {
                    done = true;
                    window.removeEventListener('message', handler);
                    reject(new Error('Aborted'));
                    return;
                }
                if (Date.now() >= deadline) {
                    done = true;
                    window.removeEventListener('message', handler);
                    reject(new Error('Timeout waiting for ' + eventType));
                    return;
                }
                var remaining = deadline - Date.now();
                if (remaining > 200) {
                    setTimeout(function () { nextTick(checkTimeout); }, Math.min(remaining - 50, 1000));
                } else {
                    nextTick(checkTimeout);
                }
            }
            nextTick(checkTimeout);
        });
    };
}

export function createLogger(prefix, messageType) {
    return function log(msg, level) {
        level = level || 'info';
        console.log(prefix, msg);
        window.postMessage({ type: messageType, msg: msg, level: level }, '*');
    };
}
