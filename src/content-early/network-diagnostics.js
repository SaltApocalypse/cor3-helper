// Read-only network graph diagnostics.
//
// Exposes window.__cor3NetworkDebug so a tester can capture snapshots from the
// page DevTools console without changing endpoints or running automation.

import { __cor3FetchMapData } from './market-requests.js';

const MAX_LOGS = 100;
const MAX_SNAPSHOTS = 20;

const state = {
    lastMap: null,
    logs: [],
    snapshots: []
};

function pad2(value) { return String(value).padStart(2, '0'); }

function localIsoString(date) {
    var d = date || new Date();
    var offset = -d.getTimezoneOffset();
    var sign = offset >= 0 ? '+' : '-';
    var abs = Math.abs(offset);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
        sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
}

function localStamp(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
        'T' + pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
}

function timeZoneName() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'; }
    catch (e) { return 'unknown'; }
}

function nameOf(map, id) {
    if (!map || !map.servers) return String(id || '');
    for (var i = 0; i < map.servers.length; i++) {
        if (map.servers[i].id === id) return map.servers[i].serverName || id;
    }
    return String(id || '');
}

function connectionKey(c) {
    if (!c) return '';
    if (c.id) return String(c.id);
    var a = String(c.serverA || '');
    var b = String(c.serverB || '');
    return a < b ? a + '|' + b : b + '|' + a;
}

function summarize(map) {
    if (!map || !Array.isArray(map.servers)) return null;
    var connections = Array.isArray(map.connections) ? map.connections : [];
    var hidden = connections.filter(function (c) { return !!c.isHidden; });
    var maintenance = map.servers.filter(function (s) { return !!s.isInMaintenance; });
    var endpoints = map.servers.filter(function (s) { return !!s.isEndpoint; });
    return {
        serverCount: map.servers.length,
        connectionCount: connections.length,
        hiddenConnectionCount: hidden.length,
        maintenanceServers: maintenance.map(function (s) {
            return { id: s.id, name: s.serverName, endsAt: s.maintenanceEndsAt || null };
        }),
        endpoints: endpoints.map(function (s) { return { id: s.id, name: s.serverName }; }),
        hiddenConnections: hidden.map(function (c) {
            return {
                id: c.id || null,
                name: nameOf(map, c.serverA) + ' ↔ ' + nameOf(map, c.serverB),
                serverA: c.serverA,
                serverB: c.serverB
            };
        })
    };
}

function endpointKey(map) {
    if (!map || !Array.isArray(map.servers)) return '';
    return map.servers.filter(function (s) { return !!s.isEndpoint; })
        .map(function (s) { return String(s.id); }).sort().join(',');
}

function diffMaps(prev, next) {
    if (!prev || !next) return { hasChanges: false, reason: 'missing-map' };

    var prevServers = {};
    var nextServers = {};
    var prevConnections = {};
    var nextConnections = {};

    (prev.servers || []).forEach(function (s) { prevServers[s.id] = s; });
    (next.servers || []).forEach(function (s) { nextServers[s.id] = s; });
    (prev.connections || []).forEach(function (c) { prevConnections[connectionKey(c)] = c; });
    (next.connections || []).forEach(function (c) { nextConnections[connectionKey(c)] = c; });

    var addedServers = (next.servers || []).filter(function (s) { return !prevServers[s.id]; });
    var removedServers = (prev.servers || []).filter(function (s) { return !nextServers[s.id]; });
    var addedConnections = (next.connections || []).filter(function (c) { return !prevConnections[connectionKey(c)]; });
    var removedConnections = (prev.connections || []).filter(function (c) { return !nextConnections[connectionKey(c)]; });
    var addedHidden = addedConnections.filter(function (c) { return !!c.isHidden; });
    var endpointChanged = endpointKey(prev) !== endpointKey(next);

    function decorateConnection(c) {
        return {
            id: c.id || null,
            serverA: c.serverA,
            serverB: c.serverB,
            name: nameOf(next, c.serverA) + ' ↔ ' + nameOf(next, c.serverB),
            isHidden: !!c.isHidden
        };
    }

    var hasChanges = addedServers.length > 0 || removedServers.length > 0 ||
        addedConnections.length > 0 || removedConnections.length > 0 || endpointChanged;

    return {
        hasChanges: hasChanges,
        addedServers: addedServers.map(function (s) { return { id: s.id, name: s.serverName, ip: s.serverIp || null }; }),
        removedServers: removedServers.map(function (s) { return { id: s.id, name: s.serverName }; }),
        addedConnections: addedConnections.map(decorateConnection),
        removedConnections: removedConnections.map(decorateConnection),
        addedHiddenConnections: addedHidden.map(decorateConnection),
        endpointsBefore: endpointKey(prev),
        endpointsAfter: endpointKey(next),
        endpointChanged: endpointChanged
    };
}

