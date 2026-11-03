// Warehouse grid sorter.
//
// The game changed the stash from a flat item list to a 12-wide grid where every
// item has a W x H footprint. `stash move.item` moves an item inside the grid or
// to/from the sorting table:
//
//   42["event",{"event":{"name":"stash","action":"move.item"},"data":{
//       "itemId":"...","location":"stash"|"sorting_table","x":0,"y":0,"rotated":false
//   }}]
//
// Sorting is fully server-driven: every move is a round-trip, so it is slow.
// While the sorting table is in use the server sets gameplayBlockReason to
// 'stash-sorting'. Mailbox auto-claim is paused via the `stashSorting` storage
// flag, which content/mail.js checks before each claim.
//
// Two layouts are supported:
//   - default:    rarity (QUEST > LEGENDARY > EPIC > SUPERRARE > RARE > COMMON),
//                 then name; row-major first-fit packing.
//   - horizontal: same ordering, but every distinct item type starts a new row
//                 band; copies of the same type fill the band left-to-right and
//                 wrap down inside that band.
import { isContextValid } from './helpers.js';

const RARITY_ORDER = {
    QUEST: 0,
    LEGENDARY: 1,
    EPIC: 2,
    SUPERRARE: 3,
    RARE: 4,
    COMMON: 5
};

const MOVE_TIMEOUT_MS = 9000;
const MOVE_GAP_MS = 220;
const PROGRESS_KEY = 'stashSortProgress';

let _sorting = false;

function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[COR3 Helper] StashSort:');
    console.log.apply(console, args);
}

function setProgress(p) {
    chrome.storage.local.set({ [PROGRESS_KEY]: p });
}

function finishProgress(p) {
    p.finishedAt = Date.now();
    chrome.storage.local.set({ [PROGRESS_KEY]: p, stashSorting: false });
}

function rarityRank(tier) {
    return RARITY_ORDER[String(tier || 'COMMON').toUpperCase()] ?? 6;
}

function compareItems(a, b) {
    const ra = rarityRank(a.tier);
    const rb = rarityRank(b.tier);
    if (ra !== rb) return ra - rb;
    const na = String(a.name || a.shortName || '');
    const nb = String(b.name || b.shortName || '');
    const byName = na.localeCompare(nb, undefined, { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return String(a.id || '').localeCompare(String(b.id || ''));
}

function baseDims(item) {
    let w = Math.max(1, Number(item.width) || 1);
    let h = Math.max(1, Number(item.height) || 1);
    if (item.rotated) {
        const t = w; w = h; h = t;
    }
    return { w: w, h: h };
}

function dimsForRotation(item, rotated) {
    const b = baseDims(item);
    return rotated ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
}

function makeGrid(w, h) {
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(new Array(w).fill(null));
    return rows;
}

function canPlace(grid, x, y, w, h, gw, gh) {
    if (x < 0 || y < 0 || x + w > gw || y + h > gh) return false;
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            if (grid[yy][xx] !== null) return false;
        }
    }
    return true;
}

function place(grid, x, y, w, h, id) {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) grid[yy][xx] = id;
    }
}

function clearRect(grid, x, y, w, h, id) {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            if (grid[yy] && grid[yy][xx] === id) grid[yy][xx] = null;
        }
    }
}

function layoutDefault(items, gw, gh) {
    const grid = makeGrid(gw, gh);
    const result = [];
    const sorted = items.slice().sort(compareItems);

    for (const item of sorted) {
        const b = baseDims(item);
        let placement = null;
        // Prefer unrotated, then rotated if needed.
        for (let y = 0; y <= gh - b.h && !placement; y++) {
            for (let x = 0; x <= gw - b.w; x++) {
                if (canPlace(grid, x, y, b.w, b.h, gw, gh)) {
                    placement = { x: x, y: y, w: b.w, h: b.h, rotated: false };
                    break;
                }
            }
        }
        if (!placement && item.canRotate && b.w !== b.h) {
            const rw = b.h, rh = b.w;
            for (let y = 0; y <= gh - rh && !placement; y++) {
                for (let x = 0; x <= gw - rw; x++) {
                    if (canPlace(grid, x, y, rw, rh, gw, gh)) {
                        placement = { x: x, y: y, w: rw, h: rh, rotated: true };
                        break;
                    }
                }
            }
        }
        if (!placement) {
            return { ok: false, reason: 'Not enough warehouse rows for the default layout (item: ' + (item.name || item.id) + ').' };
        }
        place(grid, placement.x, placement.y, placement.w, placement.h, item.id);
        result.push({ id: item.id, x: placement.x, y: placement.y, w: placement.w, h: placement.h, rotated: placement.rotated });
    }
    return { ok: true, items: result };
}

