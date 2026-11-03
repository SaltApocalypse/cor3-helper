// Mailbox (mail) auto-claim.
//
// New game flow (v1.7+):
//   - Mercenary expedition: pay via expeditions/open.container -> loot is
//     delivered to the mailbox (source: EXPEDITION, sourceId: expedition id).
//   - Personal drone: successful mission -> loot is delivered directly to the
//     mailbox (source: DRONE_MISSION, sourceId: mission id).
//
// Claim commands (captured from the live game):
//   42["event",{"event":{"name":"mail","action":"claim.all"},"data":{"messageId":"..."}}]
//   42["event",{"event":{"name":"mail","action":"claim.item"},"data":{"attachmentId":"...","placement":{"x":0,"y":0,"rotated":false}}}]
//
// `claim.all` claims every attachment of one message and lets the server place
// the items. We process messages serially so the response can be correlated
// without relying on requestId.
import { isContextValid } from './helpers.js';
import { autoSellCheapestItems } from './auto-send.js';

const CLAIM_TIMEOUT_MS = 15000;
const CLAIM_GAP_MS = 650;
const MAX_CLAIM_RETRIES = 3;
const WATCH_ASSUME_DONE_MS = 20000;

let _mailData = null;
let _mailUpdatedAt = 0;
let _active = null;
let _queue = [];
let _queuedIds = new Set();
let _claimedIds = new Set();
let _seenSources = new Set();
let _sourceById = new Map(); // sourceId -> 'EXPEDITION' | 'DRONE_MISSION'
let _watched = new Map();
let _forcedSources = new Set(); // manual claim requests, bypass automation toggles
let _sorting = false;
let _fallbackActive = false;
let _itemClaimResolver = null;

function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[COR3 Helper] Mail:');
    console.log.apply(console, args);
}

function messageAttachments(m) {
    return (m && Array.isArray(m.attachments)) ? m.attachments : [];
}

function messageSourceInfo(m) {
    var atts = messageAttachments(m);
    for (var i = 0; i < atts.length; i++) {
        var a = atts[i];
        if (a && (a.source === 'EXPEDITION' || a.source === 'DRONE_MISSION')) {
            return { source: a.source, sourceId: a.sourceId || null };
        }
    }
    return null;
}

function messageCells(m) {
    var total = 0;
    var atts = messageAttachments(m);
    for (var i = 0; i < atts.length; i++) {
        var a = atts[i] || {};
        var w = a.width || 1;
        var h = a.height || 1;
        // A stack occupies one footprint; quantity does not multiply grid cells.
        total += w * h;
    }
    return Math.max(1, total);
}

// --- claim.item fallback (grid fragmentation) -----------------------------
// If claim.all cannot auto-place a reward but the stash has enough free cells
// in total, place each attachment explicitly with claim.item.
function buildOccupancy(stash) {
    var gw = Number(stash.gridWidth) || 12;
    var gh = Number(stash.usableRows) || 60;
    var grid = [];
    for (var y = 0; y < gh; y++) {
        var row = [];
        for (var x = 0; x < gw; x++) row.push(false);
        grid.push(row);
    }
    var items = Array.isArray(stash.items) ? stash.items : [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || (it.location && it.location !== 'stash')) continue;
        var iw = Number(it.width) || 1;
        var ih = Number(it.height) || 1;
        var ix = Number(it.x) || 0;
        var iy = Number(it.y) || 0;
        for (var yy = iy; yy < iy + ih; yy++) {
            for (var xx = ix; xx < ix + iw; xx++) {
                if (grid[yy] && grid[yy][xx] !== undefined) grid[yy][xx] = true;
            }
        }
    }
    return { grid: grid, gw: gw, gh: gh };
}

function findFreePlacement(grid, gw, gh, w, h, canRotate) {
    function scan(width, height, rotated) {
        for (var y = 0; y <= gh - height; y++) {
            for (var x = 0; x <= gw - width; x++) {
                var free = true;
                for (var yy = y; yy < y + height && free; yy++) {
                    for (var xx = x; xx < x + width; xx++) {
                        if (grid[yy][xx]) { free = false; break; }
                    }
                }
                if (free) return { x: x, y: y, rotated: rotated };
            }
        }
        return null;
    }
    var p = scan(w, h, false);
    if (p) return p;
    if (canRotate && w !== h) return scan(h, w, true);
    return null;
}

