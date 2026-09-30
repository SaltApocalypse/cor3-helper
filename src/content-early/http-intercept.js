// HTTP intercept: fetch and XHR overrides for version capture, polling parse, bearer token
import { setCapturedBearerToken } from './state.js';

var webVersion = null;

// --- Helper: Parse Socket.IO polling response for desktop.get.options ---
// Socket.IO polling responses can contain multiple messages concatenated.
// Each message is prefixed with its byte length, e.g. "123:42[...]456:42[...]"
// Or sometimes just a single "42[...]" message.
function parsePollingForDesktopOptions(responseText) {
    if (!responseText || typeof responseText !== 'string') return;
    // Find all 42["desktop",...] messages in the response
    var startIdx = 0;
    while (startIdx < responseText.length) {
        var msgStart = responseText.indexOf('42["desktop"', startIdx);
        if (msgStart === -1) break;
        // Try to parse from this position
        var jsonStart = msgStart + 2; // skip "42"
        try {
            // Find the matching closing bracket — use a simple approach
            var bracketDepth = 0;
            var inString = false;
            var escape = false;
            var end = -1;
            for (var ci = jsonStart; ci < responseText.length; ci++) {
                var ch = responseText[ci];
                if (escape) { escape = false; continue; }
                if (ch === '\\' && inString) { escape = true; continue; }
                if (ch === '"') { inString = !inString; continue; }
                if (inString) continue;
                if (ch === '[' || ch === '{') bracketDepth++;
                else if (ch === ']' || ch === '}') {
                    bracketDepth--;
                    if (bracketDepth === 0) { end = ci + 1; break; }
                }
            }
            if (end > jsonStart) {
                var jsonStr = responseText.substring(jsonStart, end);
                var parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed) && parsed[0] === 'desktop' && parsed[1]) {
                    var payload = parsed[1];
                    if (payload.event && payload.event.action === 'get.options' && payload.data) {
                        console.log('[COR3 Helper] Desktop get.options found in polling response — folders:', payload.data.folders ? payload.data.folders.length : 0);
                        // Cache Downloads folder ID
                        if (payload.data.folders) {
                            var dlf = payload.data.folders.find(function (f) { return f.name === 'Downloads'; });
                            if (dlf) {
                                window.__cor3DownloadFolderId = dlf.id;
                                console.log('[COR3 Helper] Cached Downloads folder ID from polling:', dlf.id);
                            }
                        }
                        // Also relay as postMessage so auto-job-solver can pick it up
                        window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_OPTIONS', data: payload.data, error: payload.error || null }, '*');
                    }
                    // Also handle update.file from polling
                    if (payload.event && (payload.event.action === 'update.file' || payload.event.action === 'open.file' || payload.event.action === 'decrypt.file') && (payload.data || payload.error)) {
                        var pollFileError = payload.error || null;
                        if (!pollFileError && payload.data && payload.data.kind === 'insufficient_power') {
                            pollFileError = { message: 'insufficient_power', kind: 'insufficient_power', ability: payload.data.ability, required: payload.data.required, available: payload.data.available };
                        }
                        window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_FILE', data: payload.data || null, error: pollFileError }, '*');
                        if (payload.event.action === 'update.file') {
                            window.postMessage({ type: 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE', data: payload.data || null, error: payload.error || null }, '*');
                        }
                    }
                }
            }
        } catch (e) { /* parse error — skip */ }
        startIdx = msgStart + 1;
    }
}

export function installHttpIntercept() {
    const OrigFetch = window.fetch;
    window.fetch = function () {
        const args = arguments;
        const input = args[0];
        try {
            const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            // Intercept translation.json for webVersion
            if (url.includes('translation.json')) { // url = /locales/tr/translation.json?v=v1.17.21
                try {
                    const parsedUrl = new URL(url, window.location.origin);
                    if (!webVersion) {
                        webVersion = parsedUrl.searchParams.get('v');
                    }
                    console.log('[COR3 Helper] Captured web version from translation.json:', webVersion);
                    window.__cor3WebVersion = webVersion;
                    setTimeout(function () {
                        window.postMessage({ type: 'COR3_WEB_VERSION', version: webVersion }, '*');
                    }, 250);
                } catch (e) {
                    console.log('[COR3 Helper] Error parsing version:', e);
                }
            }
        } catch (e) { /* silent */ }

        // Intercept users/me response for systemVersion
        var result = OrigFetch.apply(this, args);
        try {
            var fetchUrl = typeof input === 'string' ? input : (input && input.url ? input.url : '');
            // Intercept Socket.IO polling responses via fetch
            if (fetchUrl.includes('socket.io') && fetchUrl.includes('transport=polling')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().text().then(function (text) {
                            parsePollingForDesktopOptions(text);
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
            if (fetchUrl.includes('api/users/me')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().json().then(function (data) {
                            if (data && data.systemVersion !== undefined) {
                                console.log('[COR3 Helper] Captured system version from api/users/me:', data.systemVersion);
                                window.__cor3SystemVersion = data.systemVersion;
                                window.postMessage({ type: 'COR3_SYSTEM_VERSION', version: data.systemVersion }, '*');
                            }
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
            // Intercept daily-claim/rewards response
            if (fetchUrl.includes('api/user-daily-claim/rewards')) {
                result.then(function (resp) {
                    if (resp && resp.ok) {
                        resp.clone().json().then(function (data) {
                            if (Array.isArray(data)) {
                                window.postMessage({ type: 'COR3_DAILY_REWARDS', rewards: data }, '*');
                            }
                        }).catch(function () {});
                    }
                }).catch(function () {});
            }
        } catch (e) { /* silent */ }

        return result;
    };

    const OrigXHROpen = XMLHttpRequest.prototype.open;
    const OrigXHRSend = XMLHttpRequest.prototype.send;
    const OrigXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function () {
        this.__cor3Url = arguments[1] || '';
        return OrigXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if ((name === 'Authorization' || name === 'authorization') &&
            value && value.startsWith('Bearer ') &&
            (this.__cor3Url && (this.__cor3Url.includes('cor3') || this.__cor3Url.includes('corie')))) {
            setCapturedBearerToken(value);
            window.postMessage({ type: 'COR3_BEARER_TOKEN', token: value }, '*');
        }
        return OrigXHRSetHeader.apply(this, arguments);
    };
    // Intercept XHR responses from Socket.IO polling transport
    XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (xhr.__cor3Url && xhr.__cor3Url.includes('socket.io') && xhr.__cor3Url.includes('transport=polling')) {
            xhr.addEventListener('load', function () {
                try {
                    if (xhr.responseText) {
                        parsePollingForDesktopOptions(xhr.responseText);
                    }
                } catch (e) { /* silent */ }
            });
        }
        return OrigXHRSend.apply(this, arguments);
    };
}
