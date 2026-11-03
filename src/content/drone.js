// Drone missions (Personal Drone Assembling) — linear automation pipeline.
// Mirrors the mercenary auto-send flow: claim completed -> repair if needed -> launch.
import { isContextValid } from './helpers.js';

let autoDroneInProgress = false;
let autoDroneClaimedMissionId = null;
const autoDroneResolvedEvents = new Set();

// Serialize WS actions: until the server confirms the previous action, do not
// send another repair/launch/claim. This prevents duplicate requests that the
// game rejects with "already in progress" errors.
let _dronePendingAction = null; // { action, at }
const DRONE_PENDING_TIMEOUT_MS = 20000;

function _setDronePending(action) {
    _dronePendingAction = { action: action, at: Date.now() };
}
function _clearDronePending() {
    _dronePendingAction = null;
}
function _droneActionBlocked() {
    if (!_dronePendingAction) return false;
    if (Date.now() - _dronePendingAction.at > DRONE_PENDING_TIMEOUT_MS) {
        _dronePendingAction = null;
        return false;
    }
    return true;
}

function isDroneBusyError(msg) {
    const m = String(msg || '').toLowerCase();
    const keys = [
        'already', 'in progress', 'in-progress', 'processing', 'busy',
        'operation', 'pending', 'cooldown',
        '正在', '已在', '操作中', '进行中', '处理中', '冷却'
    ];
    return keys.some(k => m.indexOf(k) !== -1);
}

let _droneOptionsRefreshTimer = null;
function scheduleDroneOptionsRefresh(delayMs) {
    if (_droneOptionsRefreshTimer) clearTimeout(_droneOptionsRefreshTimer);
    _droneOptionsRefreshTimer = setTimeout(() => {
        _droneOptionsRefreshTimer = null;
        if (!isContextValid()) return;
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    }, delayMs || 1000);
}

// Pick the mission to dispatch: manual selection when autoChooseLocation is off,
// otherwise the cheapest (lowest battery cost) then lowest-risk then shortest mission.
function pickDroneMission(options, cfg) {
    if (!options || !options.locations || options.locations.length === 0) return null;
    if (!cfg.autoChooseLocation) {
        const loc = options.locations.find(l => l.id === cfg.locationConfigId) || options.locations[0];
        if (!loc || !loc.missions || loc.missions.length === 0) return null;
        const mis = loc.missions.find(m => m.id === cfg.missionConfigId) || loc.missions[0];
        return mis ? Object.assign({}, mis, { locationConfigId: loc.id, _risk: loc.baseRisk || 0 }) : null;
    }
    let best = null;
    for (const loc of options.locations) {
        for (const m of (loc.missions || [])) {
            const cand = Object.assign({}, m, { locationConfigId: loc.id, _risk: loc.baseRisk || 0 });
            if (!best) { best = cand; continue; }
            const cCost = cand.batteryCost || 0, bCost = best.batteryCost || 0;
            if (cCost !== bCost) { if (cCost < bCost) best = cand; continue; }
            if (cand._risk !== best._risk) { if (cand._risk < best._risk) best = cand; continue; }
            if ((cand.durationSeconds || 0) < (best.durationSeconds || 0)) best = cand;
        }
    }
    return best;
}

