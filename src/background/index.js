// background.js — Service worker entry point.
// Imports all submodules so esbuild bundles them into a single IIFE.

import { getCor3Tab } from './helpers.js';
import { checkAutoChooseBackground } from './auto-choose.js';
import { scheduleAutoFinishAllBg, scheduleAutoFinishAllBgDebounced, runAutoFinishAllBg, collectJobsBg } from './auto-finish-jobs.js';
import { MARKET_RESET_DURATIONS_MS } from '../shared/server-constants.js';

// --- Keep-alive ---
async function keepWorkerAlive() {
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "keepWorkerAlive" });
        }
    } catch (e) {
        console.log('[COR3 Helper] Keep-alive failed:', e);
        cor3LogError('background.js', e, { action: 'keepWorkerAlive' });
    }
}
keepWorkerAlive();
setInterval(keepWorkerAlive, 30000);

// --- Decision timer monitoring every 10 seconds ---
setInterval(checkAutoChooseBackground, 10000);

// --- Expedition data request (on-demand only) ---
async function requestExpeditionsFromBg() {
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
        }
    } catch (e) { /* silent */ }
}

// --- Listen for chrome.alarms ---
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoFinishAllJobs') {
        runAutoFinishAllBg();
    }
});

// --- Storage change listener ---
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoJobsRunning) {
        if (!changes.autoJobsRunning.newValue) {
            (async () => {
                try {
                    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
                    if (!settings.autoFinishAllJobsEnabled) return;
                } catch (e) { /* best effort */ }
                scheduleAutoFinishAllBgDebounced();
            })();
        }
    }
    if (area === 'local' && (changes.marketData || changes.darkMarketData || changes.soyuzMarketData || changes.usolMarketData)) {
        const now = Date.now();
        const resetChanged = (change, marketKey) => {
            if (!change) return false;
            const oldReset = change.oldValue && change.oldValue.nextJobsResetAt;
            const newReset = change.newValue && change.newValue.nextJobsResetAt;
            if (!newReset) return false;
            if (oldReset) {
                const oldMs = new Date(oldReset).getTime();
                const newMs = new Date(newReset).getTime();
                if (newMs - oldMs > 60000) return true;
                const cycleDuration = MARKET_RESET_DURATIONS_MS[marketKey] || 0;
                if (oldMs < now && cycleDuration > 0 && (now - oldMs) < cycleDuration) return true;
            }
            return false;
        };
        const homeReset = resetChanged(changes.marketData, 'home');
        const darkReset = resetChanged(changes.darkMarketData, 'dark');
        const soyuzReset = resetChanged(changes.soyuzMarketData, 'soyuz');
        const usolReset = resetChanged(changes.usolMarketData, 'usol');
        if (homeReset || darkReset || soyuzReset || usolReset) {
            chrome.storage.local.get(['autoJobsTracker', 'autoJobsCompletedResults'], (result) => {
                let tracker = Array.isArray(result.autoJobsTracker) ? result.autoJobsTracker : [];
                let cr = Array.isArray(result.autoJobsCompletedResults) ? result.autoJobsCompletedResults : [];
                if (homeReset) {
                    tracker = tracker.filter(j => (j.marketKey || 'home') !== 'home');
                    cr = cr.filter(j => j.marketKey !== 'home');
                }
                if (darkReset) {
                    tracker = tracker.filter(j => j.marketKey !== 'dark');
                    cr = cr.filter(j => j.marketKey !== 'dark');
                }
                if (soyuzReset) {
                    tracker = tracker.filter(j => j.marketKey !== 'soyuz');
                    cr = cr.filter(j => j.marketKey !== 'soyuz');
                }
                if (usolReset) {
                    tracker = tracker.filter(j => j.marketKey !== 'usol');
                    cr = cr.filter(j => j.marketKey !== 'usol');
                }
                chrome.storage.local.set({ autoJobsTracker: tracker, autoJobsCompletedResults: cr });
            });
            chrome.storage.sync.get('autoFinishAllJobsEnabled', (data) => {
                if (data.autoFinishAllJobsEnabled) scheduleAutoFinishAllBgDebounced();
            });
        }
    }
    if (area === 'local' && changes.initialFetchDoneAt && changes.initialFetchDoneAt.newValue) {
        chrome.storage.sync.get('autoFinishAllJobsEnabled', (data) => {
            if (data.autoFinishAllJobsEnabled) scheduleAutoFinishAllBgDebounced();
        });
    }
});

// --- Schedule on startup if enabled ---
scheduleAutoFinishAllBg();

// --- Message listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "alarmActiveStatus") {
        sendResponse({ success: true });
        return true;
    }
    if (request.action === "scheduleAutoFinishAll") {
        scheduleAutoFinishAllBg();
        sendResponse({ success: true });
        return true;
    }
});