function planAttachmentPlacements(msg, stash) {
    var occ = buildOccupancy(stash);
    var placements = [];
    var atts = messageAttachments(msg);
    for (var i = 0; i < atts.length; i++) {
        var a = atts[i] || {};
        var w = Number(a.width) || 1;
        var h = Number(a.height) || 1;
        var p = findFreePlacement(occ.grid, occ.gw, occ.gh, w, h, !!a.canRotate);
        if (!p) return null;
        var pw = p.rotated ? h : w;
        var ph = p.rotated ? w : h;
        for (var yy = p.y; yy < p.y + ph; yy++) {
            for (var xx = p.x; xx < p.x + pw; xx++) occ.grid[yy][xx] = true;
        }
        placements.push({ attachmentId: a.id, x: p.x, y: p.y, rotated: p.rotated });
    }
    return placements;
}

function sendClaimItem(attachmentId, x, y, rotated) {
    return new Promise(function (resolve) {
        var done = false;
        var timer = null;
        function finish(res) {
            if (done) return;
            done = true;
            if (_itemClaimResolver && _itemClaimResolver.finish === finish) _itemClaimResolver = null;
            if (timer) clearTimeout(timer);
            resolve(res);
        }
        _itemClaimResolver = { attachmentId: attachmentId, finish: finish };
        timer = setTimeout(function () { finish({ ok: false, error: 'claim.item timeout' }); }, 10000);
        window.postMessage({
            type: 'COR3_MAIL_CLAIM_ITEM',
            attachmentId: attachmentId,
            x: x,
            y: y,
            rotated: rotated
        }, '*');
    });
}

function tryItemFallback(msg) {
    if (_fallbackActive) return Promise.resolve(false);
    return new Promise(function (resolve) {
        chrome.storage.local.get(['stashData', 'stashSorting', 'gameplayData'], function (local) {
            if (stashIsBusy(local)) { resolve(false); return; }
            var stash = local ? local.stashData : null;
            if (!stash || !Array.isArray(stash.items)) { resolve(false); return; }
            var placements = planAttachmentPlacements(msg, stash);
            if (!placements || placements.length === 0) { resolve(false); return; }

            _fallbackActive = true;
            markWarning('Mailbox: claim.all could not place the reward — placing it item by item…');
            log('claim.all placement failed; using claim.item fallback for', placements.length, 'attachment(s)');

            (async function () {
                for (var i = 0; i < placements.length; i++) {
                    var pl = placements[i];
                    var res = await sendClaimItem(pl.attachmentId, pl.x, pl.y, pl.rotated);
                    if (!res.ok) {
                        _fallbackActive = false;
                        markWarning('Mailbox: claim.item fallback failed: ' + res.error);
                        log('claim.item fallback failed:', res.error);
                        resolve(true); // attempted; do not auto-sell on a partial result
                        return;
                    }
                }
                _fallbackActive = false;
                _claimedIds.add(msg.id);
                if (_mailData && Array.isArray(_mailData.messages)) {
                    for (var j = 0; j < _mailData.messages.length; j++) {
                        if (_mailData.messages[j].id === msg.id) _mailData.messages[j].status = 'CLAIMED';
                    }
                }
                markWarning(null);
                log('claim.item fallback claimed message', msg.id);
                var info = messageSourceInfo(msg);
                setTimeout(function () {
                    pump();
                    if (info) checkSourceComplete(info.sourceId, false, info.source);
                }, CLAIM_GAP_MS);
                resolve(true);
            })().catch(function (e) {
                _fallbackActive = false;
                markWarning('Mailbox: claim.item fallback error: ' + (e && e.message ? e.message : e));
                resolve(true);
            });
        });
    });
}

function isCapacityError(msg) {
    var m = String(msg || '').toLowerCase();
    return m.indexOf('insufficient stash') !== -1 ||
        m.indexOf('insufficient_capacity') !== -1 ||
        m.indexOf('stash full') !== -1 ||
        m.indexOf('stash.error.insufficient') !== -1 ||
        m.indexOf('capacity') !== -1;
}

function emitClaimed(source, sourceId, assumed) {
    var w = _watched.get(sourceId);
    if (w) {
        if (w.emitted) return;
        w.emitted = true;
        if (w.timer) clearTimeout(w.timer);
    }
    source = source || _sourceById.get(sourceId) || 'EXPEDITION';
    _forcedSources.delete(sourceId);
    log('source complete:', source, sourceId, assumed ? '(assumed)' : '');
    window.postMessage({
        type: 'COR3_MAIL_CLAIMED',
        source: source,
        sourceId: sourceId,
        assumed: !!assumed
    }, '*');
}