// Auto-drone main loop. Reads fresh droneData (options) + pending completed push.
function checkAutoDrone() {
    if (autoDroneInProgress) return;
    autoDroneInProgress = true;
    const finish = () => { autoDroneInProgress = false; };

    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled) { finish(); return; }
        if (cfg.paused) { finish(); return; }
        if (_droneActionBlocked()) { finish(); return; }

        chrome.storage.local.get(['droneData', 'droneCompleted'], (local) => {
            const options = local.droneData;
            const completed = local.droneCompleted;

            // New mailbox flow: drone loot is delivered directly to the mailbox.
            // Ask the mailbox module to claim messages for this mission; it will
            // emit COR3_MAIL_CLAIMED when the mission's rewards are collected.
            if (options && options.drone && completed && completed.missionId &&
                (Array.isArray(completed.loot) ? completed.loot.some(i => !i.claimed) : true)) {
                if (autoDroneClaimedMissionId !== completed.missionId) {
                    autoDroneClaimedMissionId = completed.missionId;
                    console.log('[COR3 Helper] Auto-drone: claiming completed mission via mailbox', completed.missionId);
                    window.postMessage({ type: 'COR3_CHECK_MAIL', source: 'DRONE_MISSION', sourceId: completed.missionId }, '*');
                }
                finish();
                return;
            }

            if (!options || !options.drone) { finish(); return; }
            const drone = options.drone;

            if (options.activeMissionId) { _clearDronePending(); finish(); return; }
            if (drone.isRepairing) { _clearDronePending(); finish(); return; }
            if (drone.isDestroyed) {
                console.log('[COR3 Helper] Auto-drone: drone destroyed — pausing');
                chrome.storage.sync.set({ autoDrone: Object.assign({}, cfg, { paused: true }) });
                chrome.storage.local.set({ droneWarning: 'Drone is destroyed — auto-drone paused. Repair or replace the drone.' });
                finish();
                return;
            }

            // Repair when durability is at/below threshold, or when battery is low (top-up during downtime)
            if (cfg.repairEnabled) {
                const threshold = typeof cfg.repairThreshold === 'number' ? cfg.repairThreshold : 60;
                const lowBattThreshold = typeof cfg.lowBatteryThreshold === 'number' ? cfg.lowBatteryThreshold : 30;
                const battCur = options.battery && typeof options.battery.current === 'number' ? options.battery.current : 100;
                const needsDurabilityRepair = drone.durability <= threshold;
                const needsLowBatteryRepair = !!cfg.repairOnLowBattery && battCur < lowBattThreshold && drone.durability < drone.maxDurability;
                if (needsDurabilityRepair || needsLowBatteryRepair) {
                    console.log('[COR3 Helper] Auto-drone: repairing (durability', drone.durability, ', battery', battCur + ')');
                    _setDronePending('repair');
                    window.postMessage({ type: 'COR3_REPAIR_DRONE', targetDurability: 100 }, '*');
                    finish();
                    return;
                }
            }

            // Launch when battery is sufficient
            const mission = pickDroneMission(options, cfg);
            if (!mission) {
                console.log('[COR3 Helper] Auto-drone: no mission available');
                finish();
                return;
            }
            const batt = options.battery;
            if (batt && typeof batt.current === 'number' && batt.current < (mission.batteryCost || 0)) {
                console.log('[COR3 Helper] Auto-drone: battery', batt.current, '< cost', mission.batteryCost, '— waiting for recharge');
                finish();
                return;
            }
            if (cfg.fullChargeBeforeLaunch && batt && typeof batt.current === 'number' && typeof batt.max === 'number' && batt.current < batt.max) {
                console.log('[COR3 Helper] Auto-drone: waiting for full charge (', batt.current, '/', batt.max, ')');
                finish();
                return;
            }
            console.log('[COR3 Helper] Auto-drone: launching mission', mission.name, '(' + mission.locationConfigId + ')');
            _setDronePending('launch');
            window.postMessage({ type: 'COR3_LAUNCH_DRONE', locationConfigId: mission.locationConfigId, missionConfigId: mission.id }, '*');
            finish();
        });
    });
}

// Auto-resolve in-mission DECISION/HAZARD events (reward loot, penalize risk;
// avoid options that require a module we may not have).
function checkAutoDroneDecide(eventData) {
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled || !cfg.autoDecide) return;
        const ev = eventData && eventData.event;
        if (!ev || !ev.isResolvable || ev.isResolved) return;
        if (!Array.isArray(ev.options) || ev.options.length === 0) return;
        if (autoDroneResolvedEvents.has(ev.eventId)) return;

        let best = null;
        for (const opt of ev.options) {
            if (!best) { best = opt; continue; }
            const r = (opt.effect && opt.effect.riskDelta) || 0;
            const l = (opt.effect && opt.effect.lootDelta) || 0;
            const br = (best.effect && best.effect.riskDelta) || 0;
            const bl = (best.effect && best.effect.lootDelta) || 0;
            const score = l * 3 - r * 2;
            const bScore = bl * 3 - br * 2;
            if (score !== bScore) { if (score > bScore) best = opt; continue; }
            if (!opt.requiredModuleId && best.requiredModuleId) best = opt;
        }
        if (!best) return;
        autoDroneResolvedEvents.add(ev.eventId);
        console.log('[COR3 Helper] Auto-drone: resolving event', ev.type, '->', best.label);
        window.postMessage({ type: 'COR3_RESOLVE_DRONE_EVENT', missionId: eventData.missionId, eventId: ev.eventId, optionId: best.id }, '*');
    });
}

// Rate-limit ("Too many requests") handling: retry with backoff, then disable.
let _droneRateLimitRetries = 0;
const DRONE_RATE_LIMIT_MAX_RETRIES = 3;
const DRONE_RATE_LIMIT_DELAYS_MS = [20000, 40000, 60000];

function isDroneRateLimited(msg) {
    const m = (msg || '').toLowerCase();
    return m.indexOf('too many requests') !== -1 || m.indexOf('rate limit') !== -1 || m.indexOf('rate-limited') !== -1;
}

