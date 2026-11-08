// Resumable hidden-connection discovery for the network map.
//
// Runs in the MAIN world where wsSend and get.map event relaying are available.
// Uses localStorage for cross-tab locking and resumable scan progress.

import { __cor3FetchMapData } from './market-requests.js';
import { wsSend } from './ws-send.js';

const DELAY_MS = 2500;
const LOCK_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_MS = 5 * 60 * 1000;
const PROGRESS_KEY = 'cor3NetworkDiscoveryProgress';
const LOCK_KEY = 'cor3NetworkDiscoveryLock';
const LAST_RESULT_KEY = 'cor3NetworkDiscoveryLastResult';

function readJson(key) {
    try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* localStorage can be unavailable */ }
}

function removeKey(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

function fingerprint(map) {
    return (map && map.servers ? map.servers : [])
        .map(function (s) { return s.serverIp || s.id; })
        .filter(Boolean)
        .sort()
        .join('|');
}

function connectionKey(c) {
    if (!c) return '';
    if (c.id) return String(c.id);
    var a = String(c.serverA || '');
    var b = String(c.serverB || '');
    return a < b ? a + '|' + b : b + '|' + a;
}

function postLog(html) {
    window.postMessage({ type: 'COR3_IP_SEARCH_LOG', html: html }, '*');
}

function postDone(html) {
    window.postMessage({ type: 'COR3_IP_SEARCH_DONE', html: html }, '*');
}

function getLock() {
    var lock = readJson(LOCK_KEY);
    if (!lock) return null;
    if (!lock.expiresAt || lock.expiresAt <= Date.now()) {
        removeKey(LOCK_KEY);
        return null;
    }
    return lock;
}

function acquireLock(owner) {
    var lock = getLock();
    if (lock) return false;
    writeJson(LOCK_KEY, {
        owner: owner,
        startedAt: Date.now(),
        expiresAt: Date.now() + LOCK_TTL_MS
    });
    return true;
}

function releaseLock(owner) {
    var lock = getLock();
    if (lock && lock.owner === owner) removeKey(LOCK_KEY);
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function connectIp(ip) {
    wsSend('42["event",{"event":{"name":"network-map","action":"connect.ip"},"data":{"ipAddress":"' + ip + '"}}]');
}

function summarizeDiff(before, after) {
    var beforeConnections = {};
    var afterConnections = {};
    var beforeServers = {};
    var afterServers = {};
    (before.connections || []).forEach(function (c) { beforeConnections[connectionKey(c)] = c; });
    (after.connections || []).forEach(function (c) { afterConnections[connectionKey(c)] = c; });
    (before.servers || []).forEach(function (s) { beforeServers[s.id] = s; });
    (after.servers || []).forEach(function (s) { afterServers[s.id] = s; });
    return {
        newConnections: (after.connections || []).filter(function (c) { return !beforeConnections[connectionKey(c)]; }),
        removedConnections: (before.connections || []).filter(function (c) { return !afterConnections[connectionKey(c)]; }),
        newServers: (after.servers || []).filter(function (s) { return !beforeServers[s.id]; }),
        removedServers: (before.servers || []).filter(function (s) { return !afterServers[s.id]; })
    };
}

function diffHtml(diff, names) {
    var parts = [];
    if (diff.newConnections.length > 0) {
        parts.push('<div style="color:var(--accent-green);font-weight:bold;">Found ' + diff.newConnections.length + ' new connection(s):</div>');
        diff.newConnections.forEach(function (c) {
            var a = names[c.serverA] || c.serverA;
            var b = names[c.serverB] || c.serverB;
            parts.push('<div style="padding:1px 0;margin-left:8px;color:var(--accent-cyan);">' + a + ' ↔ ' + b + (c.isHidden ? ' <span style="color:var(--accent-orange);">(hidden)</span>' : '') + '</div>');
        });
    }
    if (diff.newServers.length > 0) {
        parts.push('<div style="color:var(--accent-green);font-weight:bold;margin-top:4px;">Found ' + diff.newServers.length + ' new server(s):</div>');
        diff.newServers.forEach(function (s) {
            parts.push('<div style="padding:1px 0;margin-left:8px;color:var(--accent-cyan);">🖥️ ' + (s.serverName || s.id) + '</div>');
        });
    }
    if (parts.length === 0) {
        parts.push('<span style="color:var(--accent-orange);">Couldn\'t find anything new...</span>');
    }
    return parts.join('');
}

async function discoverHiddenConnections(options) {
    var opts = options || {};
    var owner = 'discovery-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    if (!acquireLock(owner)) {
        postLog('<span style="color:var(--accent-orange);">Another hidden-connection scan is already running.</span>');
        return { skipped: true, reason: 'locked' };
    }

    var startAt = Date.now();
    var maxDurationMs = opts.maxDurationMs || DEFAULT_MAX_MS;
    try {
        postLog('<span style="color:var(--accent-cyan);">Fetching network map...</span>');
        var before = await __cor3FetchMapData();
        if (!before || !before.servers || !before.connections) {
            postDone('<span style="color:var(--accent-red);">Failed to fetch initial map data</span>');
            return { ok: false, reason: 'initial-map-failed' };
        }

        var fp = fingerprint(before);
        var progress = readJson(PROGRESS_KEY);
        if (!progress || progress.fingerprint !== fp || opts.restart) {
            progress = { fingerprint: fp, scannedIps: [], startedAt: Date.now() };
        }

        var ips = before.servers.map(function (s) { return s.serverIp; }).filter(Boolean);
        var scanned = {};
        (progress.scannedIps || []).forEach(function (ip) { scanned[ip] = true; });
        var remaining = ips.filter(function (ip) { return !scanned[ip]; });
        if (opts.maxIps && opts.maxIps > 0) remaining = remaining.slice(0, opts.maxIps);

        postLog('<span style="color:var(--accent-cyan);">Found ' + ips.length + ' IPs; ' + remaining.length + ' remaining in this run.</span>');

        for (var i = 0; i < remaining.length; i++) {
            if (opts.signal && opts.signal.aborted) {
                writeJson(PROGRESS_KEY, progress);
                postLog('<span style="color:var(--accent-orange);">Scan paused — progress saved.</span>');
                return { ok: false, partial: true, reason: 'aborted' };
            }
            if (Date.now() - startAt > maxDurationMs) {
                writeJson(PROGRESS_KEY, progress);
                postLog('<span style="color:var(--accent-orange);">Scan time limit reached — progress saved. Run again to resume.</span>');
                return { ok: false, partial: true, reason: 'timeout', scanned: progress.scannedIps.length, total: ips.length };
            }
            var ip = remaining[i];
            postLog('<span style="color:var(--accent-cyan);">Connecting ' + (scannedCount(progress) + 1) + '/' + ips.length + ': ' + ip + '</span>');
            connectIp(ip);
            progress.scannedIps.push(ip);
            writeJson(PROGRESS_KEY, progress);
            await sleep(DELAY_MS);
        }

        postLog('<span style="color:var(--accent-cyan);">Scanning complete. Fetching updated map...</span>');
        await sleep(3000);
        var after = await __cor3FetchMapData();
        if (!after || !after.connections) {
            postDone('<span style="color:var(--accent-red);">Failed to fetch updated map data</span>');
            return { ok: false, reason: 'final-map-failed' };
        }

        var names = {};
        (after.servers || []).forEach(function (s) { names[s.id] = s.serverName; });
        var diff = summarizeDiff(before, after);
        var html = diffHtml(diff, names);
        writeJson(LAST_RESULT_KEY, {
            ts: Date.now(),
            scanned: ips.length,
            newConnections: diff.newConnections.length,
            newServers: diff.newServers.length
        });
        removeKey(PROGRESS_KEY);
        postDone(html + '<div style="margin-top:4px;color:var(--text-dim);">Scanned ' + ips.length + ' IPs</div>');
        return {
            ok: true,
            scanned: ips.length,
            newConnections: diff.newConnections,
            newServers: diff.newServers
        };
    } catch (e) {
        postDone('<span style="color:var(--accent-red);">Discovery error: ' + (e && e.message ? e.message : e) + '</span>');
        return { ok: false, reason: 'error', error: e && e.message ? e.message : String(e) };
    } finally {
        releaseLock(owner);
    }
}

function scannedCount(progress) {
    return (progress.scannedIps || []).length;
}

window.__cor3AutomationStatus = window.__cor3AutomationStatus || { active: null, queued: [] };

function isAutomationBusy() {
    var status = window.__cor3AutomationStatus;
    return !!(status && (status.active || (status.queued && status.queued.length > 0)));
}

async function discoverIfIdle(options) {
    if (isAutomationBusy()) {
        postLog('<span style="color:var(--accent-orange);">Auto discovery skipped: another automation is changing the endpoint.</span>');
        return { skipped: true, reason: 'automation-busy' };
    }
    return discoverHiddenConnections(options);
}

function refreshMapAfterAutomation(reason) {
    setTimeout(function () {
        if (isAutomationBusy()) return;
        __cor3FetchMapData().then(function (map) {
            if (map) console.log('[COR3 NetworkDiscovery] map refreshed after ' + reason);
        }).catch(function () {});
    }, 2000);
}

window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'COR3_AUTOMATION_STATUS') {
        window.__cor3AutomationStatus = event.data.status || { active: null, queued: [] };
    }
    if (event.data && event.data.type === 'COR3_AUTOJOB_DONE') {
        refreshMapAfterAutomation('Auto Job');
    }
    if (event.data && event.data.type === 'COR3_VALUABLE_DONE') {
        refreshMapAfterAutomation('Valuable Seller');
    }
});

window.__cor3NetworkDiscovery = {
    discover: discoverHiddenConnections,
    discoverIfIdle: discoverIfIdle,
    isAutomationBusy: isAutomationBusy,
    getProgress: function () { return readJson(PROGRESS_KEY); },
    getLastResult: function () { return readJson(LAST_RESULT_KEY); },
    clearProgress: function () { removeKey(PROGRESS_KEY); }
};

console.log('[COR3 NetworkDiscovery] ready');
