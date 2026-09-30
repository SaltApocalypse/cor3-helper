// WebSocket proxy: intercepts WS constructor, tracks sockets, decodes binary messages
import {
    OrigWebSocket, trackedSockets, socketLastActivity,
    getActiveSocket, setActiveSocket,
    getCapturedBearerToken, setCapturedBearerToken,
    pendingRetryOps, tokenExpiredFlag, setTokenExpiredFlag, setPendingRetryOps
} from './state.js';

export function decodeBinaryMsg(raw, cb) {
    var codec = window.__cor3MsgpackCodec;
    if (!codec) { cb(null); return; }
    if (raw instanceof Blob) {
        raw.arrayBuffer().then(function (buf) {
            try {
                var pkt = codec.decode(new Uint8Array(buf));
                cb(codec.packetToString(pkt));
            } catch (e) { cb(null); }
        }).catch(function () { cb(null); });
        return;
    }
    try {
        var u8 = (raw instanceof ArrayBuffer) ? new Uint8Array(raw) : raw;
        var pkt = codec.decode(u8);
        cb(codec.packetToString(pkt));
    } catch (e) { cb(null); }
}

// Install WebSocket proxy. handleWsMessage is injected to avoid circular imports.
export function installWebSocketProxy(handleWsMessage) {
    // Use a Proxy so both `new WebSocket(...)` and instanceof checks work correctly
    const WebSocketProxy = new Proxy(OrigWebSocket, {
        construct(target, args) {
            const ws = new target(...args);
            const url = args[0] || '';

            // Minigame sockets (ice-wall-break, etc.) should NOT be tracked as the
            // active game socket — they handle their own WS protocol and would
            // interfere with command sending if promoted to activeSocket.
            var isMinigameSocket = url.includes('ice-wall-break') || url.includes('minigame') || url.includes('hack') || url.includes('games');
            ws.__cor3IsMinigame = isMinigameSocket;

            if (url.includes('cor3') || url.includes('corie')) {
                console.log('[COR3 Helper] Tracking WebSocket:', url, isMinigameSocket ? '(minigame — excluded from active tracking)' : '');
                ws.__cor3Url = url;
                if (!isMinigameSocket) {
                    trackedSockets.push(ws);
                }

                // Intercept ALL send() calls on this socket to log user-triggered messages
                var origSend = ws.send.bind(ws);
                ws.send = function (data) {
                    try {
                        if (typeof data === 'string') {
                            if (data.indexOf('40{') === 0) {
                                try {
                                    var connectPayload = JSON.parse(data.substring(2));
                                    if (connectPayload.token && connectPayload.token.startsWith('Bearer ')) {
                                        setCapturedBearerToken(connectPayload.token);
                                        window.postMessage({ type: 'COR3_BEARER_TOKEN', token: connectPayload.token }, '*');
                                    }
                                } catch (e) { /* silent */ }
                            }
                            window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: data }, '*');
                        } else if (data instanceof ArrayBuffer || (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(data))) {
                            decodeBinaryMsg(data, function (str) {
                                if (str) {
                                    window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: str }, '*');
                                    // Capture token from binary 40{...} connect messages
                                    if (str.indexOf('40{') === 0) {
                                        try {
                                            var cp = JSON.parse(str.substring(2));
                                            if (cp.token && cp.token.startsWith('Bearer ')) {
                                                setCapturedBearerToken(cp.token);
                                                window.postMessage({ type: 'COR3_BEARER_TOKEN', token: cp.token }, '*');
                                            }
                                        } catch (e) { /* silent */ }
                                    }
                                }
                            });
                        } else if (data instanceof Blob) {
                            decodeBinaryMsg(data, function (str) {
                                if (str) {
                                    window.postMessage({ type: 'COR3_WS_LOG', direction: 'sent', message: str }, '*');
                                    // Capture token from binary 40{...} connect messages
                                    if (str.indexOf('40{') === 0) {
                                        try {
                                            var cp = JSON.parse(str.substring(2));
                                            if (cp.token && cp.token.startsWith('Bearer ')) {
                                                setCapturedBearerToken(cp.token);
                                                window.postMessage({ type: 'COR3_BEARER_TOKEN', token: cp.token }, '*');
                                            }
                                        } catch (e) { /* silent */ }
                                    }
                                }
                            });
                        }
                    } catch (e) { /* silent */ }
                    return origSend(data);
                };

                ws.addEventListener('message', function (event) {
                    try {
                        if (!isMinigameSocket) {
                            if (getActiveSocket() !== ws) {
                                console.log('[COR3 Helper] Active socket changed to:', ws.__cor3Url);
                                setActiveSocket(ws);
                            }
                            socketLastActivity.set(ws, Date.now());
                        }
                        var raw = event.data;
                        if (raw instanceof ArrayBuffer || raw instanceof Blob || (typeof Uint8Array !== 'undefined' && ArrayBuffer.isView(raw) && !(raw instanceof DataView))) {
                            decodeBinaryMsg(raw, function (str) {
                                if (str) handleWsMessage(str, ws);
                            });
                        } else {
                            handleWsMessage(raw, ws);
                        }
                    } catch (e) {
                        // silent
                    }
                });

                // Auto-fetch all data when WS connects (page load/reload)
                ws.addEventListener('open', function () {
                    console.log('[COR3 Helper] WS connected — scheduling initial data fetch');
                    // Wait for connection to stabilize, then fetch all data
                    setTimeout(function () {
                        // Clear pending retry ops — initial fetch covers expeditions, stash, dailyOps
                        if (tokenExpiredFlag || pendingRetryOps.length > 0) {
                            console.log('[COR3 Helper] Clearing pending retries (initial fetch will cover them):', pendingRetryOps.join(', '));
                            setPendingRetryOps([]);
                            setTokenExpiredFlag(false);
                        }
                        window.__cor3InitialFetch && window.__cor3InitialFetch();
                    }, 3000);
                });

                // Clean up closed sockets
                ws.addEventListener('close', function () {
                    console.log('[COR3 Helper] WS closed');
                    const idx = trackedSockets.indexOf(ws);
                    if (idx !== -1) trackedSockets.splice(idx, 1);
                    socketLastActivity.delete(ws);
                    if (getActiveSocket() === ws) setActiveSocket(null);
                    // Notify ICE Wall solver when its minigame WS closes
                    if (ws.__cor3IsMinigame && ws.__cor3Url && ws.__cor3Url.indexOf('ice-wall-break') !== -1) {
                        window.postMessage({ type: 'COR3_ICE_WALL_GAME_ENDED' }, '*');
                    }
                });
            }

            return ws;
        },
        get(target, prop, receiver) {
            return Reflect.get(target, prop, receiver);
        }
    });

    // Preserve static properties and prototype
    Object.defineProperty(WebSocketProxy, 'prototype', {
        value: OrigWebSocket.prototype,
        writable: false,
        configurable: false
    });

    window.WebSocket = WebSocketProxy;
}
