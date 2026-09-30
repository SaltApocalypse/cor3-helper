// --- Auto Job Solver UI ---
import { _h, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab, formatTimeRemaining, updateSelectAllState } from './utils.js';
import { findMaintenanceBlocker } from '../shared/server-map.js';
import { MARKET_RESET_DURATIONS_MS } from '../shared/server-constants.js';

const autoJobSolverToggle = document.getElementById('autoJobSolverToggle');
const autoJobSolverStatus = document.getElementById('autoJobSolverStatus');
const autoJobSolverSection = document.getElementById('autoJobSolverSection');
const autoJobsTabHome = document.getElementById('autoJobsTabHome');
const autoJobsTabDark = document.getElementById('autoJobsTabDark');
const autoJobsTabSoyuz = document.getElementById('autoJobsTabSoyuz');
const autoJobsTabUsol = document.getElementById('autoJobsTabUsol');
const autoJobsContentHome = document.getElementById('autoJobsContentHome');
const autoJobsContentDark = document.getElementById('autoJobsContentDark');
const autoJobsContentSoyuz = document.getElementById('autoJobsContentSoyuz');
const autoJobsContentUsol = document.getElementById('autoJobsContentUsol');
const autoJobsStartBtn = document.getElementById('autoJobsStartBtn');
const autoJobsDebugToggle = document.getElementById('autoJobsDebugToggle');
const autoJobsDebugConsole = document.getElementById('autoJobsDebugConsole');
const debugTabJobs = document.getElementById('debugTabJobs');
const debugTabLogs = document.getElementById('debugTabLogs');
const debugJobsBody = document.getElementById('debugJobsBody');
const debugLogsBody = document.getElementById('debugLogsBody');
const refreshAutoJobsBtn = document.getElementById('refreshAutoJobsBtn');
const copyAllLogsBtn = document.getElementById('copyAllLogsBtn');
const autoFinishAllJobsToggle = document.getElementById('autoFinishAllJobsToggle');

const SUPPORTED_JOB_TYPES = [
    'File Decryption',
    'IP Injection',
    'Data Download',
    'Log Deletion',
    'Log Download',
    'Decrypt & Extract',
    'File Elimination',
    'Data Upload',
    'IP Cleanup'
];

const MARKET_IDS = {
    home: '019d3ea4-85bd-7389-904d-8f7c85841134',
    dark: '019d3ea4-85bd-7389-904d-908ba9194aa0',
    soyuz: '019da731-2db5-7d76-9447-1ea3b9b78001',
    usol: '019e4065-6ae8-760d-8724-58ab4f2cf7d7'
};