function sourceHasWork(sourceId) {
    if (!sourceId) return false;
    if (_active && messageSourceInfo(_active.msg) && messageSourceInfo(_active.msg).sourceId === sourceId) return true;
    if (_queue.some(function (m) { return messageSourceInfo(m) && messageSourceInfo(m).sourceId === sourceId; })) return true;
    var msgs = (_mailData && Array.isArray(_mailData.messages)) ? _mailData.messages : [];
    return msgs.some(function (m) {
        var info = messageSourceInfo(m);
        return info && info.sourceId === sourceId && m.status === 'PENDING' && !_claimedIds.has(m.id);
    });
}

function checkSourceComplete(sourceId, force, sourceHint) {
    if (!sourceId) return;
    var seen = false;
    var seenSource = sourceHint || null;
    var msgs = (_mailData && Array.isArray(_mailData.messages)) ? _mailData.messages : [];
    for (var i = 0; i < msgs.length; i++) {
        var info = messageSourceInfo(msgs[i]);
        if (info && info.sourceId === sourceId) {
            seen = true;
            seenSource = info.source;
            break;
        }
    }
    if (seen && seenSource) _sourceById.set(sourceId, seenSource);
    if (seen) _seenSources.add(sourceId);
    if (!seen) {
        if (force) {
            var w = _watched.get(sourceId);
            emitClaimed((w && w.source) || seenSource || _sourceById.get(sourceId) || 'EXPEDITION', sourceId, true);
        }
        return;
    }
    if (!sourceHasWork(sourceId)) {
        var w2 = _watched.get(sourceId);
        emitClaimed((w2 && w2.source) || seenSource || _sourceById.get(sourceId) || 'EXPEDITION', sourceId, false);
    }
}

function hasMailSource(sourceId) {
    var msgs = (_mailData && Array.isArray(_mailData.messages)) ? _mailData.messages : [];
    for (var i = 0; i < msgs.length; i++) {
        var info = messageSourceInfo(msgs[i]);
        if (info && info.sourceId === sourceId) return true;
    }
    return false;
}

function watchSource(source, sourceId, timeoutMs) {
    if (!sourceId) return;
    source = source || _sourceById.get(sourceId) || 'EXPEDITION';
    if (_watched.has(sourceId)) {
        checkSourceComplete(sourceId, false, source);
        return;
    }
    var entry = { source: source, timer: null, emitted: false };
    _watched.set(sourceId, entry);
    _sourceById.set(sourceId, entry.source);
    // Joining the stash room makes the server push a fresh mail update.state.
    // Only do it when we have not seen this source yet; re-joining while a claim
    // is being processed could briefly leave the room.
    if (!hasMailSource(sourceId)) {
        window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
    }
    checkSourceComplete(sourceId, false);
    entry.timer = setTimeout(function () {
        var w = _watched.get(sourceId);
        if (!w || w.emitted) return;
        if (_seenSources.has(sourceId)) {
            checkSourceComplete(sourceId, true);
        } else {
            log('no mailbox message seen for', sourceId, '- assuming already collected');
            emitClaimed(source || 'EXPEDITION', sourceId, true);
        }
    }, timeoutMs || WATCH_ASSUME_DONE_MS);
}

function enqueueMessage(m) {
    if (!m || !m.id || m.status !== 'PENDING') return;
    var info = messageSourceInfo(m);
    if (!info) return;
    _seenSources.add(info.sourceId);
    if (info.sourceId) _sourceById.set(info.sourceId, info.source);
    if (_queuedIds.has(m.id) || _claimedIds.has(m.id)) return;
    if (_active && _active.msg && _active.msg.id === m.id) return;
    _queue.push(m);
    _queuedIds.add(m.id);
}

function stashIsBusy(local) {
    if (!local) return false;
    if (local.stashSorting) return true;
    var stash = local.stashData;
    if (stash && stash.sortingTable && Array.isArray(stash.sortingTable.items) && stash.sortingTable.items.length > 0) return true;
    var gameplay = local.gameplayData;
    if (gameplay && gameplay.gameplayBlockReason === 'stash-sorting') return true;
    return false;
}

