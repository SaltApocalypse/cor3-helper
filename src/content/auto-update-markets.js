// Auto Update Markets toggle and periodic refresh logic

import { isContextValid, _automationEnqueue, _automationFinish } from './helpers.js';

export let _autoUpdateMarkets = false;
export let _marketRefreshInProgress = false;
export let _autoUpdateMarketsLastRefresh = 0;
export let _seqRefreshRunning = false;
export let _autoJobsActive = false;
const _AUTO_UPDATE_MARKETS_INTERVAL = 10 * 60 * 1000; // 10 minutes

export function setMarketRefreshInProgress(v) { _marketRefreshInProgress = v; }
export function setAutoUpdateMarketsLastRefresh(v) { _autoUpdateMarketsLastRefresh = v; }
export function setSeqRefreshRunning(v) { _seqRefreshRunning = v; }
export function setAutoJobsActive(v) { _autoJobsActive = v; }
export function setAutoUpdateMarkets(v) { _autoUpdateMarkets = v; }

// Check market freshness and set the last-refresh timer so we only refresh when actually stale
export function _initAutoUpdateMarketsTimer() {
    if (!isContextValid()) { _autoUpdateMarketsLastRefresh = Date.now(); return; }
    try {
        chrome.storage.local.get(['marketDataUpdatedAt', 'darkMarketDataUpdatedAt', 'soyuzMarketDataUpdatedAt', 'usolMarketDataUpdatedAt'], (result) => {
            const now = Date.now();
            const timestamps = [
                result.marketDataUpdatedAt || 0,
                result.darkMarketDataUpdatedAt || 0,
                result.soyuzMarketDataUpdatedAt || 0,
                result.usolMarketDataUpdatedAt || 0
            ].filter(t => t > 0);
            if (timestamps.length === 0) {
                _autoUpdateMarketsLastRefresh = 0;
                return;
            }
            const oldestUpdate = Math.min(...timestamps);
            const timeSinceOldest = now - oldestUpdate;
            if (timeSinceOldest >= _AUTO_UPDATE_MARKETS_INTERVAL) {
                _autoUpdateMarketsLastRefresh = 0;
            } else {
                _autoUpdateMarketsLastRefresh = oldestUpdate;
            }
        });
    } catch (e) { _autoUpdateMarketsLastRefresh = Date.now(); }
}

// Initialize on load
try { chrome.storage.sync.get('autoUpdateMarkets', (data) => {
    if (data.autoUpdateMarkets !== undefined) _autoUpdateMarkets = data.autoUpdateMarkets;
    if (_autoUpdateMarkets) _initAutoUpdateMarketsTimer();
}); } catch (e) {}

// Periodic market refresh when Auto Update Markets is enabled
setInterval(() => {
    if (!_autoUpdateMarkets) return;
    if (!isContextValid()) return;
    if (_marketRefreshInProgress || _seqRefreshRunning || _autoJobsActive) return;
    const now = Date.now();
    if (now - _autoUpdateMarketsLastRefresh < _AUTO_UPDATE_MARKETS_INTERVAL) return;
    _autoUpdateMarketsLastRefresh = now;
    _automationEnqueue('auto-update-markets', () => {
        _marketRefreshInProgress = true;
        console.log('[COR3 Helper] Auto Update Markets: triggering periodic 10-min refresh');
        window.postMessage({ type: 'COR3_REFRESH_ALL_MARKETS_SEQ' }, '*');
        setTimeout(() => { _marketRefreshInProgress = false; _automationFinish('auto-update-markets'); }, 30000);
        function onDone(evt) {
            if (evt.data && evt.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
                window.removeEventListener('message', onDone);
                _marketRefreshInProgress = false;
                _automationFinish('auto-update-markets');
            }
        }
        window.addEventListener('message', onDone);
    });
}, 30000);