const SERVER_PRIORITY = ['RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP', 'D4RK RM7CE', 'RM7-S4L4', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'];
function getServerPriority(name) {
    const idx = SERVER_PRIORITY.indexOf(name);
    return idx >= 0 ? idx : SERVER_PRIORITY.length;
}

const JOB_TYPE_PRIORITY = [
    'IP Injection', 'IP Cleanup', 'Data Upload', 'Data Download',
    'Log Deletion', 'Log Download', 'File Elimination', 'File Decryption', 'Decrypt & Extract'
];
function getJobTypePriority(name) {
    const idx = JOB_TYPE_PRIORITY.indexOf(name);
    return idx >= 0 ? idx : JOB_TYPE_PRIORITY.length;
}

function resolveRecentJobMarket(recentJob, fallbackMarketKey, allMarketData) {
    if (recentJob.marketId) {
        for (const [key, id] of Object.entries(MARKET_IDS)) {
            if (id === recentJob.marketId) return key;
        }
    }
    const jobId = recentJob.id;
    for (const [key, storageKey] of [['home', 'marketData'], ['dark', 'darkMarketData'], ['soyuz', 'soyuzMarketData'], ['usol', 'usolMarketData']]) {
        const md = allMarketData[storageKey];
        if (md && md.jobs) {
            const match = md.jobs.find(j => j.id === jobId);
            if (match) return key;
        }
    }
    return fallbackMarketKey;
}

const LOG_JOB_TYPES = ['Log Deletion', 'Log Download'];
function isJobBugged(job) {
    const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : (job.serverName || '');
    return serverName === 'D4RK RM7CE' && LOG_JOB_TYPES.includes(job.name || job.type);
}

let autoJobsRunning = false;
let autoFinishAllActive = false;
let autoJobsSelectedTypes = { home: [], dark: [], soyuz: [], usol: [] };
let autoJobsDebugLogs = [];
const AUTO_JOBS_MAX_LOGS = 200;
let autoJobsTracker = [];

function updateAutoJobSolverStatus(enabled) {
    autoJobSolverStatus.textContent = enabled ? 'Active' : 'Off';
    autoJobSolverStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
    autoJobSolverSection.style.display = enabled ? '' : 'none';
    var card = autoJobSolverSection.closest('.popout-card');
    if (card) card.style.display = enabled ? '' : 'none';
}

chrome.storage.sync.get('autoJobSolverEnabled', (data) => {
    const enabled = !!data.autoJobSolverEnabled;
    autoJobSolverToggle.checked = enabled;
    updateAutoJobSolverStatus(enabled);
    if (enabled) renderAutoJobsTabs();
});

autoJobSolverToggle.addEventListener('change', async () => {
    const enabled = autoJobSolverToggle.checked;
    await chrome.storage.sync.set({ autoJobSolverEnabled: enabled });
    updateAutoJobSolverStatus(enabled);
    if (enabled) renderAutoJobsTabs();
});

// Market tabs
autoJobsTabHome.addEventListener('click', () => switchAutoJobsTab('home'));
autoJobsTabDark.addEventListener('click', () => switchAutoJobsTab('dark'));
autoJobsTabSoyuz.addEventListener('click', () => switchAutoJobsTab('soyuz'));
autoJobsTabUsol.addEventListener('click', () => switchAutoJobsTab('usol'));

function switchAutoJobsTab(market) {
    autoJobsTabHome.classList.toggle('active', market === 'home');
    autoJobsTabDark.classList.toggle('active', market === 'dark');
    autoJobsTabSoyuz.classList.toggle('active', market === 'soyuz');
    autoJobsTabUsol.classList.toggle('active', market === 'usol');
    autoJobsContentHome.classList.toggle('active', market === 'home');
    autoJobsContentDark.classList.toggle('active', market === 'dark');
    autoJobsContentSoyuz.classList.toggle('active', market === 'soyuz');
    autoJobsContentUsol.classList.toggle('active', market === 'usol');
}

async function renderAutoJobsTabs() {
    const { marketData, darkMarketData, darkMarketAvailable, darkMarketMaintenanceEndsAt, darkMarketBlockerServer, soyuzMarketData, soyuzMarketAvailable, soyuzMarketMaintenanceEndsAt, soyuzMarketBlockerServer, usolMarketData, usolMarketAvailable, usolMarketMaintenanceEndsAt, usolMarketBlockerServer, serverMaintenanceMap } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'darkMarketAvailable', 'darkMarketMaintenanceEndsAt', 'darkMarketBlockerServer', 'soyuzMarketData', 'soyuzMarketAvailable', 'soyuzMarketMaintenanceEndsAt', 'soyuzMarketBlockerServer', 'usolMarketData', 'usolMarketAvailable', 'usolMarketMaintenanceEndsAt', 'usolMarketBlockerServer', 'serverMaintenanceMap']);
    renderAutoJobsMarket(autoJobsContentHome, marketData, 'home');
    const darkB = darkMarketAvailable === false ? null : findMaintenanceBlocker(serverMaintenanceMap, 'dark');
    renderAutoJobsMarket(autoJobsContentDark, darkMarketData, 'dark', darkB ? false : darkMarketAvailable, darkB ? darkB.maintenanceEndsAt : darkMarketMaintenanceEndsAt, darkB ? darkB.blockerName : darkMarketBlockerServer);
    const soyuzB = soyuzMarketAvailable === false ? null : findMaintenanceBlocker(serverMaintenanceMap, 'soyuz');
    renderAutoJobsMarket(autoJobsContentSoyuz, soyuzMarketData, 'soyuz', soyuzB ? false : soyuzMarketAvailable, soyuzB ? soyuzB.maintenanceEndsAt : soyuzMarketMaintenanceEndsAt, soyuzB ? soyuzB.blockerName : soyuzMarketBlockerServer);
    const usolB = usolMarketAvailable === false ? null : findMaintenanceBlocker(serverMaintenanceMap, 'usol');
    renderAutoJobsMarket(autoJobsContentUsol, usolMarketData, 'usol', usolB ? false : usolMarketAvailable, usolB ? usolB.maintenanceEndsAt : usolMarketMaintenanceEndsAt, usolB ? usolB.blockerName : usolMarketBlockerServer);
    if (marketData && marketData.market && marketData.market.marketName) {
        autoJobsTabHome.textContent = '🏠 ' + marketData.market.marketName;
    }
    if (darkMarketData && darkMarketData.market && darkMarketData.market.marketName) {
        autoJobsTabDark.textContent = '🌑 ' + darkMarketData.market.marketName;
    }
    if (soyuzMarketData && soyuzMarketData.market && soyuzMarketData.market.marketName) {
        autoJobsTabSoyuz.replaceChildren(_h('span', {style: 'color:#c33b3b;'}, '☭'), ' ' + soyuzMarketData.market.marketName);
    }
    if (usolMarketData && usolMarketData.market && usolMarketData.market.marketName) {
        autoJobsTabUsol.replaceChildren(_h('span', {style: 'color:#2592A7;margin-right:1px'}, '☮'), ' ' + usolMarketData.market.marketName);
    }
}

