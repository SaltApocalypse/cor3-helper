// Shared message parsing & formatting utilities for devtools-panel and devtools-log-viewer

import { SERVER_ID_MAP, MARKET_ID_MAP, NO_SERVER_ACTIONS } from './devtools-constants.js';

export function formatTime(isoStr) {
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' })
            + '.' + String(d.getUTCMilliseconds()).padStart(3, '0');
    } catch (e) { return '??:??:??'; }
}

export function formatSize(str) {
    const len = str ? str.length : 0;
    if (len < 1024) return len + ' B';
    return (len / 1024).toFixed(1) + ' KB';
}

export function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

export function safeSetHtml(el, html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.replaceChildren(...doc.body.childNodes);
}

export function stripSioPrefix(msg) {
    if (!msg || typeof msg !== 'string') return msg;
    const m = msg.match(/^\d+(?:\/[^,]*,)?(\[.+)$/s);
    return m ? m[1] : msg;
}

export function parseEvent(msg) {
    if (!msg || typeof msg !== 'string') return { event: '\u2014', payload: null };
    const match = msg.match(/^\d+(?:\/[^,]*,)?\["([^"]+)"/);
    if (match) {
        return { event: match[1], payload: msg };
    }
    if (msg === '2') return { event: 'ping', payload: null };
    if (msg === '3') return { event: 'pong', payload: null };
    if (msg.startsWith('0{')) return { event: 'handshake', payload: msg };
    if (msg === '40') return { event: 'connect', payload: null };
    return { event: '\u2014', payload: msg };
}

// Extract the parsed JSON data from a Socket.IO 42-frame message
export function parseMsgData(msg) {
    if (!msg || typeof msg !== 'string') return null;
    const stripped = stripSioPrefix(msg);
    if (stripped === msg && !msg.startsWith('[')) return null;
    try {
        const arr = JSON.parse(stripped);
        if (Array.isArray(arr) && arr.length >= 2) return arr[1];
    } catch (e) { /* silent */ }
    return null;
}

// Extract action from parsed payload (data.event.action or data.action)
export function extractAction(data) {
    if (!data || typeof data !== 'object') return '\u2014';
    if (data.event && data.event.action) return data.event.action;
    if (data.action) return data.action;
    return '\u2014';
}

// Resolve server name from serverId or marketId in the parsed data
export function resolveServer(data) {
    if (!data || typeof data !== 'object') return '\u2014';
    // For actions where server info is not meaningful, show '\u2014'
    const action = extractAction(data);
    if (NO_SERVER_ACTIONS.has(action)) return '\u2014';
    // Check data.serverId directly
    if (data.serverId && SERVER_ID_MAP[data.serverId]) return SERVER_ID_MAP[data.serverId];
    if (data.serverId) return data.serverId.substring(0, 8) + '\u2026';
    // Check nested data.data.serverId
    if (data.data && data.data.serverId && SERVER_ID_MAP[data.data.serverId]) return SERVER_ID_MAP[data.data.serverId];
    if (data.data && data.data.serverId) return data.data.serverId.substring(0, 8) + '\u2026';
    // Check data.data.currentEndpointId (set.endpoint server responses)
    if (data.data && data.data.currentEndpointId && SERVER_ID_MAP[data.data.currentEndpointId]) return SERVER_ID_MAP[data.data.currentEndpointId];
    if (data.data && data.data.currentEndpointId) return data.data.currentEndpointId.substring(0, 8) + '\u2026';
    // Check data.marketId -> resolve to market name (client msgs: get.options, get.lots, get.jobs)
    if (data.marketId && MARKET_ID_MAP[data.marketId]) return MARKET_ID_MAP[data.marketId];
    // Check nested data.data.marketId (client msgs send marketId inside data)
    if (data.data && data.data.marketId && MARKET_ID_MAP[data.data.marketId]) return MARKET_ID_MAP[data.data.marketId];
    if (data.data && data.data.market && data.data.market.id && MARKET_ID_MAP[data.data.market.id]) return MARKET_ID_MAP[data.data.market.id];
    return '\u2014';
}

export function tryPrettyPrint(raw) {
    if (!raw) return '';
    const stripped = stripSioPrefix(raw);
    if (stripped !== raw && stripped.startsWith('[')) {
        try {
            const parsed = JSON.parse(stripped);
            const event = parsed[0];
            const data = parsed.length > 1 ? parsed.slice(1) : [];
            let result = 'Event: ' + event + '\n';
            if (data.length === 1) {
                result += '\n' + JSON.stringify(data[0], null, 2);
            } else if (data.length > 1) {
                result += '\n' + JSON.stringify(data, null, 2);
            }
            return result;
        } catch (e) { /* fall through */ }
    }
    // Handshake (0{...})
    if (raw.startsWith('0{')) {
        try {
            return 'Handshake\n\n' + JSON.stringify(JSON.parse(raw.substring(1)), null, 2);
        } catch (e) { /* fall through */ }
    }
    // Try plain JSON
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch (e) { /* fall through */ }
    return raw;
}
