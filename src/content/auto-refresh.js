// Auto-Refresh for Market Job Timers

import { isContextValid } from './helpers.js';
import { _seqRefreshRunning, _autoJobsActive, _marketRefreshInProgress, _autoUpdateMarketsLastRefresh, setSeqRefreshRunning, setMarketRefreshInProgress, setAutoUpdateMarketsLastRefresh, _autoUpdateMarkets, _initAutoUpdateMarketsTimer, setAutoUpdateMarkets } from './auto-update-markets.js';
import { _initialFetchDone } from './auto-send.js';

let autoRefreshSettings = { home_jobs: false, dark_jobs: false, soyuz_jobs: false, usol_jobs: false };
let autoRefreshRetryPending = { home_jobs: false, dark_jobs: false, soyuz_jobs: false, usol_jobs: false };
let autoRefreshExpiredRetryAt = { home_jobs: 0, dark_jobs: 0, soyuz_jobs: 0, usol_jobs: 0 };

export function setAutoRefreshSettings(v) { autoRefreshSettings = v; }

// Load auto-refresh settings on startup
try { chrome.storage.sync.get('autoRefresh', (data) => {
    if (data.autoRefresh) autoRefreshSettings = data.autoRefresh;
}); } catch (e) {}

// Keep auto-refresh settings in sync when changed from popup
try { chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.autoRefresh && changes.autoRefresh.newValue) {
        autoRefreshSettings = changes.autoRefresh.newValue;
    }
    if (area === 'sync' && changes.autoUpdateMarkets !== undefined) {
        const wasOff = !_autoUpdateMarkets;
        setAutoUpdateMarkets(changes.autoUpdateMarkets.newValue !== false);
        if (_autoUpdateMarkets && wasOff) _initAutoUpdateMarketsTimer();
    }
    // Clear expired retry cooldown when market data arrives with a future nextJobsResetAt
    if (area === 'local') {
        const marketKeyMap = { marketData: 'home_jobs', darkMarketData: 'dark_jobs', soyuzMarketData: 'soyuz_jobs', usolMarketData: 'usol_jobs' };
        for (const [storageKey, refreshKey] of Object.entries(marketKeyMap)) {
            if (changes[storageKey] && changes[storageKey].newValue) {
                const resetAt = changes[storageKey].newValue.nextJobsResetAt;
                if (resetAt && new Date(resetAt).getTime() > Date.now()) {
                    autoRefreshExpiredRetryAt[refreshKey] = 0;
                }
            }
        }
        // Relay background/popup console logs to IndexedDB
        if (changes.cor3_console_logs && changes.cor3_console_logs.newValue) {
            const oldLen = (changes.cor3_console_logs.oldValue || []).length;
            const newEntries = changes.cor3_console_logs.newValue.slice(oldLen);
            const bgPopupEntries = newEntries.filter(e => e.source !== 'content');
            if (bgPopupEntries.length > 0) {
                try {
                    for (const e of bgPopupEntries) {
                        cor3LogEntry('ext-console', '[' + (e.source || 'unknown') + '] ' + (e.args || ''), e.level || 'log');
                    }
                } catch (err) { /* silently ignore */ }
            }
        }
    }
}); } catch (e) {}

function getMarketTimerSeconds(which) {
    return new Promise((resolve) => {
        if (!isContextValid()) { resolve(null); return; }
        try {
            const key = which === 'home_jobs' ? 'marketData' : which === 'usol_jobs' ? 'usolMarketData' : which === 'soyuz_jobs' ? 'soyuzMarketData' : 'darkMarketData';
            chrome.storage.local.get(key, (result) => {
                const data = result[key];
                if (data && data.nextJobsResetAt) {
                    const diff = new Date(data.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } catch (e) { resolve(null); }
    });
}

async function checkAutoRefresh() {
    try {
        if (!isContextValid()) return;
        if (_seqRefreshRunning || _autoJobsActive || !_initialFetchDone) return;

        let needsRefresh = false;
        let expiredMarkets = [];
        const now = Date.now();
        for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
            if (!autoRefreshSettings[key]) continue;
            if (autoRefreshRetryPending[key]) continue;

            const sec = await getMarketTimerSeconds(key);
            if (sec !== null && sec <= 0) {
                if (autoRefreshExpiredRetryAt[key] && now < autoRefreshExpiredRetryAt[key]) continue;
                needsRefresh = true;
                expiredMarkets.push(key);
            }
        }

        if (needsRefresh) {
            setSeqRefreshRunning(true);
            for (const key of expiredMarkets) {
                autoRefreshRetryPending[key] = true;
                autoRefreshExpiredRetryAt[key] = now + 60000;
            }

            var order = [];
            if (expiredMarkets.includes('usol_jobs')) order.push('usol');
            if (expiredMarkets.includes('soyuz_jobs')) order.push('soyuz');
            if (expiredMarkets.includes('dark_jobs')) order.push('dark');
            if (expiredMarkets.includes('home_jobs')) order.push('home');

            setMarketRefreshInProgress(true);
            setAutoUpdateMarketsLastRefresh(Date.now());
            var msg = { type: 'COR3_REFRESH_ALL_MARKETS_SEQ' };
            if (order.length > 0) msg.order = order;
            window.postMessage(msg, '*');

            setTimeout(() => {
                setSeqRefreshRunning(false);
                for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
                    autoRefreshRetryPending[key] = false;
                }
            }, 30000);

            function onAllDone(evt) {
                if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                    window.removeEventListener('message', onAllDone);
                    setSeqRefreshRunning(false);
                    for (const key of ['home_jobs', 'dark_jobs', 'soyuz_jobs', 'usol_jobs']) {
                        autoRefreshRetryPending[key] = false;
                    }
                }
            }
            window.addEventListener('message', onAllDone);
        }
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) return;
    }
}

// Check auto-refresh every second
export const autoRefreshIntervalId = setInterval(() => checkAutoRefresh(), 1000);