function renderAutoJobsMarket(container, data, marketKey, marketAvailable, maintenanceEndsAt, blockerServer) {
    _clearEl(container);
    if (marketAvailable === false) {
        let timerHtml = '';
        if (blockerServer) timerHtml += ' (' + blockerServer + ' in maintenance';
        if (maintenanceEndsAt) {
            const diff = new Date(maintenanceEndsAt).getTime() - Date.now();
            if (diff > 0) {
                const mins = Math.ceil(diff / 60000);
                timerHtml += (blockerServer ? ', ' : ' (') + '~' + mins + 'm remaining';
            }
        }
        if (timerHtml) timerHtml += ')';
        const marketLabel = marketKey === 'dark' ? 'D4RK' : marketKey === 'soyuz' ? 'SOYUZ' : marketKey === 'usol' ? 'USOL' : 'HOME';
        container.appendChild(_h('div', {className: 'warning-banner'}, '⚠️ ' + marketLabel + ' market server is currently unreachable' + timerHtml + '.'));
    }
    if (!data || (!data.jobs && !data.recentJobs)) {
        container.appendChild(_h('div', {className: 'auto-jobs-no-jobs'}, 'No jobs available. Click 🔄 to refresh market data.'));
        return;
    }

    if (data.nextJobsResetAt) {
        const timerDiv = document.createElement('div');
        timerDiv.className = 'auto-jobs-reset-timer';
        timerDiv.dataset.resetAt = data.nextJobsResetAt;
        timerDiv.textContent = '⏳ Jobs Reset: ' + formatTimeRemaining(data.nextJobsResetAt);
        container.appendChild(timerDiv);
    }

    const openJobs = (data.jobs || []).filter(j => !j.isCompleted && !j.isExpired);
    const takenJobs = (data.recentJobs || []).filter(j => j.status === 'TAKEN');
    for (const tj of takenJobs) {
        tj._isTaken = true;
    }
    const availableJobs = [...openJobs, ...takenJobs];
    if (availableJobs.length === 0) {
        const noJobsDiv = document.createElement('div');
        noJobsDiv.className = 'auto-jobs-no-jobs';
        noJobsDiv.textContent = 'All jobs completed or expired.';
        container.appendChild(noJobsDiv);
        return;
    }

    const typeMap = {};
    for (const job of availableJobs) {
        const typeName = job.name || 'Unknown';
        if (!typeMap[typeName]) typeMap[typeName] = [];
        typeMap[typeName].push(job);
    }

    const checkboxes = [];

    for (const [typeName, jobs] of Object.entries(typeMap)) {
        const isSupported = SUPPORTED_JOB_TYPES.includes(typeName);
        const row = document.createElement('div');
        row.className = 'auto-jobs-type-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.jobType = typeName;
        cb.dataset.market = marketKey;
        cb.disabled = !isSupported;
        if (isSupported && autoJobsSelectedTypes[marketKey] && autoJobsSelectedTypes[marketKey].includes(typeName)) {
            cb.checked = true;
        }
        cb.addEventListener('change', () => {
            updateAutoJobsSelectedTypes(marketKey, container);
            updateSelectAllState(selectAllCb, checkboxes);
        });

        const label = document.createElement('span');
        label.className = 'job-type-label';
        label.textContent = typeName;

        const takenCount = jobs.filter(j => j._isTaken).length;
        const buggedCount = jobs.filter(j => isJobBugged(j)).length;
        const count = document.createElement('span');
        count.className = 'job-type-count';
        let countText = `(${jobs.length}`;
        if (takenCount > 0) countText += `, ${takenCount} in-progress`;
        if (buggedCount > 0) countText += `, ${buggedCount} bugged`;
        countText += ')';
        count.textContent = countText;

        row.appendChild(label);

        if (!isSupported) {
            const tooltip = document.createElement('span');
            tooltip.className = 'unsupported-tooltip';
            tooltip.textContent = 'Not supported';
            tooltip.title = 'This job type is currently not supported';
            row.appendChild(tooltip);
        } else if (buggedCount > 0 && buggedCount === jobs.length) {
            const tooltip = document.createElement('span');
            tooltip.className = 'unsupported-tooltip';
            tooltip.style.color = 'var(--accent-orange)';
            tooltip.textContent = 'Bugged';
            tooltip.title = 'Log jobs on D4RK RM7CE are bugged (logs tab unavailable)';
            row.appendChild(tooltip);
        }

        row.appendChild(count);
        row.appendChild(cb);

        container.appendChild(row);
        if (isSupported) checkboxes.push(cb);
    }

    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'auto-jobs-select-all';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'selectAll_' + marketKey;
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = "job-type-label";
    selectAllLabel.setAttribute('for', selectAllCb.id);
    selectAllLabel.textContent = 'Select All';
    const totalTaken = takenJobs.length;
    const selectAllCount = document.createElement('span');
    selectAllCount.className = 'job-type-count';
    selectAllCount.textContent = totalTaken > 0 ? `(${availableJobs.length}, ${totalTaken} in-progress)` : `(${availableJobs.length})`;
    selectAllDiv.appendChild(selectAllLabel);
    selectAllDiv.appendChild(selectAllCount);
    selectAllDiv.appendChild(selectAllCb);
    container.appendChild(selectAllDiv);

    selectAllCb.addEventListener('change', () => {
        const checked = selectAllCb.checked;
        for (const cb of checkboxes) {
            cb.checked = checked;
        }
        updateAutoJobsSelectedTypes(marketKey, container);
    });

    updateSelectAllState(selectAllCb, checkboxes);
}

function updateAutoJobsSelectedTypes(marketKey, container) {
    const cbs = container.querySelectorAll('input[type="checkbox"][data-job-type]');
    autoJobsSelectedTypes[marketKey] = [];
    cbs.forEach(cb => {
        if (cb.checked) autoJobsSelectedTypes[marketKey].push(cb.dataset.jobType);
    });
    chrome.storage.sync.set({ autoJobsSelectedTypes });
}

chrome.storage.sync.get('autoJobsSelectedTypes', (data) => {
    if (data.autoJobsSelectedTypes) {
        autoJobsSelectedTypes = data.autoJobsSelectedTypes;
    }
});

// Refresh button
refreshAutoJobsBtn.addEventListener('click', async () => {
    autoJobsContentHome.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'Refreshing (sequential)...'));
    autoJobsContentDark.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'Refreshing (sequential)...'));
    autoJobsContentSoyuz.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'Refreshing (sequential)...'));
    autoJobsContentUsol.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'Refreshing (sequential)...'));
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, { action: "refreshAllMarketsSeq" });
        }
    } catch (e) {}
    await new Promise(r => {
        let done = false;
        const listener = (changes, area) => {
            if (area === 'local' && changes._allMarketsRefreshed) {
                done = true;
                chrome.storage.onChanged.removeListener(listener);
                clearTimeout(tmr);
                r();
            }
        };
        chrome.storage.onChanged.addListener(listener);
        const tmr = setTimeout(() => { if (!done) { chrome.storage.onChanged.removeListener(listener); r(); } }, 30000);
    });
    renderAutoJobsTabs();
});