function addLog(type, message, data) {
    var now = new Date();
    var entry = {
        ts: now.toISOString(),
        localTs: localIsoString(now),
        type: type,
        message: message,
        data: data || null
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
    console.log('[COR3 NetworkDiag] ' + message, data || '');
    return entry;
}

function handleMapData(data) {
    if (!data || !Array.isArray(data.servers)) return;
    var map = {
        servers: data.servers,
        connections: Array.isArray(data.connections) ? data.connections : []
    };
    var summary = summarize(map);
    if (!state.lastMap) {
        state.lastMap = map;
        addLog('initial-map', 'Initial network map captured', summary);
        return;
    }
    var diff = diffMaps(state.lastMap, map);
    state.lastMap = map;
    if (diff.hasChanges) {
        addLog('map-change', 'Network map changed', diff);
    }
}

function htmlToText(html) {
    if (!html) return '';
    var div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'COR3_WS_MAP_DATA') {
        handleMapData(event.data);
    }
    if (event.data && event.data.type === 'COR3_IP_SEARCH_LOG') {
        addLog('secret-finder', htmlToText(event.data.html));
    }
    if (event.data && event.data.type === 'COR3_IP_SEARCH_DONE') {
        addLog('secret-finder-done', htmlToText(event.data.html));
    }
});

async function snapshot(label, opts) {
    var map = await __cor3FetchMapData();
    if (!map) {
        return addLog('snapshot', 'Snapshot failed: map data timeout', { label: label || null });
    }
    var now = new Date();
    var entry = {
        label: label || ('snapshot-' + (state.snapshots.length + 1)),
        ts: now.toISOString(),
        localTs: localIsoString(now),
        summary: summarize(map),
        map: (opts && opts.full === false) ? null : map
    };
    state.snapshots.push(entry);
    if (state.snapshots.length > MAX_SNAPSHOTS) {
        state.snapshots.splice(0, state.snapshots.length - MAX_SNAPSHOTS);
    }
    addLog('snapshot', 'Snapshot captured: ' + entry.label, entry.summary);
    return entry;
}

function diffSnapshots(a, b) {
    var prev = typeof a === 'number' ? state.snapshots[a] : null;
    var next = typeof b === 'number' ? state.snapshots[b] : null;
    if (!prev || !next) {
        return { error: 'snapshot index not found', count: state.snapshots.length };
    }
    return {
        from: prev.label,
        to: next.label,
        diff: diffMaps(prev.map, next.map)
    };
}

function dump() {
    return {
        logs: state.logs.slice(),
        snapshots: state.snapshots.map(function (s, i) {
            return { index: i, label: s.label, ts: s.ts, summary: s.summary };
        }),
        lastMapSummary: summarize(state.lastMap)
    };
}

function exportData() {
    var now = new Date();
    return {
        generatedAt: now.toISOString(),
        generatedAtLocal: localIsoString(now),
        timeZone: timeZoneName(),
        timezoneOffsetMinutes: -now.getTimezoneOffset(),
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        logs: state.logs.slice(),
        snapshots: state.snapshots.map(function (s, i) {
            return {
                index: i,
                label: s.label,
                ts: s.ts,
                localTs: s.localTs,
                summary: s.summary,
                map: s.map
            };
        }),
        lastMap: state.lastMap
    };
}

function download(label) {
    var data = exportData();
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var stamp = localStamp(new Date());
    var safeLabel = String(label || 'network-diagnostics')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'network-diagnostics';
    var filename = 'cor3-' + safeLabel + '-' + stamp + '.json';
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    console.log('[COR3 NetworkDiag] downloaded ' + filename +
        ' (' + data.logs.length + ' log entries, ' + data.snapshots.length + ' snapshots)');
    return {
        filename: filename,
        bytes: blob.size,
        logs: data.logs.length,
        snapshots: data.snapshots.length
    };
}

function help() {
    console.log([
        '[COR3 NetworkDiag]',
        '  __cor3NetworkDebug.snapshot("label")  capture get.map',
        '  __cor3NetworkDebug.diff(0, 1)         diff two snapshots',
        '  __cor3NetworkDebug.download("label")  download full JSON log + maps',
        '  __cor3NetworkDebug.dump()             small summary only',
        '  __cor3NetworkDebug.clear()            clear logs and snapshots',
        '  __cor3NetworkDebug.help()             show this help',
        '',
        'The debugger only calls get.map; it does not change endpoints.'
    ].join('\n'));
}

window.__cor3NetworkDebug = {
    snapshot: snapshot,
    diff: diffSnapshots,
    download: download,
    exportData: exportData,
    dump: dump,
    clear: function () {
        state.logs.length = 0;
        state.snapshots.length = 0;
        state.lastMap = null;
        console.log('[COR3 NetworkDiag] cleared');
    },
    summarize: function () { return summarize(state.lastMap); },
    help: help
};

console.log('[COR3 NetworkDiag] ready — run __cor3NetworkDebug.help()');
