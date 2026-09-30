// WS message relay from content-early.js (MAIN world) → chrome.storage
// This is the first window message listener in content.js

import { isContextValid, _automationFinish, _broadcastQueueStatus, getAutomationActive, setAutomationActive } from './helpers.js';
import { checkAutoChooseFromContent } from './auto-choose.js';
import {
    checkAutoSendOnExpeditionData, proceedWithMerc,
    autoSendInProgress, autoSendExpeditionId, autoSendAwaitingMercenaries,
    autoSendAwaitingUsolMercs, autoSendExpeditionBlocked, autoSendCollectRetries,
    MAX_COLLECT_RETRIES, _autoSendUsolSkipped, _autoSendMercRetryCount, MAX_MERC_RETRIES,
    autoSellCheapestItems, disableAutoSendDueToStashFull,
    setAutoSendInProgress, setAutoSendExpeditionId, setAutoSendAwaitingMercenaries,
    setAutoSendAwaitingUsolMercs, setAutoSendExpeditionBlocked, setAutoSendCollectRetries,
    setAutoSendUsolSkipped, setAutoSendMercRetryCount, setInitialMercsReady
} from './auto-send.js';
import { setMarketRefreshInProgress, setAutoUpdateMarketsLastRefresh, setSeqRefreshRunning } from './auto-update-markets.js';

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

            chrome.storage.sync.get('autoSendMerc', (settings) => {
                if (settings.autoSendMerc &&
                    settings.autoSendMerc.disabledReason === 'stash_full' &&
                    !settings.autoSendMerc.enabled) {

                    const stash = event.data.stash;
                    let hasSpace = false;
                    let spaceNeeded = 2;

                    if (stash && stash.maxCapacity && stash.currentUsage !== undefined) {
                        const availableSpace = stash.maxCapacity - stash.currentUsage;
                        hasSpace = availableSpace >= spaceNeeded;
                    }

                    if (hasSpace) {
                        console.log('[COR3 Helper] Stash has space again, re-enabling auto-send mercenary');
                        chrome.storage.sync.set({
                            autoSendMerc: {
                                ...settings.autoSendMerc,
                                enabled: true,
                                disabledReason: null
                            }
                        });
                        window.postMessage({
                            type: 'COR3_AUTO_SEND_REENABLED',
                            message: 'Stash space available. Auto-send mercenary re-enabled.'
                        }, '*');
                    }
                }
            });
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
                    let mercId = settings.autoSendMerc.mercenaryId;

                    if (settings.autoSendMerc.autoChooseMerc) {
                        const configs = localData.mercConfigData || {};
                        const ignoreElite = !!settings.autoSendMerc.ignoreEliteMerc;
                        const usolFirst = !!settings.autoSendMerc.autoChooseUsolFirst;
                        const eliteIds = new Set();
                        coreElite.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                        const usolElite2 = (usolData && usolData.eliteSlots) || [];
                        usolElite2.forEach(es => { if (es.mercenary) eliteIds.add(es.mercenary.id); });
                        allMercs.forEach(m => { if (!m._isElite) m._isElite = eliteIds.has(m.id); });

                        let available = allMercs.filter(m => m.status === 'AVAILABLE' && configs[m.id]);
                        if (ignoreElite) available = available.filter(m => !m._isElite);
                        if (settings.autoSendMerc.applyMercCostLimiter) {
                            const maxCost = settings.autoSendMerc.maxMercCost ?? 15000;
                            available = available.filter(m => (configs[m.id].totalCost || 0) <= maxCost);
                        }
                        if (available.length > 0) {
                            available.sort((a, b) => {
                                if (usolFirst) {
                                    if (a._market === 'usol' && b._market !== 'usol') return -1;
                                    if (a._market !== 'usol' && b._market === 'usol') return 1;
                                }
                                const costA = (configs[a.id] && configs[a.id].totalCost) || Infinity;
                                const costB = (configs[b.id] && configs[b.id].totalCost) || Infinity;
                                if (costA !== costB) return costA - costB;
                                const riskA = (configs[a.id] && configs[a.id].riskScore) || 0;
                                const riskB = (configs[b.id] && configs[b.id].riskScore) || 0;
                                if (riskA !== riskB) return riskA - riskB;
                                if (a._market === 'usol' && b._market !== 'usol') return -1;
                                if (a._market !== 'usol' && b._market === 'usol') return 1;
                                return 0;
                            });
                            mercId = available[0].id;
                            console.log('[COR3 Helper] Auto-choose merc: selected', available[0].callsign, '(' + available[0]._market + ') cost:', configs[available[0].id].totalCost);
                        } else {
                            console.log('[COR3 Helper] Auto-send: no fitting merc available after filtering');
                            chrome.storage.local.set({ mercWarning: 'No fitting merc available — all mercs filtered out or unavailable.' + (_autoSendUsolSkipped ? ' (USOL market unreachable)' : '') });
                            setAutoSendUsolSkipped(false);
                            setAutoSendMercRetryCount(0);
                            setAutoSendInProgress(false);
                            _automationFinish('auto-send');
                            return;
                        }
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
            if (autoSendInProgress && autoSendExpeditionId) {
                console.log('[COR3 Helper] Auto-send: Container opened, checking inventory space...');
                const containerData = event.data.data;

                let spaceNeeded = 2;
                if (containerData && containerData.items && Array.isArray(containerData.items)) {
                    spaceNeeded = containerData.items.length;
                    console.log('[COR3 Helper] Container contains', spaceNeeded, 'items');
                } else if (containerData && containerData.containerItems && Array.isArray(containerData.containerItems)) {
                    spaceNeeded = containerData.containerItems.length;
                    console.log('[COR3 Helper] Container contains', spaceNeeded, 'items (containerItems)');
                }

                chrome.storage.local.get('stashData', (result) => {
                    const stash = result.stashData;
                    let hasSpace = true;

                    if (stash && stash.maxCapacity && stash.currentUsage !== undefined) {
                        const availableSpace = stash.maxCapacity - stash.currentUsage;
                        hasSpace = availableSpace >= spaceNeeded;
                        console.log('[COR3 Helper] Inventory check:', availableSpace, 'available, need', spaceNeeded);
                    }

                    if (hasSpace) {
                        console.log('[COR3 Helper] Auto-send: Sufficient space, collecting all in 10s...');
                        setTimeout(() => {
                            window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                        }, 10000 + Math.floor(Math.random() * 500));
                    } else {
                        chrome.storage.sync.get('autoSellCheapest', (sellData) => {
                            if (sellData.autoSellCheapest && stash && stash.items) {
                                const availableSpace2 = stash.maxCapacity - stash.currentUsage;
                                const shortfall = spaceNeeded - availableSpace2;
                                console.log('[COR3 Helper] Auto-sell: need', shortfall, 'more slot(s), selling cheapest items');
                                autoSellCheapestItems(stash.items, shortfall, () => {
                                    window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                                    setTimeout(() => {
                                        console.log('[COR3 Helper] Auto-sell done, collecting all in 10s...');
                                        setTimeout(() => {
                                            window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                                        }, 10000 + Math.floor(Math.random() * 500));
                                    }, 3000);
                                });
                            } else {
                                console.log('[COR3 Helper] Auto-send: Insufficient space, disabling auto-container-claim');
                                chrome.storage.sync.get('autoSendMerc', (settings) => {
                                    if (settings.autoSendMerc) {
                                        chrome.storage.sync.set({
                                            autoSendMerc: {
                                                ...settings.autoSendMerc,
                                                enabled: false,
                                                disabledReason: 'stash_full'
                                            }
                                        });
                                    }
                                });
                                setAutoSendInProgress(false);
                                _automationFinish('auto-send');
                            }
                        });
                    }
                });
            }
        }
        if (event.data && event.data.type === 'COR3_WS_STASH_FULL') {
            setAutoSendCollectRetries(autoSendCollectRetries + 1);
            console.log('[COR3 Helper] Stash full error detected (attempt', autoSendCollectRetries, '/', MAX_COLLECT_RETRIES, ')');
            if (autoSendCollectRetries > MAX_COLLECT_RETRIES) {
                console.log('[COR3 Helper] Max collect retries reached, giving up');
                setAutoSendCollectRetries(0);
                disableAutoSendDueToStashFull();
                return;
            }
            chrome.storage.sync.get('autoSellCheapest', (sellData) => {
                if (sellData.autoSellCheapest) {
                    chrome.storage.local.get('stashData', (result) => {
                        const stash = result.stashData;
                        if (stash && stash.items) {
                            console.log('[COR3 Helper] Auto-sell: selling cheapest items to free space after collect.all stash-full');
                            autoSellCheapestItems(stash.items, 2, () => {
                                window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                                setTimeout(() => {
                                    if (autoSendExpeditionId) {
                                        console.log('[COR3 Helper] Auto-sell done, retrying collect all in 10s...');
                                        setTimeout(() => {
                                            window.postMessage({ type: 'COR3_COLLECT_ALL', expeditionId: autoSendExpeditionId }, '*');
                                        }, 10000 + Math.floor(Math.random() * 500));
                                    }
                                }, 3000);
                            });
                        } else {
                            setAutoSendCollectRetries(0);
                            disableAutoSendDueToStashFull();
                        }
                    });
                } else {
                    setAutoSendCollectRetries(0);
                    disableAutoSendDueToStashFull();
                }
            });
        }
        if (event.data && event.data.type === 'COR3_WS_INSUFFICIENT_CREDITS') {
            console.log('[COR3 Helper] Insufficient credits for expedition launch, disabling auto-send mercenary');
            chrome.storage.sync.get('autoSendMerc', (settings) => {
                if (settings.autoSendMerc) {
                    chrome.storage.sync.set({
                        autoSendMerc: {
                            ...settings.autoSendMerc,
                            enabled: false,
                            disabledReason: 'insufficient_credits'
                        }
                    });
                }
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
        if (event.data && event.data.type === 'COR3_WS_COLLECT_INSUFFICIENT_CREDITS') {
            console.log('[COR3 Helper] Insufficient credits for collect.all, disabling auto-send mercenary');
            chrome.storage.sync.get('autoSendMerc', (settings) => {
                if (settings.autoSendMerc) {
                    chrome.storage.sync.set({
                        autoSendMerc: {
                            ...settings.autoSendMerc,
                            enabled: false,
                            disabledReason: 'insufficient_credits'
                        }
                    });
                }
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
            _automationFinish('auto-send');
            setAutoSendExpeditionId(null);
        }
        if (event.data && event.data.type === 'COR3_WS_COLLECTED_ALL') {
            setAutoSendCollectRetries(0);
            const collectedId = event.data.data && event.data.data.id;
            if (collectedId) {
                chrome.storage.local.get('expeditionsData', (result) => {
                    const exps = result.expeditionsData || [];
                    const filtered = exps.filter(e => e.id !== collectedId);
                    chrome.storage.local.set({ expeditionsData: filtered, expeditionsDataUpdatedAt: now });
                });
            }
            if (autoSendInProgress && autoSendExpeditionId) {
                console.log('[COR3 Helper] Auto-send: All collected, refreshing mercenaries (CORE + USOL)...');
                setAutoSendExpeditionId(null);
                setTimeout(() => {
                    window.postMessage({ type: 'COR3_REQUEST_STASH' }, '*');
                }, 500);
                var mercDelay = 2500 + Math.floor(Math.random() * 1000);
                setTimeout(() => {
                    if (!autoSendInProgress || (getAutomationActive() && getAutomationActive().type !== 'auto-send')) {
                        console.log('[COR3 Helper] Auto-send: merc refresh skipped (no longer active or another automation took over)');
                        return;
                    }
                    window.postMessage({ type: 'COR3_REQUEST_MERCENARIES' }, '*');
                }, mercDelay);
                setAutoSendAwaitingMercenaries(false);
                setAutoSendAwaitingUsolMercs(true);
            }
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
        // Daily hack log relay
        if (event.data && event.data.type === 'COR3_DAILY_HACK_LOG') {
            chrome.storage.local.set({
                dailyHackLog: event.data.message,
                dailyHackLogUpdatedAt: Date.now()
            });
        }
        // Auto-disable daily hack toggle
        if (event.data && event.data.type === 'COR3_DAILY_HACK_DISABLE_TOGGLE') {
            chrome.storage.sync.set({ autoDailyHackEnabled: false });
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