// Copy all logs button
copyAllLogsBtn.addEventListener('click', async () => {
    if (copyAllLogsBtn.dataset.busy === 'true') return;
    copyAllLogsBtn.dataset.busy = 'true';
    copyAllLogsBtn.textContent = '⏳';
    copyAllLogsBtn.title = 'Collecting logs...';
    const MAX_COPY_BYTES = 10 * 1024 * 1024;
    try {
        const storageKeys = ['autoJobsDebugLogs', 'valuableDebugLogs', 'cor3_errors'];
        const storageData = await chrome.storage.local.get(storageKeys);

        const tab = await getCor3Tab();

        let wsLogs = [];
        let idbAutoJobLogs = [];
        let idbAutoValuableLogs = [];
        let idbErrorLogs = [];
        let idbPageConsoleLogs = [];
        let idbExtConsoleLogs = [];
        try {
            if (tab) {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        return new Promise((resolve) => {
                            const req = indexedDB.open('cor3_ws_db');
                            req.onsuccess = (e) => {
                                const db = e.target.result;
                                const result = { ws: [], autoJobs: [], autoValuable: [], errors: [], pageConsole: [], extConsole: [] };
                                const stores = [];
                                if (db.objectStoreNames.contains('messages')) stores.push('messages');
                                if (db.objectStoreNames.contains('logs')) stores.push('logs');
                                if (stores.length === 0) { db.close(); resolve(result); return; }
                                const tx = db.transaction(stores, 'readonly');
                                let pending = stores.length;
                                const done = () => { if (--pending <= 0) { resolve(result); db.close(); } };
                                if (stores.includes('messages')) {
                                    const idx = tx.objectStore('messages').index('timestamp');
                                    const cur = idx.openCursor();
                                    cur.onsuccess = (ev) => {
                                        const c = ev.target.result;
                                        if (!c) { done(); return; }
                                        result.ws.push({ timestamp: c.value.timestamp, direction: c.value.direction, message: c.value.message });
                                        c.continue();
                                    };
                                    cur.onerror = () => done();
                                }
                                if (stores.includes('logs')) {
                                    const idx2 = tx.objectStore('logs').index('timestamp');
                                    const cur2 = idx2.openCursor();
                                    cur2.onsuccess = (ev) => {
                                        const c = ev.target.result;
                                        if (!c) { done(); return; }
                                        const v = c.value;
                                        const entry = { timestamp: v.timestamp, level: v.level, message: v.message };
                                        if (v.category === 'auto-jobs') result.autoJobs.push(entry);
                                        else if (v.category === 'auto-valuable') result.autoValuable.push(entry);
                                        else if (v.category === 'error-logs') result.errors.push(entry);
                                        else if (v.category === 'page-console') result.pageConsole.push(entry);
                                        else if (v.category === 'ext-console') result.extConsole.push(entry);
                                        c.continue();
                                    };
                                    cur2.onerror = () => done();
                                }
                            };
                            req.onerror = () => resolve({ ws: [], autoJobs: [], autoValuable: [], errors: [], pageConsole: [], extConsole: [] });
                        });
                    },
                    args: []
                });
                if (results && results[0] && results[0].result) {
                    const r = results[0].result;
                    wsLogs = r.ws || [];
                    idbAutoJobLogs = r.autoJobs || [];
                    idbAutoValuableLogs = r.autoValuable || [];
                    idbErrorLogs = r.errors || [];
                    idbPageConsoleLogs = r.pageConsole || [];
                    idbExtConsoleLogs = r.extConsole || [];
                }
            }
        } catch (e) {
            console.log('[COR3 Helper] Could not read logs from IndexedDB:', e);
        }

        const mergedAutoJobLogs = idbAutoJobLogs.length > 0 ? idbAutoJobLogs : (storageData.autoJobsDebugLogs || []);
        const mergedAutoValuableLogs = idbAutoValuableLogs.length > 0 ? idbAutoValuableLogs : (storageData.valuableDebugLogs || []);
        const mergedErrors = idbErrorLogs.length > 0 ? idbErrorLogs : (storageData.cor3_errors || []);

        const payload = {
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            autoJobSolverLogs: mergedAutoJobLogs,
            autoValuableSellerLogs: mergedAutoValuableLogs,
            extensionErrors: mergedErrors,
            wsLogs: wsLogs,
            pageConsoleLogs: idbPageConsoleLogs,
            extensionConsoleLogs: idbExtConsoleLogs
        };

        let json = JSON.stringify(payload, null, 2);

        if (json.length > MAX_COPY_BYTES) {
            const trimmableKeys = ['wsLogs', 'autoJobSolverLogs', 'autoValuableSellerLogs', 'extensionErrors', 'pageConsoleLogs', 'extensionConsoleLogs'];
            const getTs = (entry) => entry.timestamp || entry.ts || '';
            const allTs = [];
            for (const key of trimmableKeys) {
                const arr = payload[key];
                if (arr && arr.length > 0) allTs.push(getTs(arr[0]));
            }
            if (allTs.length > 0) {
                allTs.sort();
                let lo = allTs[0];
                let hi = new Date().toISOString();
                for (let i = 0; i < 20 && json.length > MAX_COPY_BYTES; i++) {
                    const loMs = new Date(lo).getTime();
                    const hiMs = new Date(hi).getTime();
                    const midMs = loMs + Math.floor((hiMs - loMs) / 2);
                    const cutoff = new Date(midMs).toISOString();
                    for (const key of trimmableKeys) {
                        const arr = payload[key];
                        if (!arr || arr.length === 0) continue;
                        const idx = arr.findIndex(e => getTs(e) >= cutoff);
                        if (idx > 0) arr.splice(0, idx);
                    }
                    json = JSON.stringify(payload, null, 2);
                    if (json.length > MAX_COPY_BYTES) lo = cutoff;
                    else break;
                }
                while (json.length > MAX_COPY_BYTES) {
                    let largest = null, largestLen = 0;
                    for (const key of trimmableKeys) {
                        if (payload[key] && payload[key].length > largestLen) { largest = key; largestLen = payload[key].length; }
                    }
                    if (!largest || largestLen <= 1) break;
                    const removeCount = Math.max(1, Math.floor(largestLen * 0.3));
                    payload[largest].splice(0, removeCount);
                    json = JSON.stringify(payload, null, 2);
                }
            }
            console.log('[COR3 Helper] Trimmed logs to ' + (json.length / 1024 / 1024).toFixed(2) + ' MB');
        }

        const wrapped = '```json\n' + json + '\n```';
        await navigator.clipboard.writeText(wrapped);

        const sizeMB = (wrapped.length / 1024 / 1024).toFixed(1);
        copyAllLogsBtn.textContent = '✅';
        copyAllLogsBtn.title = 'Logs copied (' + sizeMB + ' MB)';
        setTimeout(() => {
            copyAllLogsBtn.textContent = '📋';
            copyAllLogsBtn.title = 'Copy all debug logs to clipboard';
            copyAllLogsBtn.dataset.busy = 'false';
        }, 2000);
    } catch (e) {
        console.log('[COR3 Helper] Copy all logs failed:', e);
        cor3LogError('popup.js', e, { action: 'copyAllLogs' });
        copyAllLogsBtn.textContent = '❌';
        copyAllLogsBtn.title = 'Failed to copy logs';
        setTimeout(() => {
            copyAllLogsBtn.textContent = '📋';
            copyAllLogsBtn.title = 'Copy all debug logs to clipboard';
            copyAllLogsBtn.dataset.busy = 'false';
        }, 2000);
    }
});

