// WS message relay from content-early.js (MAIN world) → chrome.storage
// This is the first window message listener in content.js

import { isContextValid, _automationFinish, _broadcastQueueStatus, getAutomationActive, setAutomationActive } from './helpers.js';
import { checkAutoChooseFromContent } from './auto-choose.js';
import {
    checkAutoSendOnExpeditionData, proceedWithMerc, onExpeditionCollected,
    autoSendInProgress, autoSendExpeditionId, autoSendAwaitingMercenaries,
    autoSendAwaitingUsolMercs, autoSendExpeditionBlocked,
    _autoSendUsolSkipped, _autoSendMercRetryCount, MAX_MERC_RETRIES,
    isTransientBusyMessage,
    setAutoSendInProgress, setAutoSendExpeditionId, setAutoSendAwaitingMercenaries,
    setAutoSendAwaitingUsolMercs, setAutoSendExpeditionBlocked,
    setAutoSendUsolSkipped, setAutoSendMercRetryCount, setInitialMercsReady
} from './auto-send.js';
import { setMarketRefreshInProgress, setAutoUpdateMarketsLastRefresh, setSeqRefreshRunning } from './auto-update-markets.js';
import { handleDailyHackRunFinished } from './message-listener.js';

let _containerOpenRetries = 0;

const DAILY_HACK_DIAG_MAX = 200;
let dailyHackDiagnostics = [];
chrome.storage.local.get('dailyHackDiagnostics', (data) => {
    if (dailyHackDiagnostics.length === 0 && Array.isArray(data.dailyHackDiagnostics)) {
        dailyHackDiagnostics = data.dailyHackDiagnostics.slice(-DAILY_HACK_DIAG_MAX);
    }
});

function recordDailyHackDiagnostic(entry) {
    dailyHackDiagnostics.push(entry);
    if (dailyHackDiagnostics.length > DAILY_HACK_DIAG_MAX) {
        dailyHackDiagnostics.splice(0, dailyHackDiagnostics.length - DAILY_HACK_DIAG_MAX);
    }
    chrome.storage.local.set({
        dailyHackDiagnostics,
        dailyHackLog: entry.message || '',
        dailyHackLogUpdatedAt: entry.ts || Date.now()
    });
}

function fetchDailyRewards(token) {
    fetch('https://svc-corie.cor3.gg/api/user-daily-claim/rewards', {
        headers: { 'Authorization': token }
    })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
        if (data && Array.isArray(data)) {
            chrome.storage.local.set({ dailyRewardsData: data });
        }
    })
    .catch(() => {});
}