function maybeEnqueueAll() {
    if (!_mailData || !Array.isArray(_mailData.messages)) return;
    chrome.storage.local.get(['stashSorting', 'stashData', 'gameplayData'], function (local) {
        if (stashIsBusy(local)) { _sorting = true; return; }
        _sorting = false;
        chrome.storage.sync.get(['autoSendMerc', 'autoDrone'], function (settings) {
            var expEnabled = !!(settings.autoSendMerc && settings.autoSendMerc.enabled);
            var droneEnabled = !!(settings.autoDrone && settings.autoDrone.enabled);
            if (!expEnabled && !droneEnabled && _forcedSources.size === 0) return;
            var msgs = _mailData.messages || [];
            for (var i = 0; i < msgs.length; i++) {
                var m = msgs[i];
                if (!m || !m.id || m.status !== 'PENDING') continue;
                var info = messageSourceInfo(m);
                if (!info) continue;
                _seenSources.add(info.sourceId);
                if (info.sourceId) _sourceById.set(info.sourceId, info.source);
                var forced = _forcedSources.has(info.sourceId);
                if (!forced) {
                    if (info.source === 'EXPEDITION' && !expEnabled) continue;
                    if (info.source === 'DRONE_MISSION' && !droneEnabled) continue;
                }
                enqueueMessage(m);
            }
            pump();
            // Re-evaluate watched sources after a fresh state.
            _watched.forEach(function (w, id) {
                if (!w.emitted) checkSourceComplete(id, false);
            });
        });
    });
}

function markWarning(text) {
    chrome.storage.local.set({ mailWarning: text || null });
}

function sendActiveClaim() {
    if (!_active) return;
    var m = _active.msg;
    log('claiming message', m.id, '(' + (messageSourceInfo(m) || {}).source + ')');
    window.postMessage({ type: 'COR3_MAIL_CLAIM_ALL', messageId: m.id }, '*');
    if (_active.timer) clearTimeout(_active.timer);
    _active.timer = setTimeout(function () {
        if (!_active) return;
        log('claim timeout for', m.id);
        handleClaimFailure('claim timeout');
    }, CLAIM_TIMEOUT_MS);
}

function pump() {
    if (_active || _fallbackActive || _queue.length === 0) return;
    if (_sorting) return;
    var m = _queue.shift();
    _queuedIds.delete(m.id);
    if (_claimedIds.has(m.id)) { pump(); return; }
    _active = { msg: m, attempts: 0, timer: null };

    chrome.storage.local.get(['stashSorting', 'stashData', 'gameplayData'], function (local) {
        if (stashIsBusy(local)) {
            _sorting = true;
            // Put it back at the front and stop until sorting finishes.
            _queue.unshift(m);
            _queuedIds.add(m.id);
            _active = null;
            return;
        }
        _sorting = false;
        var stash = local ? local.stashData : null;
        var needed = messageCells(m);
        var available = null;
        if (stash && typeof stash.maxCapacity === 'number' && typeof stash.currentUsage === 'number') {
            available = stash.maxCapacity - stash.currentUsage;
        }
        if (available !== null && available < needed) {
            log('not enough stash space: need', needed, 'available', available);
            handleClaimFailure('Insufficient stash capacity', true);
            return;
        }
        sendActiveClaim();
    });
}

function handleClaimFailure(errMsg, capacityOnly) {
    var active = _active;
    if (!active) return;
    if (active.timer) clearTimeout(active.timer);
    _active = null;
    var msgText = String(errMsg || 'unknown error');
    active.attempts = (active.attempts || 0) + 1;

    if (isCapacityError(msgText)) {
        // Never sell or fallback while the sorting table is active.
        chrome.storage.local.get(['stashSorting', 'stashData', 'gameplayData'], function (busyLocal) {
            if (stashIsBusy(busyLocal)) {
                _sorting = true;
                _queue.unshift(active.msg);
                _queuedIds.add(active.msg.id);
                return;
            }
            // First try the exact-placement fallback (stash has enough free cells
            // but claim.all could not find a contiguous spot).
            tryItemFallback(active.msg).then(function (handled) {
                if (handled) return;
                chrome.storage.sync.get('autoSellCheapest', function (sellSettings) {
                    chrome.storage.local.get('stashData', function (local) {
                        var stash = local ? local.stashData : null;
                        if (sellSettings.autoSellCheapest && stash && Array.isArray(stash.items)) {
                            var needed = messageCells(active.msg);
                            var available = (typeof stash.maxCapacity === 'number' && typeof stash.currentUsage === 'number')
                                ? stash.maxCapacity - stash.currentUsage : 0;
                            var shortfall = Math.max(1, needed - available);
                            markWarning('Mailbox: stash full, selling ' + shortfall + ' item(s) to make room…');
                            log('stash full, auto-selling', shortfall, 'item(s)');
                            autoSellCheapestItems(stash.items, shortfall, function () {
                                window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                                setTimeout(function () {
                                    _queue.unshift(active.msg);
                                    _queuedIds.add(active.msg.id);
                                    pump();
                                }, 2000 + shortfall * 1500);
                            });
                            return;
                        }
                        markWarning('Mailbox: stash full. Clear stash space to claim rewards.');
                        log('stash full and auto-sell unavailable — claim abandoned for now');
                        // Try again later when stash data changes.
                        _queue.unshift(active.msg);
                        _queuedIds.add(active.msg.id);
                    });
                });
            });
        });
        return;
    }

    if (!capacityOnly && active.attempts <= MAX_CLAIM_RETRIES) {
        markWarning('Mailbox: claim failed (' + msgText + ') — retrying…');
        var delay = 1500 * active.attempts;
        log('claim failed, retry', active.attempts, '/', MAX_CLAIM_RETRIES, 'in', delay + 'ms');
        setTimeout(function () {
            _queue.unshift(active.msg);
            _queuedIds.add(active.msg.id);
            pump();
        }, delay);
        return;
    }

    markWarning('Mailbox: claim failed: ' + msgText);
    log('claim abandoned:', msgText);
    var info = messageSourceInfo(active.msg);
    if (info) checkSourceComplete(info.sourceId, true, info.source);
}