// Start/Stop button
autoJobsStartBtn.addEventListener('click', async () => {
    if (autoJobsRunning) {
        autoJobsRunning = false;
        autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start start';
        addAutoJobLog('Auto Jobs stopped by user.', 'warn');
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: "stopAutoJobs" });
        } catch (e) {}
        await chrome.storage.local.set({ autoJobsRunning: false });
    } else {
        autoJobsRunning = true;
        autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start stop';

        const { marketData, darkMarketData, soyuzMarketData, usolMarketData } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData']);
        const jobsToRun = [];
        const seenTakenJobIds = new Set();

        for (const marketKey of ['home', 'dark', 'soyuz', 'usol']) {
            const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : marketKey === 'usol' ? usolMarketData : soyuzMarketData;
            if (!md) continue;
            const selectedTypes = autoJobsSelectedTypes[marketKey] || [];
            if (selectedTypes.length === 0) continue;

            const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && selectedTypes.includes(j.name));
            const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && selectedTypes.includes(j.name));

            for (const job of openJobs) {
                const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
                const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                    : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
                jobsToRun.push({
                    jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                    marketId: MARKET_IDS[marketKey], marketKey,
                    rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                    deposit: job.deposit || 0,
                    conditions: job.conditions ? job.conditions.items || job.conditions : [],
                    alreadyTaken: false, canComplete: false, status: 'pending'
                });
            }

            for (const job of takenJobs) {
                if (seenTakenJobIds.has(job.id)) continue;
                seenTakenJobIds.add(job.id);
                const trueMarketKey = resolveRecentJobMarket(job, marketKey, { marketData, darkMarketData, soyuzMarketData, usolMarketData });
                const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
                const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                    : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
                if (!selectedTypes.includes(job.name) && trueMarketKey !== marketKey) continue;
                jobsToRun.push({
                    jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                    marketId: MARKET_IDS[trueMarketKey], marketKey: trueMarketKey,
                    rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                    deposit: job.deposit || 0,
                    conditions: job.conditions ? job.conditions.items || job.conditions : [],
                    alreadyTaken: true, canComplete: !!job.canComplete, status: 'pending'
                });
            }
        }

        jobsToRun.sort((a, b) => {
            const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
            if (sp !== 0) return sp;
            return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
        });

        if (jobsToRun.length === 0) {
            addAutoJobLog('No jobs selected or available to run.', 'warn');
            autoJobsRunning = false;
            autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start start';
            return;
        }
        const newJobIds = new Set(jobsToRun.map(j => j.jobId));
        const previousJobs = autoJobsTracker.filter(j =>
            !newJobIds.has(j.jobId) && (j.status === 'done' || j.status === 'failed')
        );
        autoJobsTracker = [...previousJobs, ...jobsToRun];
        renderDebugJobs();
        addAutoJobLog(`Starting auto jobs: ${jobsToRun.length} job(s) queued.`, 'info');

        await chrome.storage.local.set({ autoJobsRunning: true, autoJobsQueue: jobsToRun, autoJobsTracker: autoJobsTracker });
        try {
            const tab = await getCor3Tab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: "startAutoJobs",
                    jobs: jobsToRun,
                    settings: {}
                });
            }
        } catch (e) {
            addAutoJobLog('Failed to send auto jobs to content script: ' + e.message, 'error');
        }
    }
});

// Debug console toggle
chrome.storage.sync.get('autoJobsDebugConsoleEnabled', (data) => {
    const enabled = !!data.autoJobsDebugConsoleEnabled;
    autoJobsDebugToggle.checked = enabled;
    autoJobsDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) {
        renderDebugJobs();
        renderDebugLogs();
    }
});
autoJobsDebugToggle.addEventListener('change', () => {
    const enabled = autoJobsDebugToggle.checked;
    chrome.storage.sync.set({ autoJobsDebugConsoleEnabled: enabled });
    autoJobsDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) {
        renderDebugJobs();
        renderDebugLogs();
    }
});

// Debug console tabs
debugTabJobs.addEventListener('click', () => {
    debugTabJobs.classList.add('active');
    debugTabLogs.classList.remove('active');
    debugJobsBody.classList.add('active');
    debugLogsBody.classList.remove('active');
});
debugTabLogs.addEventListener('click', () => {
    debugTabLogs.classList.add('active');
    debugTabJobs.classList.remove('active');
    debugLogsBody.classList.add('active');
    debugJobsBody.classList.remove('active');
});

// --- Auto Finish All Jobs ---
chrome.storage.sync.get('autoFinishAllJobsEnabled', (data) => {
    autoFinishAllActive = !!data.autoFinishAllJobsEnabled;
    autoFinishAllJobsToggle.checked = autoFinishAllActive;
});

autoFinishAllJobsToggle.addEventListener('change', async () => {
    autoFinishAllActive = autoFinishAllJobsToggle.checked;
    await chrome.storage.sync.set({ autoFinishAllJobsEnabled: autoFinishAllActive });
    if (autoFinishAllActive) {
        addAutoJobLog('🔄 Auto Finish All Jobs enabled', 'info');
    } else {
        addAutoJobLog('🔄 Auto Finish All Jobs disabled', 'warn');
    }
    chrome.runtime.sendMessage({ action: "scheduleAutoFinishAll" }).catch(() => {});
});