function handleDroneRateLimited(action, msg) {
    _droneRateLimitRetries++;
    if (_droneRateLimitRetries <= DRONE_RATE_LIMIT_MAX_RETRIES) {
        const delayMs = DRONE_RATE_LIMIT_DELAYS_MS[Math.min(_droneRateLimitRetries - 1, DRONE_RATE_LIMIT_DELAYS_MS.length - 1)];
        const secs = Math.round(delayMs / 1000);
        console.log('[COR3 Helper] Auto-drone: rate limited (' + action + ') — retry ' + _droneRateLimitRetries + '/' + DRONE_RATE_LIMIT_MAX_RETRIES + ' in ' + secs + 's');
        chrome.storage.local.set({ droneWarning: 'Rate limited — retrying in ' + secs + 's (' + _droneRateLimitRetries + '/' + DRONE_RATE_LIMIT_MAX_RETRIES + ')' });
        setTimeout(() => {
            if (!isContextValid()) return;
            window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        }, delayMs);
    } else {
        _droneRateLimitRetries = 0;
        console.log('[COR3 Helper] Auto-drone: rate limited after ' + DRONE_RATE_LIMIT_MAX_RETRIES + ' retries — disabling auto-dispatch');
        chrome.storage.local.set({ droneWarning: 'Rate limited — auto-dispatch disabled after ' + DRONE_RATE_LIMIT_MAX_RETRIES + ' retries. Re-enable to resume.' });
        chrome.storage.sync.get('autoDrone', (settings) => {
            chrome.storage.sync.set({ autoDrone: Object.assign({}, settings.autoDrone || {}, { enabled: false }) });
        });
    }
}

function handleDroneError(action, error) {
    const msg = error && (error.message || JSON.stringify(error)) || 'unknown error';
    console.log('[COR3 Helper] Auto-drone error (' + action + '):', msg);
    _clearDronePending();

    if (isDroneRateLimited(msg)) {
        handleDroneRateLimited(action, msg);
        return;
    }

    // "Already in progress" / "operation pending" is a transient state, not a
    // real failure. Never pause the automation for it — just re-check shortly.
    if (isDroneBusyError(msg)) {
        console.log('[COR3 Helper] Auto-drone: transient busy error — will retry');
        chrome.storage.local.set({ droneWarning: 'Drone ' + action + ' deferred (' + msg + ') — retrying…' });
        scheduleDroneOptionsRefresh(2500 + Math.floor(Math.random() * 1500));
        return;
    }

    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (action === 'repair') {
            chrome.storage.local.set({ droneWarning: 'Drone repair failed: ' + msg });
            if (cfg.pauseOnRepairFail !== false) {
                console.log('[COR3 Helper] Auto-drone: pausing after repair failure');
                chrome.storage.sync.set({ autoDrone: Object.assign({}, cfg, { paused: true }) });
            }
        } else if (action === 'claim') {
            autoDroneClaimedMissionId = null;
            chrome.storage.local.set({ droneWarning: 'Drone claim failed: ' + msg });
        } else {
            chrome.storage.local.set({ droneWarning: 'Drone ' + action + ' failed: ' + msg });
        }
    });
}