function onMailUpdate(data) {
    _mailData = data || null;
    _mailUpdatedAt = Date.now();
    chrome.storage.local.set({ mailData: _mailData, mailDataUpdatedAt: _mailUpdatedAt });
    maybeEnqueueAll();
}

function onClaimResult(payload) {
    if (payload && payload.action !== 'claim.all') return;
    if (!_active) {
        // A manual claim, or a late response after a timeout: just refresh.
        if (payload && payload.error) markWarning('Mailbox: ' + (payload.error.message || payload.error));
        return;
    }
    if (payload && payload.error) {
        var em = payload.error.message || JSON.stringify(payload.error);
        log('claim.all error:', em);
        handleClaimFailure(em);
        return;
    }
    var info = messageSourceInfo(_active.msg);
    var claimed = _active.msg;
    if (_active.timer) clearTimeout(_active.timer);
    _active = null;
    _claimedIds.add(claimed.id);
    if (_mailData && Array.isArray(_mailData.messages)) {
        for (var i = 0; i < _mailData.messages.length; i++) {
            if (_mailData.messages[i].id === claimed.id) _mailData.messages[i].status = 'CLAIMED';
        }
    }
    markWarning(null);
    log('claimed message', claimed.id);
    // Give the server a moment to push stash/mail updates before the next claim.
    setTimeout(function () {
        pump();
        if (info) checkSourceComplete(info.sourceId, false, info.source);
    }, CLAIM_GAP_MS);
}

if (isContextValid()) {
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (!isContextValid()) return;
        var data = event.data;
        if (!data) return;

        if (data.type === 'COR3_WS_MAIL') {
            if (data.action === 'update.state') {
                onMailUpdate(data.data);
            } else if (data.action === 'claim.all') {
                onClaimResult(data);
            } else if (data.action === 'claim.item') {
                if (_itemClaimResolver) {
                    var respAttachmentId = data.data && data.data.attachmentId;
                    if (!respAttachmentId || !_itemClaimResolver.attachmentId ||
                        respAttachmentId === _itemClaimResolver.attachmentId) {
                        _itemClaimResolver.finish(data.error
                            ? { ok: false, error: data.error.message || JSON.stringify(data.error) }
                            : { ok: true });
                    }
                }
            }
            return;
        }

        if (data.type === 'COR3_CHECK_MAIL') {
            if (data.forceManual && data.sourceId) {
                _forcedSources.add(data.sourceId);
                _sourceById.set(data.sourceId, data.source || 'DRONE_MISSION');
            }
            watchSource(data.source || 'EXPEDITION', data.sourceId, data.timeoutMs);
            maybeEnqueueAll();
            return;
        }
    });

    // Popup/manual: let the popup ask for a mailbox refresh/claim pass.
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request && request.action === 'claimMailbox') {
            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
            maybeEnqueueAll();
            sendResponse({ success: true });
        }
    });

    // Re-evaluate pending mail when the stash changes (space freed) or sorting ends.
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.stashSorting && changes.stashSorting.newValue === false) {
            setTimeout(maybeEnqueueAll, 1000);
        } else if (changes.stashData) {
            setTimeout(maybeEnqueueAll, 1200);
        }
    });
}

// Expose a small read-only snapshot for debugging from the console.
window.__cor3MailDebug = function () {
    return { pending: _mailData ? _mailData.pendingCount : null, active: _active ? _active.msg.id : null, queue: _queue.length, sorting: _sorting };
};