// --- Per-Market Cleanup (Dismiss Failed Jobs) ---
async function dismissFailedJobsForMarket(marketKey, btn) {
    const storageKey = { home: 'marketData', dark: 'darkMarketData', soyuz: 'soyuzMarketData', usol: 'usolMarketData' }[marketKey];
    const data = await chrome.storage.local.get(storageKey);
    const md = data[storageKey];
    if (!md || !md.recentJobs) return;
    const failedJobs = md.recentJobs.filter(j => j.status === 'FAILED');
    if (failedJobs.length === 0) return;
    const marketId = MARKET_IDS[marketKey];
    if (!marketId) return;
    const tab = await getCor3Tab();
    if (!tab) return;

    const dismissList = failedJobs.map(j => ({ marketId, jobId: j.id }));

    let resp;
    try {
        resp = await chrome.tabs.sendMessage(tab.id, {
            action: 'dismissFailedJobs',
            jobs: dismissList,
            marketKey: marketKey
        });
    } catch (e) {
        console.log('[COR3 Helper] dismissFailedJobs sendMessage error:', e);
        return;
    }

    if (resp && (resp.queueResult === 'queued' || resp.queueResult === 'already-running')) {
        const activeType = resp.queueStatus && resp.queueStatus.active ? resp.queueStatus.active : 'another automation';
        const friendlyNames = { 'auto-jobs': 'Auto Job Solver', 'auto-valuable': 'Auto Valuable Seller', 'auto-update-markets': 'Auto Update Markets', 'auto-send': 'Auto Send Mercenary', 'clear-failed-jobs': 'Clear Failed Jobs' };
        const activeName = friendlyNames[activeType] || activeType;
        if (btn) {
            btn.title = 'Delayed — waiting for "' + activeName + '" to finish';
            btn.style.cursor = 'help';
        }
    }

    while (true) {
        await new Promise(r => setTimeout(r, 1500));
        const qs = await chrome.storage.local.get('automationQueueStatus');
        const status = qs.automationQueueStatus || {};
        if (status.active !== 'clear-failed-jobs' && !(status.queued || []).includes('clear-failed-jobs')) break;
    }

    addAutoJobLog(`🧹 Dismissed ${failedJobs.length} failed job(s) from ${marketKey} market`, 'info');
}
['home', 'dark', 'soyuz', 'usol'].forEach(key => {
    const btnId = { home: 'cleanupCoreMarketBtn', dark: 'cleanupDarkMarketBtn', soyuz: 'cleanupSoyuzMarketBtn', usol: 'cleanupUsolMarketBtn' }[key];
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = '⏳';
            const origTitle = btn.title;
            try { await dismissFailedJobsForMarket(key, btn); } catch (e) { console.log('[COR3 Helper] Cleanup error:', e); cor3LogError('popup.js', e, { action: 'dismissFailedJobs', market: key }); }
            btn.disabled = false;
            btn.textContent = '🧹';
            btn.title = origTitle;
            btn.style.cursor = '';
        });
    }
});

function collectAllSupportedJobsUnfiltered(marketData, darkMarketData, soyuzMarketData, usolMarketData) {
    const jobs = [];
    const seenTakenIds = new Set();
    for (const marketKey of ['dark', 'home', 'soyuz', 'usol']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : marketKey === 'usol' ? usolMarketData : soyuzMarketData;
        if (!md) continue;
        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES.includes(j.name));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES.includes(j.name) && !seenTakenIds.has(j.id));
        for (const j of openJobs) {
            const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
            jobs.push({ name: j.name, type: j.name, serverName: sn, relatedServers: j.relatedServers });
        }
        for (const j of takenJobs) {
            seenTakenIds.add(j.id);
            const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
            jobs.push({ name: j.name, type: j.name, serverName: sn, relatedServers: j.relatedServers });
        }
    }
    return jobs;
}

function collectAllSupportedJobs(marketData, darkMarketData, soyuzMarketData, usolMarketData) {
    const jobsToRun = [];
    const seenTakenIds = new Set();
    const allMd = { marketData, darkMarketData, soyuzMarketData, usolMarketData };
    for (const marketKey of ['dark', 'home', 'soyuz', 'usol']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : marketKey === 'usol' ? usolMarketData : soyuzMarketData;
        if (!md) continue;

        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES.includes(j.name) && !isJobBugged(j));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES.includes(j.name) && !isJobBugged(j));

        for (const job of openJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
            jobsToRun.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[marketKey], marketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: false, canComplete: false, status: 'pending'
            });
        }

        for (const job of takenJobs) {
            if (seenTakenIds.has(job.id)) continue;
            seenTakenIds.add(job.id);
            const trueMarketKey = resolveRecentJobMarket(job, marketKey, allMd);
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
                : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
            jobsToRun.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[trueMarketKey], marketKey: trueMarketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: true, canComplete: !!job.canComplete, status: 'pending'
            });
        }
    }
    jobsToRun.sort((a, b) => {
        const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
        if (sp !== 0) return sp;
        return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
    });
    return jobsToRun;
}

function addAutoJobLog(msg, level = 'info') {
    autoJobsDebugLogs.push({ timestamp: new Date().toISOString(), msg, level });
    if (autoJobsDebugLogs.length > AUTO_JOBS_MAX_LOGS) {
        autoJobsDebugLogs.shift();
    }
    renderDebugLogs();
    chrome.storage.local.set({ autoJobsDebugLogs });
}

export function renderDebugLogs() {
    if (autoJobsDebugLogs.length === 0) {
        debugLogsBody.replaceChildren(_h('div', {style: 'color:var(--text-dim);'}, 'No logs yet.'));
        return;
    }
    const frag = document.createDocumentFragment();
    for (const log of autoJobsDebugLogs) {
        const row = document.createElement('div');
        let levelClass = '';
        if (log.level === 'error') levelClass = ' log-error';
        else if (log.level === 'success') levelClass = ' log-success';
        else if (log.level === 'warn') levelClass = ' log-warn';
        row.className = 'debug-log-row' + levelClass;
        const displayTime = log.timestamp ? log.timestamp.slice(11, 19) : (log.time || '');
        row.appendChild(_h('span', {className: 'log-time'}, '[' + displayTime + ']'));
        row.appendChild(document.createTextNode(' ' + log.msg));
        frag.appendChild(row);
    }
    debugLogsBody.replaceChildren(frag);
    debugLogsBody.scrollTop = debugLogsBody.scrollHeight;
}

