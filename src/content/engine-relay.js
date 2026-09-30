// Engine relay — 2nd window message listener for auto-job/valuable messages

import { isContextValid, _automationFinish } from './helpers.js';
import { setMarketRefreshInProgress, setAutoJobsActive } from './auto-update-markets.js';
import { setInitialFetchDone, setAutoSendInProgress, setAutoSendExpeditionId, setAutoSendAwaitingMercenaries, setAutoSendAwaitingUsolMercs, setAutoSendDeferredWaiting, setAutoSendUsolSkipped, setAutoSendMercRetryCount, autoSendInProgress, checkAutoSendOnExpeditionData } from './auto-send.js';
import { injectDecryptSolver, injectIceWallSolver, injectSimpleDecryptSolver } from './solvers.js';
import { queueAutoJobLog, queueValuableLog } from './log-writers.js';

export function setupEngineRelay() {
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!isContextValid()) return;

        if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_DECRYPT_SOLVER') {
            chrome.storage.sync.get('autoDecryptEnabled', (result) => {
                if (!result.autoDecryptEnabled) {
                    chrome.storage.sync.set({ autoDecryptEnabled: true });
                    console.log('[COR3 Helper] Auto Job: Enabling decrypt solver for minigame');
                }
                injectDecryptSolver();
            });
        }
        if (event.data && event.data.type === 'COR3_ICE_WALL_STATUS') {
            chrome.storage.local.set({
                iceWallSolverStatus: {
                    message: event.data.message,
                    level: event.data.level || 'info',
                    timestamp: Date.now()
                }
            });
        }
        if (event.data && event.data.type === 'COR3_SIMPLE_DECRYPT_STATUS') {
            chrome.storage.local.set({
                simpleDecryptSolverStatus: {
                    message: event.data.message,
                    level: event.data.level || 'info',
                    timestamp: Date.now()
                }
            });
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_SIMPLE_DECRYPT_SOLVER') {
            chrome.storage.sync.get('autoSimpleDecryptEnabled', (result) => {
                if (!result.autoSimpleDecryptEnabled) {
                    chrome.storage.sync.set({ autoSimpleDecryptEnabled: true });
                    console.log('[COR3 Helper] Auto Job: Enabling Simple Decrypt solver for minigame');
                }
                injectSimpleDecryptSolver();
            });
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_ENABLE_ICE_WALL_SOLVER') {
            chrome.storage.sync.get('autoIceWallEnabled', (result) => {
                if (!result.autoIceWallEnabled) {
                    chrome.storage.sync.set({ autoIceWallEnabled: true });
                    console.log('[COR3 Helper] Auto Job: Enabling ICE Wall solver for minigame');
                }
                injectIceWallSolver();
            });
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_LOG') {
            queueAutoJobLog(event.data.msg, event.data.level);
        }
        if (event.data && event.data.type === 'COR3_WS_NETWORK_MAP') {
            chrome.storage.local.set({ serverMaintenanceMap: event.data.servers });
        }
        if (event.data && event.data.type === 'COR3_DEV_TC_REACH_PROGRESS') {
            chrome.storage.local.set({ _devTcReachProgress: { log: event.data.log || [] } });
        }
        if (event.data && event.data.type === 'COR3_DEV_TC_REACH_RESULT') {
            chrome.storage.local.set({ _devTcReachResult: { reachable: event.data.reachable, reason: event.data.reason || null, log: event.data.log || [] } });
        }
        // Secret Finder: relay log updates and auto-disable toggle on completion
        if (event.data && event.data.type === 'COR3_IP_SEARCH_LOG') {
            if (isContextValid()) {
                try { chrome.storage.local.set({ secretFinderLog: event.data.html }); } catch (e) {}
            }
        }
        if (event.data && event.data.type === 'COR3_IP_SEARCH_DONE') {
            if (isContextValid()) {
                try {
                    chrome.storage.local.set({ secretFinderLog: event.data.html });
                    chrome.storage.sync.set({ secretFinderEnabled: false });
                } catch (e) {}
            }
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_TRACKER_UPDATE') {
            chrome.storage.local.set({ autoJobsTracker: event.data.tracker });
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_DONE') {
            setAutoJobsActive(false);
            chrome.storage.local.set({ autoJobsRunning: false });
            _automationFinish('auto-jobs');
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_ICE_WALL_RELOAD') {
            var lockedJob = event.data.lockedJob;
            console.log('[COR3 Helper] ICE Wall stuck — saving locked job and reloading page');
            chrome.storage.local.get('autoJobsLockedJobs', (prev) => {
                var lockedList = prev.autoJobsLockedJobs || [];
                if (lockedJob && lockedJob.jobId) {
                    lockedList = lockedList.filter(j => j.jobId !== lockedJob.jobId);
                    lockedList.push(lockedJob);
                }
                chrome.storage.local.set({ autoJobsLockedJobs: lockedList }, () => {
                    window.location.reload();
                });
            });
        }
        if (event.data && event.data.type === 'COR3_ALL_MARKETS_REFRESHED') {
            setMarketRefreshInProgress(false);
            chrome.storage.local.set({ _allMarketsRefreshed: Date.now() });
        }
        if (event.data && event.data.type === 'COR3_TOKEN_EXPIRED') {
            setMarketRefreshInProgress(false);
            import('./auto-update-markets.js').then(m => m.setSeqRefreshRunning(false));
            setInitialFetchDone(false);
            chrome.storage.local.remove('initialFetchDoneAt');
            if (autoSendInProgress) {
                console.log('[COR3 Helper] Token expired — aborting in-progress auto-send');
                setAutoSendInProgress(false);
                setAutoSendExpeditionId(null);
                setAutoSendAwaitingMercenaries(false);
                setAutoSendAwaitingUsolMercs(false);
                setAutoSendDeferredWaiting(false);
                setAutoSendUsolSkipped(false);
                setAutoSendMercRetryCount(0);
                _automationFinish('auto-send');
            }
            console.log('[COR3 Helper] Token expired — cleared market refresh flags, gating automations until initial fetch done');
        }
        if (event.data && event.data.type === 'COR3_INITIAL_FETCH_DONE') {
            setInitialFetchDone(true);
            chrome.storage.local.set({ initialFetchDoneAt: Date.now() });
            console.log('[COR3 Helper] Initial fetch done — automations unblocked');
            chrome.storage.local.get('expeditionsData', (result) => {
                if (result.expeditionsData) {
                    checkAutoSendOnExpeditionData(result.expeditionsData);
                }
            });
        }
        if (event.data && event.data.type === 'COR3_AUTOJOB_SAVE_COMPLETED') {
            chrome.storage.local.get('autoJobsCompletedResults', (result) => {
                const existing = result.autoJobsCompletedResults || [];
                const incoming = event.data.jobs || [];
                const merged = [...existing];
                for (const job of incoming) {
                    const idx = merged.findIndex(j => j.jobId === job.jobId);
                    if (idx >= 0) merged[idx] = job;
                    else merged.push(job);
                }
                chrome.storage.local.set({ autoJobsCompletedResults: merged });
            });
        }
        // --- Auto Valuable Seller: relay log/data/done messages to storage ---
        if (event.data && event.data.type === 'COR3_VALUABLE_LOG') {
            queueValuableLog(event.data.msg, event.data.level);
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_SERVERS_UPDATE') {
            chrome.storage.local.set({ valuableServersData: event.data.data });
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_DOWNLOADS_UPDATE') {
            chrome.storage.local.set({ valuableDownloadsData: event.data.data });
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_MAINTENANCE_UPDATE') {
            chrome.storage.local.set({ valuableMaintenanceData: event.data.data });
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_FORCE_MAINT_BATCH_PROGRESS') {
            chrome.storage.local.get('forceMaintenanceInProgress', function(res) {
                var fm = res.forceMaintenanceInProgress;
                if (fm && fm.batch) {
                    fm.currentServerId = event.data.currentServerId;
                    fm.serverIds = event.data.serverIds;
                    chrome.storage.local.set({ forceMaintenanceInProgress: fm });
                }
            });
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_FORCE_MAINT_SERVER_DONE') {
            chrome.storage.local.set({ valuableForceMaintenanceServerDone: { serverId: event.data.serverId, serverName: event.data.serverName, ts: Date.now() } });
            chrome.storage.local.get('valuableMaintenanceData', function (res) {
                var mData = res.valuableMaintenanceData;
                if (mData && mData.servers) {
                    for (var si = 0; si < mData.servers.length; si++) {
                        if (mData.servers[si].id === event.data.serverId) {
                            mData.servers[si].maintenanceEndsAt = mData.servers[si].maintenanceEndsAt || new Date(Date.now() + 3600000).toISOString();
                            mData.servers[si].timeUntilMaintenance = null;
                            break;
                        }
                    }
                    chrome.storage.local.set({ valuableMaintenanceData: mData });
                }
            });
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_FORCE_MAINT_DONE') {
            var fmDoneData = { done: true };
            if (event.data.error) {
                fmDoneData.error = event.data.error;
                fmDoneData.blockerName = event.data.blockerName || null;
                fmDoneData.remainingMs = event.data.remainingMs || null;
                fmDoneData.targetServer = event.data.targetServer || null;
            }
            chrome.storage.local.set({ valuableForceMaintenanceDone: fmDoneData });
            chrome.storage.local.remove('forceMaintenanceInProgress');
        }
        if (event.data && event.data.type === 'COR3_VALUABLE_DONE') {
            chrome.storage.local.set({ valuableSearchRunning: false, valuableSellerRunning: false });
            _automationFinish('auto-valuable');
        }
    });
}