function layoutHorizontal(items, gw, gh) {
    // Group identical item types together.
    const groups = new Map();
    for (const item of items) {
        const key = item.itemConfigId || ((item.name || '') + '|' + (item.tier || ''));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    const orderedGroups = Array.from(groups.values()).sort((a, b) => compareItems(a[0], b[0]));

    const result = [];
    let y = 0;

    for (const group of orderedGroups) {
        group.sort(compareItems);
        let x = 0;
        let rowH = 0;

        for (const item of group) {
            const b = baseDims(item);
            let w = b.w, h = b.h, rotated = false;
            if (w > gw) {
                if (!item.canRotate) {
                    return { ok: false, reason: 'Item "' + (item.name || item.id) + '" is wider than the warehouse grid.' };
                }
                w = b.h; h = b.w; rotated = true;
                if (w > gw) {
                    return { ok: false, reason: 'Item "' + (item.name || item.id) + '" cannot fit in the warehouse grid.' };
                }
            }
            // Wrap inside this item type's band.
            if (x + w > gw) {
                y += rowH;
                x = 0;
                rowH = 0;
            }
            if (y + h > gh) {
                return { ok: false, reason: 'Not enough warehouse rows for the horizontal layout. Required more than ' + gh + ' rows.' };
            }
            result.push({ id: item.id, x: x, y: y, w: w, h: h, rotated: rotated });
            x += w;
            if (h > rowH) rowH = h;
        }
        // Next item type always starts on a fresh row band.
        y += rowH;
        if (y > gh) {
            return { ok: false, reason: 'Not enough warehouse rows for the horizontal layout. Required ' + y + ' rows, available ' + gh + '.' };
        }
    }

    return { ok: true, items: result };
}

function computeMoves(stash, layoutItems) {
    const gw = Number(stash.gridWidth) || 12;
    const gh = Number(stash.usableRows) || 60;
    const stWidth = (stash.sortingTable && Number(stash.sortingTable.width)) || 15;

    const items = (stash.items || []).filter(it => it && it.id && (!it.location || it.location === 'stash'));
    const itemById = new Map(items.map(it => [it.id, it]));
    const targetById = new Map(layoutItems.map(t => [t.id, t]));

    const grid = makeGrid(gw, gh);
    const cur = new Map();
    for (const it of items) {
        if (!targetById.has(it.id)) continue;
        const w = Number(it.width) || 1;
        const h = Number(it.height) || 1;
        const x = Number(it.x) || 0;
        const y = Number(it.y) || 0;
        cur.set(it.id, { x: x, y: y, w: w, h: h, rotated: !!it.rotated, location: 'stash' });
        place(grid, x, y, w, h, it.id);
    }

    const placed = new Set();
    for (const it of items) {
        const t = targetById.get(it.id);
        if (!t) continue;
        if (it.x === t.x && it.y === t.y && !!it.rotated === !!t.rotated) placed.add(it.id);
    }

    const staged = new Map(); // id -> { target, original }
    const stagedEver = new Map(); // id -> { id, original } for rollback
    const staging = { x: 0, y: 0, rowH: 0 };
    const moves = [];

    function nextStagingPosition(item) {
        let b = baseDims(item);
        let w = b.w, h = b.h, rotated = false;
        if (w > stWidth && item.canRotate) {
            w = b.h; h = b.w; rotated = true;
        }
        if (w > stWidth) throw new Error('Item "' + (item.name || item.id) + '" is too wide for the sorting table.');
        if (staging.x + w > stWidth) {
            staging.y += staging.rowH;
            staging.x = 0;
            staging.rowH = 0;
        }
        const pos = { x: staging.x, y: staging.y, rotated: rotated };
        staging.x += w;
        if (h > staging.rowH) staging.rowH = h;
        return pos;
    }

    function stageBlockers(t, selfId) {
        const blockers = new Set();
        for (let yy = t.y; yy < t.y + t.h; yy++) {
            for (let xx = t.x; xx < t.x + t.w; xx++) {
                const occ = grid[yy] ? grid[yy][xx] : null;
                if (occ && occ !== selfId) blockers.add(occ);
            }
        }
        for (const blockerId of blockers) {
            if (placed.has(blockerId)) {
                const selfItem = itemById.get(selfId);
                return 'Layout conflict: a placed item blocks ' + (selfItem ? (selfItem.name || selfItem.id) : selfId) + '.';
            }
            if (staged.has(blockerId)) continue;
            const blocker = itemById.get(blockerId);
            if (!blocker) continue;
            const pos = nextStagingPosition(blocker);
            moves.push({ itemId: blockerId, location: 'sorting_table', x: pos.x, y: pos.y, rotated: pos.rotated });
            const c = cur.get(blockerId);
            if (c) {
                clearRect(grid, c.x, c.y, c.w, c.h, blockerId);
                c.location = 'sorting_table';
            }
            staged.set(blockerId, {
                target: targetById.get(blockerId),
                original: { x: blocker.x, y: blocker.y, rotated: !!blocker.rotated }
            });
            stagedEver.set(blockerId, {
                id: blockerId,
                original: { x: blocker.x, y: blocker.y, rotated: !!blocker.rotated }
            });
        }
        return null;
    }

    for (const t of layoutItems) {
        const it = itemById.get(t.id);
        if (!it) continue;
        const isStaged = staged.has(it.id);
        if (!isStaged && placed.has(it.id)) continue;

        // Free the target rectangle first — this also applies to items that are
        // currently parked in the sorting table.
        const stageErr = stageBlockers(t, it.id);
        if (stageErr) return { ok: false, reason: stageErr };

        if (isStaged) staged.delete(it.id);

        const c = cur.get(it.id);
        if (c && c.location === 'stash') {
            clearRect(grid, c.x, c.y, c.w, c.h, it.id);
        }
        moves.push({ itemId: it.id, location: 'stash', x: t.x, y: t.y, rotated: t.rotated });
        place(grid, t.x, t.y, t.w, t.h, it.id);
        cur.set(it.id, { x: t.x, y: t.y, w: t.w, h: t.h, rotated: !!t.rotated, location: 'stash' });
        placed.add(it.id);
    }

    // Anything still parked should be placed now (normally empty).
    for (const [id, s] of Array.from(staged.entries())) {
        const t = s.target;
        if (!t) continue;
        moves.push({ itemId: id, location: 'stash', x: t.x, y: t.y, rotated: t.rotated });
        staged.delete(id);
    }

    return { ok: true, moves: moves, stagedEver: Array.from(stagedEver.values()) };
}

function sendMove(move) {
    return new Promise((resolve) => {
        let done = false;
        function cleanup() {
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
        }
        function finish(res) {
            if (done) return;
            done = true;
            cleanup();
            resolve(res);
        }
        function onMessage(evt) {
            if (evt.source !== window) return;
            const d = evt.data;
            if (!d || d.type !== 'COR3_WS_STASH_MOVE') return;
            if (d.error) {
                finish({ ok: false, error: d.error.message || JSON.stringify(d.error) });
            } else {
                finish({ ok: true, data: d.data });
            }
        }
        window.addEventListener('message', onMessage);
        const timer = setTimeout(() => finish({ ok: false, error: 'move.item timeout' }), MOVE_TIMEOUT_MS);
        window.postMessage({
            type: 'COR3_STASH_MOVE_ITEM',
            itemId: move.itemId,
            location: move.location,
            x: move.x,
            y: move.y,
            rotated: !!move.rotated
        }, '*');
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function executeMoves(mode, moves, stagedEver) {
    const total = moves.length;
    const inTable = new Set();
    const originalById = new Map((stagedEver || []).map(s => [s.id, s.original]));
    setProgress({ mode: mode, phase: 'moving', done: 0, total: total, text: 'Moving 0/' + total, startedAt: Date.now() });

    for (let i = 0; i < total; i++) {
        if (!isContextValid()) return { ok: false, error: 'context invalidated' };
        const move = moves[i];
        setProgress({ mode: mode, phase: 'moving', done: i, total: total, text: 'Moving ' + (i + 1) + '/' + total, startedAt: Date.now() });
        const res = await sendMove(move);
        if (!res.ok) {
            // Best-effort rollback: return anything still parked in the sorting
            // table to its original cell. Items already moved to a target are
            // left in place (they are at least in the stash grid).
            for (const id of Array.from(inTable)) {
                const orig = originalById.get(id);
                if (!orig) continue;
                await sendMove({
                    itemId: id,
                    location: 'stash',
                    x: orig.x,
                    y: orig.y,
                    rotated: orig.rotated
                }).catch(() => {});
            }
            return { ok: false, error: res.error };
        }
        if (move.location === 'sorting_table') inTable.add(move.itemId);
        else inTable.delete(move.itemId);
        if (MOVE_GAP_MS > 0) await sleep(MOVE_GAP_MS);
    }
    return { ok: true };
}

async function startStashSort(mode) {
    if (_sorting) return { ok: false, error: 'A sort is already running.' };

    const local = await new Promise(r => chrome.storage.local.get(['stashData', 'stashSorting'], r));
    if (local && local.stashSorting) return { ok: false, error: 'A sort is already running.' };
    const stash = local ? local.stashData : null;
    if (!stash || !Array.isArray(stash.items)) {
        return { ok: false, error: 'No stash data yet — refresh the inventory first.' };
    }
    if (stash.sortingTable && Array.isArray(stash.sortingTable.items) && stash.sortingTable.items.length > 0) {
        return { ok: false, error: 'The sorting table is not empty. Close the warehouse window to return those items first.' };
    }

    const gw = Number(stash.gridWidth) || 12;
    const gh = Number(stash.usableRows) || 60;
    const items = stash.items.filter(it => it && it.id && (!it.location || it.location === 'stash'));
    if (items.length === 0) return { ok: false, error: 'No items to sort.' };

    _sorting = true;
    chrome.storage.local.set({ stashSorting: true });
    setProgress({ mode: mode, phase: 'planning', done: 0, total: 0, text: 'Planning layout…', startedAt: Date.now() });

    try {
        const layout = mode === 'horizontal'
            ? layoutHorizontal(items, gw, gh)
            : layoutDefault(items, gw, gh);
        if (!layout.ok) {
            log('layout rejected:', layout.reason);
            finishProgress({ mode: mode, phase: 'error', done: 0, total: 0, text: layout.reason, error: layout.reason, startedAt: Date.now() });
            _sorting = false;
            return layout;
        }

        const plan = computeMoves(stash, layout.items);
        if (!plan.ok) {
            finishProgress({ mode: mode, phase: 'error', done: 0, total: 0, text: plan.reason, error: plan.reason, startedAt: Date.now() });
            _sorting = false;
            return plan;
        }

        if (plan.moves.length === 0) {
            finishProgress({ mode: mode, phase: 'done', done: 0, total: 0, text: 'Warehouse is already sorted.', startedAt: Date.now() });
            _sorting = false;
            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
            return { ok: true, moves: 0 };
        }

        log('plans', plan.moves.length, 'move(s) for', mode, 'layout');
        // Execute in the background so the popup gets an immediate response.
        // Progress/completion is published through storage.
        executeMoves(mode, plan.moves, plan.stagedEver).then((result) => {
            _sorting = false;
            if (!result.ok) {
                finishProgress({ mode: mode, phase: 'error', done: 0, total: plan.moves.length, text: 'Sorting failed: ' + result.error, error: result.error, startedAt: Date.now() });
                log('sort failed:', result.error);
            } else {
                finishProgress({ mode: mode, phase: 'done', done: plan.moves.length, total: plan.moves.length, text: 'Sorted ' + items.length + ' item(s) in ' + plan.moves.length + ' move(s).', startedAt: Date.now() });
                log('sort complete');
            }
            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
        }).catch((e) => {
            _sorting = false;
            const msg = e && e.message ? e.message : String(e);
            finishProgress({ mode: mode, phase: 'error', done: 0, total: plan.moves.length, text: 'Sorting failed: ' + msg, error: msg, startedAt: Date.now() });
            log('sort exception:', msg);
            window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
        });
        return { ok: true, moves: plan.moves.length };
    } catch (e) {
        _sorting = false;
        const msg = e && e.message ? e.message : String(e);
        finishProgress({ mode: mode, phase: 'error', done: 0, total: 0, text: 'Sorting failed: ' + msg, error: msg, startedAt: Date.now() });
        log('sort exception:', msg);
        window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
        return { ok: false, error: msg };
    }
}

if (isContextValid()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'sortStash') {
            const mode = request.mode === 'horizontal' ? 'horizontal' : 'default';
            startStashSort(mode).then((res) => {
                try { sendResponse(res); } catch (e) { /* popup closed */ }
            });
            return true; // async response
        }
    });
}

window.__cor3StartStashSort = function (mode) {
    return startStashSort(mode === 'horizontal' ? 'horizontal' : 'default');
};