let _renderDebugJobsId = 0;
export async function renderDebugJobs() {
    const renderId = ++_renderDebugJobsId;

    const storageData = await chrome.storage.local.get(['autoJobsCompletedResults', 'marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData', 'autoJobsTracker']);
    if (renderId !== _renderDebugJobsId) return;

    const { autoJobsCompletedResults, marketData, darkMarketData, soyuzMarketData, usolMarketData } = storageData;

    if (storageData.autoJobsTracker) {
        autoJobsTracker = storageData.autoJobsTracker;
    }

    const completedMap = {};
    if (autoJobsCompletedResults) {
        for (const cj of autoJobsCompletedResults) {
            completedMap[cj.jobId] = cj;
        }
    }
    const trackerMap = {};
    for (const tj of autoJobsTracker) {
        trackerMap[tj.jobId] = tj;
    }

    const marketSources = [
        { key: 'home', label: () => ['🏠 HOME'], data: marketData },
        { key: 'dark', label: () => ['🌑 D4RK'], data: darkMarketData },
        { key: 'soyuz', label: () => [_h('span', {style: 'color:#c33b3b;margin-left:2px;margin-right:2px'}, '☭'), ' SOYUZ'], data: soyuzMarketData },
        { key: 'usol', label: () => [_h('span', {style: 'color:#2592A7;margin-right:2px'}, '☮'), ' USOL'], data: usolMarketData }
    ];

    let hasAny = false;
    const frag = document.createDocumentFragment();

    for (const ms of marketSources) {
        const allJobs = [];
        const seenIds = new Set();

        function resolveStatus(jobId, fallbackStatus) {
            const completed = completedMap[jobId];
            if (completed) return { status: completed.status, reward: completed.reward, error: completed.error, lockExpiresAt: completed.lockExpiresAt || null, maintenanceEndsAt: completed.maintenanceEndsAt || null };
            const tracked = trackerMap[jobId];
            if (tracked && tracked.status && tracked.status !== 'pending') {
                return { status: tracked.status, reward: tracked.reward || null, error: tracked.error || null, lockExpiresAt: tracked.lockExpiresAt || null, maintenanceEndsAt: tracked.maintenanceEndsAt || null };
            }
            return { status: fallbackStatus, reward: (tracked && tracked.reward) || null, error: (tracked && tracked.error) || null, lockExpiresAt: (tracked && tracked.lockExpiresAt) || null, maintenanceEndsAt: (tracked && tracked.maintenanceEndsAt) || null };
        }

        if (ms.data && ms.data.jobs) {
            for (const j of ms.data.jobs) {
                if (j.isCompleted || j.isExpired) continue;
                const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
                const resolved = resolveStatus(j.id, 'open');
                allJobs.push({ id: j.id, name: j.name, type: j.jobType || j.name, serverName: sn, status: resolved.status, reward: resolved.reward, error: resolved.error, lockExpiresAt: resolved.lockExpiresAt, maintenanceEndsAt: resolved.maintenanceEndsAt });
                seenIds.add(j.id);
            }
        }

        if (ms.data && ms.data.recentJobs) {
            for (const j of ms.data.recentJobs) {
                if ((j.status !== 'TAKEN' && j.status !== 'COMPLETED') || seenIds.has(j.id)) continue;
                const sn = (j.relatedServers && j.relatedServers[0]) ? j.relatedServers[0].serverName : 'None';
                const marketStatus = j.status === 'COMPLETED' ? 'done' : 'in-progress';
                const resolved = resolveStatus(j.id, marketStatus);
                allJobs.push({ id: j.id, name: j.name, type: j.jobType || j.name, serverName: sn, status: resolved.status, reward: resolved.reward, error: resolved.error, lockExpiresAt: resolved.lockExpiresAt, maintenanceEndsAt: resolved.maintenanceEndsAt });
                seenIds.add(j.id);
            }
        }

        for (const tj of autoJobsTracker) {
            if ((tj.marketKey || 'home') !== ms.key || seenIds.has(tj.jobId)) continue;
            const resolved = resolveStatus(tj.jobId, tj.status === 'pending' ? 'open' : (tj.status || 'open'));
            allJobs.push({ id: tj.jobId, name: tj.name, type: tj.type || tj.name, serverName: tj.serverName || 'None', status: resolved.status, reward: resolved.reward, error: resolved.error, lockExpiresAt: resolved.lockExpiresAt, maintenanceEndsAt: resolved.maintenanceEndsAt });
            seenIds.add(tj.jobId);
        }

        if (autoJobsCompletedResults) {
            for (const cj of autoJobsCompletedResults) {
                if (cj.marketKey !== ms.key || seenIds.has(cj.jobId)) continue;
                allJobs.push({
                    id: cj.jobId, name: cj.name, type: cj.type || cj.name,
                    serverName: cj.serverName || 'None',
                    status: cj.status, reward: cj.reward, error: cj.error,
                    lockExpiresAt: cj.lockExpiresAt || null, maintenanceEndsAt: cj.maintenanceEndsAt || null
                });
                seenIds.add(cj.jobId);
            }
        }

        if (allJobs.length === 0) continue;
        hasAny = true;

        allJobs.sort((a, b) => {
            const sp = getServerPriority(a.serverName) - getServerPriority(b.serverName);
            if (sp !== 0) return sp;
            return getJobTypePriority(a.type || a.name) - getJobTypePriority(b.type || b.name);
        });

        const group = document.createElement('div');
        group.className = 'debug-market-group';
        const title = document.createElement('div');
        title.className = 'debug-market-group-title';
        title.replaceChildren(...ms.label(), ' (' + allJobs.length + ')');
        group.appendChild(title);

        for (const job of allJobs) {
            group.appendChild(createDebugJobRow(job));
        }
        frag.appendChild(group);
    }

    if (!hasAny) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--text-dim)';
        empty.textContent = 'No job data yet.';
        frag.appendChild(empty);
    }
    debugJobsBody.replaceChildren(frag);
}