// --- Relay inbound drone events to storage + drive the state machine ---
window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!isContextValid()) return;
    const now = Date.now();
    const type = event.data && event.data.type;

    if (type === 'COR3_WS_DRONE_OPTIONS') {
        _droneRateLimitRetries = 0;
        _clearDronePending();
        chrome.storage.local.set({ droneData: event.data.data, droneDataUpdatedAt: now });
        checkAutoDrone();
    } else if (type === 'COR3_WS_DRONE_MISSION') {
        _clearDronePending();
        chrome.storage.local.set({ droneMissionData: event.data.data, droneMissionUpdatedAt: now });
        scheduleDroneOptionsRefresh(2000);
    } else if (type === 'COR3_WS_DRONE_UPDATE') {
        // { droneId, durability, repaired } push after repair/durability changes.
        const upd = event.data.data || {};
        chrome.storage.local.get('droneData', (local) => {
            const options = local.droneData;
            if (options && options.drone) {
                if (typeof upd.durability === 'number') options.drone.durability = upd.durability;
                if (upd.repaired) options.drone.isRepairing = false;
                chrome.storage.local.set({ droneData: options, droneDataUpdatedAt: now });
            }
            _clearDronePending();
            scheduleDroneOptionsRefresh(1500);
        });
    } else if (type === 'COR3_WS_DRONE_LAUNCHED') {
        console.log('[COR3 Helper] Auto-drone: mission launched');
        _clearDronePending();
        chrome.storage.local.remove('droneCompleted');
        autoDroneClaimedMissionId = null;
    } else if (type === 'COR3_WS_DRONE_CLAIMED') {
        console.log('[COR3 Helper] Auto-drone: mission claimed');
        _clearDronePending();
        chrome.storage.local.remove('droneCompleted');
        scheduleDroneOptionsRefresh(1500);
    } else if (type === 'COR3_WS_DRONE_COMPLETED') {
        const completedData = event.data.data || {};
        chrome.storage.local.set({ droneCompleted: completedData, droneCompletedUpdatedAt: now });
        // Loot is in the mailbox in the new flow; ask the mailbox module to claim it.
        if (completedData.missionId) {
            window.postMessage({ type: 'COR3_CHECK_MAIL', source: 'DRONE_MISSION', sourceId: completedData.missionId }, '*');
        }
        checkAutoDrone();
    } else if (type === 'COR3_MAIL_CLAIMED' && event.data.source === 'DRONE_MISSION') {
        console.log('[COR3 Helper] Auto-drone: mailbox rewards claimed for', event.data.sourceId);
        _clearDronePending();
        chrome.storage.local.get('droneCompleted', (local) => {
            const completed = local.droneCompleted;
            // Ignore claims for older drone missions; only clear the current one.
            if (!completed || !completed.missionId || completed.missionId === event.data.sourceId) {
                chrome.storage.local.remove('droneCompleted');
                autoDroneClaimedMissionId = null;
            }
            scheduleDroneOptionsRefresh(1500);
        });
    } else if (type === 'COR3_WS_DRONE_EVENT') {
        checkAutoDroneDecide(event.data.data);
    } else if (type === 'COR3_WS_DRONE_REPAIR') {
        console.log('[COR3 Helper] Auto-drone: repair started');
    } else if (type === 'COR3_WS_DRONE_ARCHIVED') {
        const arcData = event.data.data || {};
        const items = Array.isArray(arcData.items) ? arcData.items : [];
        chrome.storage.local.get('droneArchivedData', (prev) => {
            let mergedItems = items;
            if (prev.droneArchivedData && Array.isArray(prev.droneArchivedData.items) && prev.droneArchivedData.items.length > 0) {
                const seen = new Set(prev.droneArchivedData.items.map(i => i.id));
                mergedItems = prev.droneArchivedData.items.concat(items.filter(i => !seen.has(i.id)));
            }
            chrome.storage.local.set({
                droneArchivedData: Object.assign({}, arcData, { items: mergedItems }),
                droneArchivedUpdatedAt: now
            });
        });
    } else if (type === 'COR3_WS_DRONE_ERROR') {
        handleDroneError(event.data.action, event.data.error);
    }
});

// --- Runtime actions from the popup ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'requestDroneOptions') {
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'launchDrone') {
        window.postMessage({ type: 'COR3_LAUNCH_DRONE', locationConfigId: request.locationConfigId, missionConfigId: request.missionConfigId }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'claimDrone') {
        // Rewards now arrive in the mailbox; claim the matching message even if
        // auto-drone is currently disabled.
        window.postMessage({ type: 'COR3_CHECK_MAIL', source: 'DRONE_MISSION', sourceId: request.missionId, forceManual: true }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'repairDrone') {
        window.postMessage({ type: 'COR3_REPAIR_DRONE', targetDurability: request.targetDurability }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'resolveDroneEvent') {
        window.postMessage({ type: 'COR3_RESOLVE_DRONE_EVENT', missionId: request.missionId, eventId: request.eventId, optionId: request.optionId }, '*');
        sendResponse({ success: true });
    } else if (request.action === 'requestDroneArchived') {
        window.postMessage({ type: 'COR3_REQUEST_DRONE_ARCHIVED', cursor: request.cursor || null, limit: request.limit || 20 }, '*');
        sendResponse({ success: true });
    }
});

// --- Light polling: catch battery recharge / repair completion even with popup closed ---
setInterval(() => {
    if (!isContextValid()) return;
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (!cfg.enabled || cfg.paused) return;
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    });
}, 60000);

// Trigger when the toggle changes (enable / re-enable / unpause)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.autoDrone) return;
    const newVal = changes.autoDrone.newValue;
    if (newVal && newVal.enabled && !newVal.paused) {
        console.log('[COR3 Helper] Auto-drone enabled — checking drone state');
        window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
    }
});

// Page load: if auto-drone was enabled, kick off a state check after WS connects
setTimeout(() => {
    chrome.storage.sync.get('autoDrone', (settings) => {
        const cfg = settings.autoDrone || {};
        if (cfg.enabled && !cfg.paused) {
            console.log('[COR3 Helper] Page load: auto-drone enabled — requesting options');
            window.postMessage({ type: 'COR3_REQUEST_DRONE_OPTIONS' }, '*');
        }
    });
}, 6000);