export function setupWsRelay() {
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!isContextValid()) return;
        const now = Date.now();

        // WS message logging
        if (event.data && event.data.type === 'COR3_WS_LOG') {
            cor3LogWsMessage(event.data.direction, event.data.message);
        }

        if (event.data && event.data.type === 'COR3_WS_EXPEDITIONS') {
            chrome.storage.local.set({ expeditionsData: event.data.expeditions, expeditionsDataUpdatedAt: now });
            var exps = event.data.expeditions || [];
            var hasActive = exps.some(function (e) { return e.status === 'IN_PROGRESS'; });
            if (!hasActive) {
                chrome.storage.local.get('expeditionLaunchError', function (result) {
                    if (result.expeditionLaunchError && !result.expeditionLaunchError.noRetry) {
                        console.log('[COR3 Helper] No active expeditions — clearing expedition launch error');
                        chrome.storage.local.remove('expeditionLaunchError');
                    }
                });
            }
            checkAutoSendOnExpeditionData(event.data.expeditions);
        }
        if (event.data && event.data.type === 'COR3_WS_DECISIONS') {
            chrome.storage.local.set({ expeditionDecisions: event.data.decisions });
            checkAutoChooseFromContent(event.data.decisions);
        }
        if (event.data && event.data.type === 'COR3_WS_SPECIALISTS') {
            chrome.storage.local.set({ specialistsData: event.data.data, specialistsDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_STASH') {
            chrome.storage.local.set({ stashData: event.data.stash, stashDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_MARKET') {
            chrome.storage.local.set({ marketData: event.data.market, marketDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_DARK_MARKET') {
            chrome.storage.local.set({ darkMarketData: event.data.market, darkMarketAvailable: true, darkMarketDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_SOYUZ_MARKET') {
            chrome.storage.local.set({ soyuzMarketData: event.data.market, soyuzMarketAvailable: true, soyuzMarketDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_USOL_MARKET') {
            chrome.storage.local.set({ usolMarketData: event.data.market, usolMarketAvailable: true, usolMarketDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_LOADOUT') {
            chrome.storage.local.set({ loadoutData: event.data.loadout, loadoutAction: event.data.action, loadoutUpdatedAt: now, loadoutError: null });
        }
        if (event.data && event.data.type === 'COR3_WS_LOADOUT_ERROR') {
            chrome.storage.local.set({ loadoutError: event.data.error, loadoutErrorAction: event.data.action, loadoutUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_DARK_MARKET_UNREACHABLE') {
            chrome.storage.local.set({ darkMarketAvailable: false, darkMarketDataUpdatedAt: now, darkMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, darkMarketBlockerServer: event.data.blockerServerName || null });
        }
        if (event.data && event.data.type === 'COR3_WS_SOYUZ_MARKET_UNREACHABLE') {
            chrome.storage.local.set({ soyuzMarketAvailable: false, soyuzMarketDataUpdatedAt: now, soyuzMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, soyuzMarketBlockerServer: event.data.blockerServerName || null });
        }
        if (event.data && event.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
            chrome.storage.local.set({ usolMarketAvailable: false, usolMarketDataUpdatedAt: now, usolMarketMaintenanceEndsAt: event.data.maintenanceEndsAt || null, usolMarketBlockerServer: event.data.blockerServerName || null });
        }
        if (event.data && event.data.type === 'COR3_BEARER_TOKEN') {
            chrome.storage.local.get('bearerToken', (prev) => {
                const isNew = !prev.bearerToken || prev.bearerToken !== event.data.token;
                chrome.storage.local.set({ bearerToken: event.data.token });
                if (isNew) {
                    fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                        headers: { 'Authorization': event.data.token }
                    })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => { if (data) chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now(), dailyOpsError: null }); })
                    .catch(() => {});
                }
            });
        }
        if (event.data && event.data.type === 'COR3_WEB_VERSION') {
            chrome.storage.local.set({ webVersion: event.data.version });
        }
        if (event.data && event.data.type === 'COR3_SYSTEM_VERSION') {
            chrome.storage.local.set({ systemVersion: event.data.version });
        }
        if (event.data && event.data.type === 'COR3_PATCH_VERSION') {
            chrome.storage.local.set({ patchVersion: event.data.version });
        }
        if (event.data && event.data.type === 'COR3_DAILY_REWARDS') {
            chrome.storage.local.set({ dailyRewardsData: event.data.rewards });
        }
        if (event.data && event.data.type === 'COR3_WS_ARCHIVED_EXPEDITIONS') {
            chrome.storage.local.set({ archivedExpeditionsData: event.data.data, archivedExpeditionsUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_MERCENARIES') {
            chrome.storage.local.set({ mercenariesData: event.data.data, mercenariesUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE') {
            chrome.storage.local.set({ coreMercsDone: Date.now() });
        }
        if (event.data && event.data.type === 'COR3_USOL_MERCS_DONE') {
            chrome.storage.local.set({ usolMercsDone: Date.now() });
            setInitialMercsReady(true);
        }
        if (event.data && event.data.type === 'COR3_WS_USOL_MERCENARIES') {
            chrome.storage.local.set({ usolMercenariesData: event.data.data, usolMercenariesUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_MERC_CONFIGURE' && event.data.mercenaryId) {
            chrome.storage.local.get('mercConfigData', (result) => {
                const configs = result.mercConfigData || {};
                configs[event.data.mercenaryId] = event.data.data;
                chrome.storage.local.set({ mercConfigData: configs, mercConfigUpdatedAt: now });
            });
        }
        // Auto-send Phase 1: CORE mercs done → fetch USOL mercs
        if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE' && autoSendAwaitingUsolMercs) {
            setAutoSendAwaitingUsolMercs(false);
            if (!autoSendInProgress || (getAutomationActive() && getAutomationActive().type !== 'auto-send')) {
                console.log('[COR3 Helper] Auto-send: USOL merc refresh skipped (no longer active)');
            } else {
            console.log('[COR3 Helper] Auto-send: CORE mercs refreshed, now fetching USOL mercs...');
            setTimeout(() => {
                if (!autoSendInProgress) return;
                window.postMessage({ type: 'COR3_REQUEST_USOL_MERCENARIES' }, '*');
            }, 500);
            var _usolMercHandled = false;
            function onUsolMercsDoneForAutoSend(evt) {
                if (_usolMercHandled) return;
                if (evt.data && evt.data.type === 'COR3_USOL_MERCS_DONE') {
                    _usolMercHandled = true;
                    window.removeEventListener('message', onUsolMercsDoneForAutoSend);
                    clearTimeout(usolMercsTimeout);
                    console.log('[COR3 Helper] Auto-send: USOL mercs refreshed, proceeding to select merc');
                    setAutoSendAwaitingMercenaries(true);
                    window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
                }
                if (evt.data && evt.data.type === 'COR3_WS_USOL_MARKET_UNREACHABLE') {
                    _usolMercHandled = true;
                    window.removeEventListener('message', onUsolMercsDoneForAutoSend);
                    clearTimeout(usolMercsTimeout);
                    console.log('[COR3 Helper] Auto-send: USOL market unreachable — proceeding with CORE mercs only');
                    setAutoSendUsolSkipped(true);
                    setAutoSendAwaitingMercenaries(true);
                    window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
                }
            }
            window.addEventListener('message', onUsolMercsDoneForAutoSend);
            var usolMercsTimeout = setTimeout(() => {
                if (_usolMercHandled) return;
                _usolMercHandled = true;
                window.removeEventListener('message', onUsolMercsDoneForAutoSend);
                console.log('[COR3 Helper] Auto-send: USOL mercs timeout — proceeding with CORE mercs only');
                setAutoSendAwaitingMercenaries(true);
                window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
            }, 30000);
            }
        }
        // Auto-send Phase 2: all merc configures done → select merc and launch
        if (event.data && event.data.type === 'COR3_CORE_MERCS_DONE' && autoSendAwaitingMercenaries) {
            setAutoSendAwaitingMercenaries(false);
            chrome.storage.sync.get('autoSendMerc', (settings) => {
                if (!settings.autoSendMerc || !settings.autoSendMerc.enabled) {
                    console.log('[COR3 Helper] Auto-send: disabled, aborting');
                    setAutoSendInProgress(false);
                    _automationFinish('auto-send');
                    return;
                }
                chrome.storage.local.get(['mercenariesData', 'usolMercenariesData', 'mercConfigData', 'expeditionConfigData', 'usolExpeditionConfigData'], (localData) => {
                    let coreMercs = [];
                    const coreRaw = localData.mercenariesData;
                    if (coreRaw) {
                        if (coreRaw.mercenaries) coreMercs = coreRaw.mercenaries;
                        else if (Array.isArray(coreRaw)) coreMercs = coreRaw;
                    }
                    coreMercs.forEach(m => { m._market = 'core'; });
                    const coreElite = (coreRaw && coreRaw.eliteSlots) || [];
                    coreElite.forEach(es => {
                        if (es.mercenary && !coreMercs.find(m => m.id === es.mercenary.id)) {
                            es.mercenary._market = 'core'; es.mercenary._isElite = true;
                            coreMercs.push(es.mercenary);
                        }
                    });
                    let usolMercs = [];
                    const usolData = localData.usolMercenariesData;
                    if (usolData && !_autoSendUsolSkipped) {
                        let raw = usolData;
                        if (raw && !Array.isArray(raw) && raw.mercenaries) usolMercs = raw.mercenaries;
                        else if (Array.isArray(raw)) usolMercs = raw;
                        usolMercs.forEach(m => { m._market = 'usol'; });
                        const usolElite = (usolData && usolData.eliteSlots) || [];
                        usolElite.forEach(es => {
                            if (es.mercenary && !usolMercs.find(m => m.id === es.mercenary.id)) {
                                es.mercenary._market = 'usol'; es.mercenary._isElite = true;
                                usolMercs.push(es.mercenary);
                            }
                        });
                    } else if (_autoSendUsolSkipped) {
                        console.log('[COR3 Helper] Auto-send: USOL mercs skipped (market unreachable)');
                    }

                    const allMercs = [...coreMercs, ...usolMercs];
                    const configs = localData.mercConfigData || {};
                    const eliteIds = new Set();
                    coreElite.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                    const usolElite2 = (usolData && usolData.eliteSlots) || [];
                    usolElite2.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                    allMercs.forEach(m => { if (!m._isElite) m._isElite = eliteIds.has(m.id); });

                    // Fixed selection policy:
                    // elite (USOL) > normal USOL > normal CORE/HOME,
                    // then totalCost ascending, then riskScore ascending.
                    const available = allMercs.filter(m => m.status === 'AVAILABLE' && configs[m.id]);
                    let mercId = null;
                    if (available.length > 0) {
                        available.sort((a, b) => {
                            const eliteA = a._isElite ? 0 : 1;
                            const eliteB = b._isElite ? 0 : 1;
                            if (eliteA !== eliteB) return eliteA - eliteB;

                            const marketA = a._market === 'usol' ? 0 : 1;
                            const marketB = b._market === 'usol' ? 0 : 1;
                            if (marketA !== marketB) return marketA - marketB;

                            const costA = Number.isFinite(Number(configs[a.id].totalCost)) ? Number(configs[a.id].totalCost) : Infinity;
                            const costB = Number.isFinite(Number(configs[b.id].totalCost)) ? Number(configs[b.id].totalCost) : Infinity;
                            if (costA !== costB) return costA - costB;

                            const riskA = Number.isFinite(Number(configs[a.id].riskScore)) ? Number(configs[a.id].riskScore) : 0;
                            const riskB = Number.isFinite(Number(configs[b.id].riskScore)) ? Number(configs[b.id].riskScore) : 0;
                            if (riskA !== riskB) return riskA - riskB;

                            return String(a.callsign || a.name || '').localeCompare(String(b.callsign || b.name || ''));
                        });
                        mercId = available[0].id;
                        chrome.storage.local.remove('mercWarning');
                        console.log('[COR3 Helper] Auto-choose merc: selected', available[0].callsign, '(' + available[0]._market + ', ' + (available[0]._isElite ? 'elite' : 'normal') + ') cost:', configs[available[0].id].totalCost);
                    } else {
                        console.log('[COR3 Helper] Auto-send: no available mercenary with configure data');
                        chrome.storage.local.set({ mercWarning: 'Auto expedition paused: no available mercenary with expedition data. All candidates may be resting or missing configure data.' + (_autoSendUsolSkipped ? ' USOL market is unreachable.' : '') });
                        setAutoSendUsolSkipped(false);
                        setAutoSendMercRetryCount(0);
                        setAutoSendInProgress(false);
                        _automationFinish('auto-send');
                        return;
                    }
                    setAutoSendUsolSkipped(false);
                    proceedWithMerc(mercId, allMercs, settings, localData);
                });
            });
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_ARCHIVED') {
            const archivedId = event.data.data && event.data.data.id;
            if (archivedId) {
                chrome.storage.local.get('expeditionsData', (result) => {
                    const exps = result.expeditionsData || [];
                    const filtered = exps.filter(e => e.id !== archivedId);
                    chrome.storage.local.set({ expeditionsData: filtered, expeditionsDataUpdatedAt: now });
                });
            }
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_CONFIG') {
            chrome.storage.local.set({ expeditionConfigData: event.data.data });
        }
        if (event.data && event.data.type === 'COR3_WS_USOL_EXPEDITION_CONFIG') {
            chrome.storage.local.set({ usolExpeditionConfigData: event.data.data });
        }
        if (event.data && event.data.type === 'COR3_WS_CONTAINER_OPENED') {
            const expId = autoSendExpeditionId;
            if (event.data.error) {
                const msg = event.data.error.message || JSON.stringify(event.data.error);
                console.log('[COR3 Helper] Auto-send: open.container failed:', msg);
                if (msg === 'insufficient-credits') {
                    chrome.storage.sync.get('autoSendMerc', (settings) => {
                        const merc = settings.autoSendMerc || {};
                        chrome.storage.sync.set({
                            autoSendMerc: {
                                enabled: false,
                                hasInsurance: !!merc.hasInsurance,
                                disabledReason: 'insufficient_credits'
                            }
                        });
                    });
                    chrome.storage.local.set({
                        expeditionLaunchError: {
                            error: 'Insufficient credits to open reward container. Auto-send disabled.',
                            retryAfter: 0,
                            timestamp: Date.now(),
                            noRetry: true
                        }
                    });
                    setAutoSendInProgress(false);
                    setAutoSendExpeditionId(null);
                    _automationFinish('auto-send');
                    return;
                }
                // Transient busy error: retry the payment a few times.
                if (isTransientBusyMessage(msg) && expId) {
                    _containerOpenRetries++;
                    if (_containerOpenRetries <= 3) {
                        const delay = 4000 * _containerOpenRetries;
                        console.log('[COR3 Helper] Auto-send: container busy — retrying payment in', delay + 'ms');
                        setTimeout(() => {
                            if (autoSendInProgress && autoSendExpeditionId === expId) {
                                window.postMessage({ type: 'COR3_OPEN_CONTAINER', expeditionId: expId }, '*');
                            }
                        }, delay);
                        return;
                    }
                }
                chrome.storage.local.set({ mercWarning: 'Failed to open reward container: ' + msg });
                setAutoSendInProgress(false);
                setAutoSendExpeditionId(null);
                _automationFinish('auto-send');
                return;
            }

            if (autoSendInProgress && expId) {
                _containerOpenRetries = 0;
                console.log('[COR3 Helper] Auto-send: container paid — rewards are in the mailbox, claiming…');
                // New flow: open.container moves the loot to mail; claim the
                // matching PENDING message(s). auto-send continues when the
                // mailbox module emits COR3_MAIL_CLAIMED.
                window.postMessage({ type: 'COR3_CHECK_MAIL', source: 'EXPEDITION', sourceId: expId }, '*');
            }
        }
        if (event.data && event.data.type === 'COR3_WS_INSUFFICIENT_CREDITS') {
            console.log('[COR3 Helper] Insufficient credits for expedition launch, disabling auto-send mercenary');
            chrome.storage.sync.get('autoSendMerc', (settings) => {
                const merc = settings.autoSendMerc || {};
                chrome.storage.sync.set({
                    autoSendMerc: {
                        enabled: false,
                        hasInsurance: !!merc.hasInsurance,
                        disabledReason: 'insufficient_credits'
                    }
                });
            });
            chrome.storage.local.set({
                expeditionLaunchError: {
                    error: 'Insufficient credits to launch expedition',
                    retryAfter: 0,
                    timestamp: Date.now(),
                    noRetry: true
                }
            });
            setAutoSendInProgress(false);
            _automationFinish('auto-send');
            setAutoSendExpeditionId(null);
        }
        if (event.data && event.data.type === 'COR3_MAIL_CLAIMED' && event.data.source === 'EXPEDITION') {
            // New mailbox flow: all rewards for this expedition are in the stash.
            // Only the expedition currently being processed may advance auto-send;
            // ignore stale mailbox messages for older expeditions.
            if (autoSendExpeditionId && event.data.sourceId === autoSendExpeditionId) {
                onExpeditionCollected(event.data.sourceId);
            } else {
                console.log('[COR3 Helper] Auto-send: ignoring stale expedition mail', event.data.sourceId);
            }
        }
        if (event.data && event.data.type === 'COR3_WS_GAMEPLAY') {
            chrome.storage.local.set({ gameplayData: event.data.data, gameplayDataUpdatedAt: now });
        }
        if (event.data && event.data.type === 'COR3_WS_MERC_NOT_AVAILABLE') {
            setAutoSendMercRetryCount(_autoSendMercRetryCount + 1);
            if (_autoSendMercRetryCount <= MAX_MERC_RETRIES) {
                console.log('[COR3 Helper] Auto-send: Mercenary not available — retry ' + _autoSendMercRetryCount + '/' + MAX_MERC_RETRIES + ', refreshing merc data...');
                setAutoSendExpeditionBlocked(false);
                chrome.storage.local.remove('autoSendExpeditionBlocked');
                setAutoSendInProgress(true);
                if (!getAutomationActive()) setAutomationActive({ type: 'auto-send', startedAt: Date.now() });
                _broadcastQueueStatus();
                setAutoSendAwaitingMercenaries(false);
                setAutoSendAwaitingUsolMercs(true);
                setTimeout(() => {
                    if (!autoSendInProgress) return;
                    window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
                }, 2000 + Math.floor(Math.random() * 1000));
            } else {
                console.log('[COR3 Helper] Auto-send: Mercenary not available after ' + MAX_MERC_RETRIES + ' retries — aborting');
                chrome.storage.local.set({ mercWarning: 'Mercenary not available after ' + MAX_MERC_RETRIES + ' retries. Merc data may be stale.' });
                setAutoSendMercRetryCount(0);
                setAutoSendInProgress(false);
                _automationFinish('auto-send');
            }
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_LAUNCHED') {
            console.log('[COR3 Helper] Expedition launched successfully');
            setAutoSendMercRetryCount(0);
            chrome.storage.local.remove('mercWarning');
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_LAUNCH_ERROR') {
            console.log('[COR3 Helper] Expedition launch error:', event.data.error);
            if (event.data.error === 'Maximum 1 active expedition allowed') {
                console.log('[COR3 Helper] Active expedition detected — blocking auto-send until it completes');
                setAutoSendExpeditionBlocked(true);
                chrome.storage.local.set({ autoSendExpeditionBlocked: true });
                setAutoSendInProgress(false);
                _automationFinish('auto-send');
                setAutoSendExpeditionId(null);
            } else if (event.data.transient || isTransientBusyMessage(event.data.error)) {
                // The game is still processing another action. Do not disable or
                // record a permanent error — just wait for the expedition state
                // to settle, then let auto-send evaluate again.
                console.log('[COR3 Helper] Expedition action still in progress — will retry after state refresh');
                chrome.storage.local.set({ mercWarning: 'Expedition action still in progress — retrying shortly…' });
                setAutoSendExpeditionBlocked(true);
                chrome.storage.local.set({ autoSendExpeditionBlocked: true });
                setAutoSendInProgress(false);
                _automationFinish('auto-send');
                setAutoSendExpeditionId(null);
                setTimeout(() => {
                    window.postMessage({ type: 'COR3_REQUEST_EXPEDITIONS' }, '*');
                }, 8000);
            } else {
                chrome.storage.local.set({
                    expeditionLaunchError: {
                        error: event.data.error,
                        retryAfter: event.data.retryAfter,
                        timestamp: Date.now()
                    }
                });
                chrome.storage.local.remove('expeditionLaunched');
            }
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_ELITE_REQUIRED') {
            console.log('[COR3 Helper] Elite merc required — retrying with default location');
            chrome.storage.local.get('lastExpeditionLaunchData', (result) => {
                const launch = result.lastExpeditionLaunchData;
                if (!launch) return;
                const isUsol = launch.marketId === '019e4065-6ae8-760d-8724-58ab4f2cf7d7';
                const configKey = isUsol ? 'usolExpeditionConfigData' : 'expeditionConfigData';
                chrome.storage.local.get(configKey, (cfgResult) => {
                    const cfg = cfgResult[configKey];
                    if (!cfg || !cfg.locations || cfg.locations.length === 0) return;
                    const DEFAULT_LOC_NAMES = ['Skylift Remains', 'Koute Mining and Reprocessing Outpost'];
                    const loc = cfg.locations.find(l => DEFAULT_LOC_NAMES.includes(l.name)) || cfg.locations[0];
                    const zone = loc.zones && loc.zones[0] ? loc.zones[0] : null;
                    const goal = zone && zone.goals && zone.goals[0] ? zone.goals[0] : null;
                    if (!zone || !goal) return;
                    if (loc.id === launch.locationConfigId) {
                        console.log('[COR3 Helper] Already using default location — no alternative available');
                        return;
                    }
                    const retryConfig = { ...launch, locationConfigId: loc.id, zoneConfigId: zone.id, goalId: goal.id };
                    chrome.storage.local.set({ lastExpeditionLaunchData: retryConfig });
                    console.log('[COR3 Helper] Retrying expedition with location:', loc.name || loc.id);
                    setTimeout(() => {
                        window.postMessage({ type: 'COR3_LAUNCH_EXPEDITION', config: retryConfig }, '*');
                    }, 2000 + Math.floor(Math.random() * 1000));
                });
            });
        }
        if (event.data && event.data.type === 'COR3_WS_EXPEDITION_RETRY_LAUNCH') {
            console.log('[COR3 Helper] Retrying expedition launch');
            chrome.storage.local.get('lastExpeditionLaunchData', (result) => {
                if (result.lastExpeditionLaunchData) {
                    window.postMessage({
                        type: 'COR3_RELAUNCH_EXPEDITION',
                        data: result.lastExpeditionLaunchData
                    }, '*');
                }
            });
        }
        // Daily hack diagnostic log relay
        if (event.data && event.data.type === 'COR3_DAILY_HACK_LOG') {
            recordDailyHackDiagnostic({
                ts: event.data.timestamp || Date.now(),
                level: event.data.level || 'info',
                step: event.data.step || 'log',
                message: event.data.message || '',
                details: event.data.details || null
            });
        }
        // Daily hack run finished (success/failure) — scheduler keeps the toggle enabled.
        if (event.data && event.data.type === 'COR3_DAILY_HACK_RUN_FINISHED') {
            handleDailyHackRunFinished(event.data);
        }
        // Auto-fetch daily ops on page load
        if (event.data && event.data.type === 'COR3_FETCH_DAILY_OPS') {
            console.log('[COR3 Helper] Requesting daily ops data');
            chrome.storage.local.get('bearerToken', (result) => {
                const token = result.bearerToken;
                if (!token) return;
                fetch('https://svc-corie.cor3.gg/api/user-daily-claim', {
                    headers: { 'Authorization': token }
                })
                .then(r => {
                    if (r.ok) return r.json();
                    if (r.status === 400 || r.status === 401 || r.status === 403) {
                        chrome.storage.local.set({ dailyOpsError: 'token_expired', dailyOpsErrorUpdatedAt: Date.now() });
                        return null;
                    }
                    return null;
                })
                .then(data => {
                    if (data) {
                        chrome.storage.local.set({ dailyOpsData: data, dailyOpsUpdatedAt: Date.now(), dailyOpsError: null });
                        fetchDailyRewards(token);
                    }
                })
                .catch(() => {});
            });
        }
    });
}