function createDebugJobRow(job) {
    const row = document.createElement('div');
    row.className = 'debug-job-row';

    const statusEl = document.createElement('span');
    let st = job.status || 'open';
    if (st === 'open' && isJobBugged(job)) st = 'bugged';
    statusEl.className = 'debug-job-status ' + st;
    statusEl.textContent = st.toUpperCase();
    if (job.lockExpiresAt || job.maintenanceEndsAt) {
        const expiryDate = job.lockExpiresAt || job.maintenanceEndsAt;
        const label = job.lockExpiresAt ? 'Minigame lock' : 'Maintenance';
        const diff = new Date(expiryDate).getTime() - Date.now();
        const mins = diff > 0 ? Math.ceil(diff / 60000) : 0;
        statusEl.title = mins > 0 ? `${label} (~${mins}m remaining)` : `${label} (expired)`;
        statusEl.style.cursor = 'help';
    } else if (job.error) {
        statusEl.title = job.error;
        statusEl.style.cursor = 'help';
    }
    row.appendChild(statusEl);

    const info = document.createElement('span');
    info.style.cssText = 'font-size:10px;color:var(--text-secondary);flex:1;';
    info.textContent = `${job.name} — ${job.serverName}`;
    row.appendChild(info);

    if (job.status === 'failed' || job.status === 'skipped') {
        const penaltyVal = job.reputationPenalty || (job.reward && job.reward.deposit) || job.deposit || 0;
        if (penaltyVal > 0) {
            const penEl = document.createElement('span');
            penEl.style.cssText = 'font-size:9px;color:var(--accent-red, #f38ba8);white-space:nowrap;';
            penEl.textContent = `-${penaltyVal}`;
            row.appendChild(penEl);
        }
    } else if (job.reward) {
        const rewardEl = document.createElement('span');
        rewardEl.style.cssText = 'font-size:9px;color:var(--accent-green);white-space:nowrap;';
        const dep = job.reward.deposit ? ` (-${job.reward.deposit})` : '';
        rewardEl.textContent = `💰${job.reward.credits}${dep} ⭐${job.reward.reputation || 0} 🏅${job.reward.renown || 0}`;
        row.appendChild(rewardEl);
    }

    return row;
}

// Listen for auto-job updates from content script via storage changes
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.autoJobsTracker) {
        autoJobsTracker = changes.autoJobsTracker.newValue || [];
        renderDebugJobs();
    }

    if (changes.autoJobsDebugLogs) {
        const newLogs = changes.autoJobsDebugLogs.newValue;
        if (Array.isArray(newLogs)) {
            autoJobsDebugLogs = newLogs;
            renderDebugLogs();
        }
    }

    if (changes.autoJobsRunning) {
        const running = changes.autoJobsRunning.newValue;
        autoJobsRunning = !!running;
        if (autoJobsRunning) {
            autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start stop';
        } else {
            autoJobsStartBtn.textContent = '▶ Start Auto Jobs';
            autoJobsStartBtn.className = 'auto-jobs-btn-start start';
        }
    }

    if (changes.marketData || changes.darkMarketData || changes.soyuzMarketData || changes.usolMarketData) {
        const now = Date.now();
        const checkReset = (change, marketKey) => {
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
        const homeReset = checkReset(changes.marketData, 'home');
        const darkReset = checkReset(changes.darkMarketData, 'dark');
        const soyuzReset = checkReset(changes.soyuzMarketData, 'soyuz');
        const usolReset = checkReset(changes.usolMarketData, 'usol');
        if (homeReset || darkReset || soyuzReset || usolReset) {
            const resetMarkets = [homeReset && 'HOME', darkReset && 'D4RK', soyuzReset && 'SOYUZ', usolReset && 'USOL'].filter(Boolean).join(', ');
            addAutoJobLog('Job reset detected (' + resetMarkets + ') — clearing old tracker/results', 'info');
            autoJobsTracker = autoJobsTracker.filter(j => {
                if (homeReset && (j.marketKey || 'home') === 'home') return false;
                if (darkReset && j.marketKey === 'dark') return false;
                if (soyuzReset && j.marketKey === 'soyuz') return false;
                if (usolReset && j.marketKey === 'usol') return false;
                return true;
            });
            chrome.storage.local.get('autoJobsCompletedResults', (result) => {
                let cr = Array.isArray(result.autoJobsCompletedResults) ? result.autoJobsCompletedResults : [];
                if (homeReset) cr = cr.filter(j => j.marketKey !== 'home');
                if (darkReset) cr = cr.filter(j => j.marketKey !== 'dark');
                if (soyuzReset) cr = cr.filter(j => j.marketKey !== 'soyuz');
                if (usolReset) cr = cr.filter(j => j.marketKey !== 'usol');
                chrome.storage.local.set({ autoJobsCompletedResults: cr, autoJobsTracker: autoJobsTracker });
                if (autoJobSolverToggle.checked) renderAutoJobsTabs();
                if (autoJobsDebugToggle.checked) renderDebugJobs();
            });
        } else {
            if (autoJobSolverToggle.checked) renderAutoJobsTabs();
            if (autoJobsDebugToggle.checked) renderDebugJobs();
        }
    }

    if (changes.autoJobsCompletedResults) {
        if (autoJobsDebugToggle.checked) {
            renderDebugJobs();
        }
    }

    if (changes.darkMarketAvailable || changes.soyuzMarketAvailable || changes.usolMarketAvailable || changes.serverMaintenanceMap) {
        if (autoJobSolverToggle.checked) renderAutoJobsTabs();
    }
});

// Restore debug logs from storage on popup open
chrome.storage.local.get(['autoJobsDebugLogs', 'autoJobsTracker', 'autoJobsRunning'], (data) => {
    if (data.autoJobsDebugLogs) {
        autoJobsDebugLogs = data.autoJobsDebugLogs;
        renderDebugLogs();
    }
    if (data.autoJobsTracker) {
        autoJobsTracker = data.autoJobsTracker;
        renderDebugJobs();
    }
    if (data.autoJobsRunning) {
        autoJobsRunning = true;
        autoJobsStartBtn.textContent = '■ Stop Auto Jobs';
        autoJobsStartBtn.className = 'auto-jobs-btn-start stop';
    }
});
