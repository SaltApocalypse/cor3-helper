// --- Auto Valuable Seller UI ---
import { _h, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab, updateSelectAllState } from './utils.js';

const valuableToggle = document.getElementById('autoValuableSellerToggle');
const valuableStatus = document.getElementById('autoValuableSellerStatus');
const valuableSection = document.getElementById('autoValuableSellerSection');
const valuableTabServers = document.getElementById('valuableTabServers');
const valuableTabDownloads = document.getElementById('valuableTabDownloads');
const valuableTabMaintenance = document.getElementById('valuableTabMaintenance');
const valuableContentServers = document.getElementById('valuableContentServers');
const valuableContentDownloads = document.getElementById('valuableContentDownloads');
const valuableContentMaintenance = document.getElementById('valuableContentMaintenance');
const valuableSellerBtn = document.getElementById('valuableSellerBtn');
const valuableSearchBtn = document.getElementById('valuableSearchBtn');
const valuableDebugToggle = document.getElementById('valuableDebugToggle');
const valuableDebugConsole = document.getElementById('valuableDebugConsole');
const valuableDebugLogsBody = document.getElementById('valuableDebugLogsBody');

let valuableSearchRunning = false;
let valuableSellerRunning = false;
let valuableDebugLogs = [];
const VALUABLE_MAX_LOGS = 200;

function updateValuableStatus(enabled) {
    valuableStatus.textContent = enabled ? 'Active' : 'Off';
    valuableStatus.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
    valuableSection.style.display = enabled ? '' : 'none';
    var card = valuableSection.closest('.popout-card');
    if (card) card.style.display = enabled ? '' : 'none';
}

chrome.storage.sync.get('autoValuableSellerEnabled', (data) => {
    const enabled = !!data.autoValuableSellerEnabled;
    valuableToggle.checked = enabled;
    updateValuableStatus(enabled);
    if (enabled) renderValuableTabs();
});

valuableToggle.addEventListener('change', async () => {
    const enabled = valuableToggle.checked;
    await chrome.storage.sync.set({ autoValuableSellerEnabled: enabled });
    updateValuableStatus(enabled);
    if (enabled) renderValuableTabs();
});

// Tab switching
function switchValuableTab(tab) {
    valuableTabServers.classList.toggle('active', tab === 'servers');
    valuableTabDownloads.classList.toggle('active', tab === 'downloads');
    valuableTabMaintenance.classList.toggle('active', tab === 'maintenance');
    valuableContentServers.classList.toggle('active', tab === 'servers');
    valuableContentDownloads.classList.toggle('active', tab === 'downloads');
    valuableContentMaintenance.classList.toggle('active', tab === 'maintenance');
}

valuableTabServers.addEventListener('click', () => switchValuableTab('servers'));
valuableTabDownloads.addEventListener('click', () => switchValuableTab('downloads'));
valuableTabMaintenance.addEventListener('click', () => switchValuableTab('maintenance'));

// Render tabs from storage data
async function renderValuableTabs() {
    const data = await chrome.storage.local.get(['valuableServersData', 'valuableDownloadsData', 'valuableMaintenanceData']);
    renderValuableServers(data.valuableServersData);
    renderValuableDownloads(data.valuableDownloadsData);
    renderValuableMaintenance(data.valuableMaintenanceData);
}

function renderValuableServers(data) {
    _clearEl(valuableContentServers);
    if (!data || !data.servers || data.servers.length === 0) {
        valuableContentServers.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'No valuable data yet. Click "Start Valuable Search" to scan servers.'));
        return;
    }

    // Select-all checkbox
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'auto-valuable-seller-select-all';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'valuableSelectAllServers';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'job-type-label';
    selectAllLabel.setAttribute('for', selectAllCb.id);
    selectAllLabel.textContent = 'Select All';
    const selectAllCount = document.createElement('span');
    selectAllCount.className = 'job-type-count';
    selectAllCount.textContent = `(${data.servers.length} servers)`;
    selectAllDiv.appendChild(selectAllLabel);
    selectAllDiv.appendChild(selectAllCount);
    selectAllDiv.appendChild(selectAllCb);

    const checkboxes = [];

    for (const server of data.servers) {
        const row = document.createElement('div');
        row.className = 'valuable-server-row';

        const header = document.createElement('div');
        header.className = 'valuable-server-header';

        const arrow = document.createElement('span');
        arrow.className = 'expand-arrow';
        arrow.textContent = '▶';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'server-name';
        nameSpan.textContent = server.name;

        const countSpan = document.createElement('span');
        countSpan.className = 'valuable-count';
        const totalValuables = (server.files || []).length + (server.logs || []).length;
        countSpan.textContent = `(${totalValuables})`;

        const statusSpan = document.createElement('span');
        const statusClass = (server.status || 'open').toLowerCase().replace(/\s+/g, '-');
        statusSpan.className = 'valuable-status ' + statusClass;
        statusSpan.textContent = (server.status || 'OPEN').toUpperCase();

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.serverId = server.id;
        cb.checked = !!server.selected;
        cb.addEventListener('change', () => {
            updateValuableServerSelection();
            updateSelectAllState(selectAllCb, checkboxes);
        });
        checkboxes.push(cb);

        header.appendChild(arrow);
        header.appendChild(nameSpan);
        header.appendChild(countSpan);
        header.appendChild(statusSpan);
        header.appendChild(cb);

        const detailDiv = document.createElement('div');
        detailDiv.className = 'valuable-detail-table';

        // Build table for files and logs
        if (totalValuables > 0) {
            let tableHtml = '<table><tr><th>Type</th><th>Name</th><th>Tags</th><th>Base Price</th><th>Detect Rate</th></tr>';
            for (const f of (server.files || [])) {
                const tags = (f.tags || []).map(t => t.label || t.key || t).join(', ');
                tableHtml += `<tr><td>📄 File</td><td>${f.name || '—'}</td><td>${tags || '—'}</td><td>${f.basePrice || 0}</td><td>${f.detectRate || 0}</td></tr>`;
            }
            for (const l of (server.logs || [])) {
                const tags = (l.tags || []).map(t => t.label || t.key || t).join(', ');
                tableHtml += `<tr><td>📋 Log</td><td>${l.message || '—'}</td><td>${tags || '—'}</td><td>${l.basePrice || 0}</td><td>${l.detectRate || 0}</td></tr>`;
            }
            tableHtml += '</table>';
            _safeSetHtml(detailDiv, tableHtml);
        }

        // Click header to expand/collapse
        header.addEventListener('click', (e) => {
            if (e.target.tagName === 'INPUT') return;
            arrow.classList.toggle('open');
            detailDiv.classList.toggle('open');
        });

        row.appendChild(header);
        row.appendChild(detailDiv);
        valuableContentServers.appendChild(row);
    }

    valuableContentServers.appendChild(selectAllDiv);

    // Wire select-all
    selectAllCb.addEventListener('change', () => {
        for (const cb of checkboxes) cb.checked = selectAllCb.checked;
        updateValuableServerSelection();
    });
    updateSelectAllState(selectAllCb, checkboxes);
}

// Server path lengths for proximity sorting (shorter = closer)
const VALUABLE_SERVER_PATH_LENGTHS = {
    'RM7-E1L3': 1, 'RM7-E1L5': 1,
    'RM7-E1L2CT': 2, 'RM7-E1SCP': 2, 'RM7-N2ECP': 2,
    'RM7-S4L4': 3, 'D4RK RM7CE': 3, 'RM7-N2L2': 3, 'RM7-S4L2': 3, 'B43271N': 3,
    'RM7-N2L3': 4, 'RM7-S4L3': 4, 'RM7-S4L1': 4, 'RM7-S4WCP': 4, 'B43272N': 4,
    'RM7-W3NCP': 5, 'URM7-S5L2': 5, 'URM7-H': 5, 'D4RK RM7EG': 5,
    'RM7-N1L1': 6, 'URM7-M': 6, 'B43274N': 6
};

function renderValuableDownloads(data) {
    _clearEl(valuableContentDownloads);
    if (!data || !data.files || data.files.length === 0) {
        valuableContentDownloads.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'No download data yet. Click "Start Valuable Search" to scan.'));
        return;
    }

    // Select-all
    const selectAllDiv = document.createElement('div');
    selectAllDiv.className = 'auto-valuable-seller-select-all';
    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.id = 'valuableSelectAllDownloads';
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'job-type-label';
    selectAllLabel.setAttribute('for', selectAllCb.id);
    selectAllLabel.textContent = 'Select All';
    const selectAllCount = document.createElement('span');
    selectAllCount.className = 'job-type-count';
    selectAllCount.textContent = `(${data.files.length} files)`;
    selectAllDiv.appendChild(selectAllLabel);
    selectAllDiv.appendChild(selectAllCount);
    selectAllDiv.appendChild(selectAllCb);

    const checkboxes = [];

    // Group files by source server
    const serverGroups = {};
    for (const file of data.files) {
        const source = file.source || '—';
        if (!serverGroups[source]) serverGroups[source] = [];
        serverGroups[source].push(file);
    }

    // Sort server groups by proximity (closest first for display)
    const sortedSources = Object.keys(serverGroups).sort((a, b) => {
        const lenA = VALUABLE_SERVER_PATH_LENGTHS[a] || 99;
        const lenB = VALUABLE_SERVER_PATH_LENGTHS[b] || 99;
        return lenB - lenA;
    });

    // Render grouped by server
    for (const source of sortedSources) {
        const groupFiles = serverGroups[source];

        // Server group header
        const groupDiv = document.createElement('div');
        groupDiv.className = 'valuable-dl-server-group';
        const headerDiv = document.createElement('div');
        headerDiv.className = 'valuable-dl-server-header';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'dl-server-name';
        nameSpan.textContent = source;
        const countSpan = document.createElement('span');
        countSpan.className = 'dl-server-count';
        countSpan.textContent = `(${groupFiles.length})`;
        headerDiv.appendChild(nameSpan);
        headerDiv.appendChild(countSpan);
        groupDiv.appendChild(headerDiv);

        // File rows under this server
        for (const file of groupFiles) {
            const row = document.createElement('div');
            row.className = 'valuable-file-row';

            const nameEl = document.createElement('span');
            nameEl.className = 'file-source';
            nameEl.textContent = file.name || file.id;

            const tagSpan = document.createElement('span');
            tagSpan.className = 'file-tag';
            const tags = (file.tags || []).map(t => t.label || t.key || t).join(', ');
            tagSpan.textContent = tags || '—';

            const statusSpan = document.createElement('span');
            const statusClass = (file.status || 'open').toLowerCase().replace(/\s+/g, '-');
            statusSpan.className = 'valuable-status ' + statusClass;
            statusSpan.textContent = (file.status || 'OPEN').toUpperCase();

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.fileId = file.id;
            cb.checked = !!file.selected;
            cb.addEventListener('change', () => {
                updateValuableDownloadSelection();
                updateSelectAllState(selectAllCb, checkboxes);
            });
            checkboxes.push(cb);

            row.appendChild(nameEl);
            row.appendChild(tagSpan);
            row.appendChild(statusSpan);
            row.appendChild(cb);
            groupDiv.appendChild(row);
        }

        valuableContentDownloads.appendChild(groupDiv);
    }

    valuableContentDownloads.appendChild(selectAllDiv);

    selectAllCb.addEventListener('change', () => {
        for (const cb of checkboxes) cb.checked = selectAllCb.checked;
        updateValuableDownloadSelection();
    });
    updateSelectAllState(selectAllCb, checkboxes);
}

let _maintTimerInterval = null;

function renderValuableMaintenance(data) {
    _clearEl(valuableContentMaintenance);
    if (_maintTimerInterval) { clearInterval(_maintTimerInterval); _maintTimerInterval = null; }

    if (!data || !data.servers || data.servers.length === 0) {
        valuableContentMaintenance.replaceChildren(_h('div', {className: 'auto-jobs-no-jobs'}, 'Run "Start Valuable Search" to see the maintenance status of servers. If no servers are shown after the search, there is no upcoming or active maintenance.'));
        return;
    }

    const timerEls = [];
    let hasUpcoming = false;

    for (const srv of data.servers) {
        const row = document.createElement('div');
        row.className = 'maint-row';
        const isUpcoming = srv.timeUntilMaintenance && !srv.maintenanceEndsAt;

        const nameEl = document.createElement('span');
        nameEl.className = 'maint-name';
        nameEl.textContent = srv.serverName;

        const timerEl = document.createElement('span');
        timerEl.className = 'maint-timer';
        timerEl.dataset.target = srv.maintenanceEndsAt || srv.timeUntilMaintenance || '';
        timerEls.push(timerEl);

        const statusEl = document.createElement('span');
        statusEl.className = 'maint-status';
        statusEl.dataset.serverId = srv.id;
        if (srv.maintenanceEndsAt) {
            statusEl.classList.add('in-maintenance');
            statusEl.textContent = 'IN MAINTENANCE';
        } else {
            statusEl.classList.add('upcoming');
            statusEl.textContent = 'UPCOMING';
        }

        row.appendChild(nameEl);
        row.appendChild(timerEl);
        row.appendChild(statusEl);

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'maint-checkbox';
        cb.dataset.serverId = srv.id;
        cb.dataset.serverName = srv.serverName;
        if (isUpcoming) {
            hasUpcoming = true;
            cb.disabled = false;
        } else {
            cb.disabled = true;
        }
        row.appendChild(cb);

        valuableContentMaintenance.appendChild(row);
    }

    if (hasUpcoming) {
        const bottomRow = document.createElement('div');
        bottomRow.className = 'maint-force-selected-row';
        const batchBtn = document.createElement('button');
        batchBtn.className = 'maint-force-selected-btn';
        batchBtn.id = 'maintForceSelectedBtn';
        batchBtn.textContent = 'Force selected!';
        batchBtn.title = 'Force maintenance on all checked servers (furthest first)';
        batchBtn.addEventListener('click', () => handleForceMaintenanceBatch());
        bottomRow.appendChild(batchBtn);
        valuableContentMaintenance.appendChild(bottomRow);
    }

    function updateTimers() {
        for (const el of timerEls) {
            const target = el.dataset.target;
            if (!target) { el.textContent = '—'; continue; }
            const diff = new Date(target).getTime() - Date.now();
            if (diff <= 0) { el.textContent = 'now'; continue; }
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            el.textContent = (h > 0 ? h + 'h ' : '') + m + 'm ' + s + 's';
        }
    }
    updateTimers();
    _maintTimerInterval = setInterval(updateTimers, 1000);

    chrome.storage.local.get('forceMaintenanceInProgress', (fmState) => {
        const fm = fmState.forceMaintenanceInProgress;
        const allCbs = valuableContentMaintenance.querySelectorAll('.maint-checkbox');
        const batchBtn = document.getElementById('maintForceSelectedBtn');
        if (fm && fm.batch) {
            allCbs.forEach(cb => { cb.disabled = true; });
            if (batchBtn) { batchBtn.disabled = true; batchBtn.classList.add('in-progress'); batchBtn.textContent = 'In-progress...'; }
            const batchIds = fm.serverIds || [];
            const currentId = fm.currentServerId || null;
            batchIds.forEach(sid => {
                const statusEl = valuableContentMaintenance.querySelector(`.maint-status[data-server-id="${sid}"]`);
                if (statusEl && !statusEl.classList.contains('in-maintenance')) {
                    statusEl.classList.remove('upcoming');
                    statusEl.classList.add('in-progress');
                    statusEl.style.background = sid === currentId ? 'var(--accent-orange)' : 'var(--accent-light-cyan)';
                    statusEl.style.color = 'var(--bg-primary)';
                    statusEl.style.textAlign = 'center';
                    statusEl.style.justifySelf = 'end';
                    statusEl.style.width = '80px';
                    statusEl.textContent = sid === currentId ? 'FORCING...' : 'QUEUED';
                }
            });
        }
    });
}

async function handleForceMaintenanceBatch() {
    const fmCheck = await chrome.storage.local.get('forceMaintenanceInProgress');
    if (fmCheck.forceMaintenanceInProgress && fmCheck.forceMaintenanceInProgress.batch) {
        addValuableLog('🔧 Force maintenance already running', 'warn');
        return;
    }

    const checkedCbs = valuableContentMaintenance.querySelectorAll('.maint-checkbox:checked');
    if (checkedCbs.length === 0) {
        addValuableLog('🔧 No servers selected for batch force maintenance', 'warn');
        return;
    }

    const selected = [];
    checkedCbs.forEach(cb => { selected.push({ id: cb.dataset.serverId, name: cb.dataset.serverName }); });
    const serverIds = selected.map(s => s.id);

    const allCbs = valuableContentMaintenance.querySelectorAll('.maint-checkbox');
    const batchBtn = document.getElementById('maintForceSelectedBtn');
    allCbs.forEach(cb => { cb.disabled = true; });
    if (batchBtn) { batchBtn.disabled = true; batchBtn.classList.add('in-progress'); batchBtn.textContent = 'In-progress...'; }

    serverIds.forEach(sid => {
        const statusEl = valuableContentMaintenance.querySelector(`.maint-status[data-server-id="${sid}"]`);
        if (statusEl && !statusEl.classList.contains('in-maintenance')) {
            statusEl.classList.remove('upcoming');
            statusEl.classList.add('in-progress');
            statusEl.style.background = 'var(--accent-light-cyan)';
            statusEl.style.color = 'var(--bg-primary)';
            statusEl.style.textAlign = 'center';
            statusEl.style.justifySelf = 'end';
            statusEl.style.width = '80px';
            statusEl.textContent = 'QUEUED';
        }
    });

    await chrome.storage.local.set({ forceMaintenanceInProgress: { batch: true, serverIds, servers: selected, startedAt: Date.now() } });

    addValuableLog(`🔧 Batch force maintenance: ${selected.length} server(s) selected — starting...`, 'info');

    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.tabs.sendMessage(tab.id, {
                action: 'forceMaintenanceBatch',
                servers: selected
            });
        }
    } catch (e) {
        addValuableLog(`🔧 Batch force maintenance failed: ${e.message}`, 'error');
        allCbs.forEach(cb => { cb.disabled = false; });
        if (batchBtn) { batchBtn.disabled = false; batchBtn.classList.remove('in-progress'); batchBtn.textContent = 'Force selected!'; }
        await chrome.storage.local.remove('forceMaintenanceInProgress');
    }
}

async function updateValuableServerSelection() {
    const cbs = valuableContentServers.querySelectorAll('input[type="checkbox"][data-server-id]');
    const selected = [];
    cbs.forEach(cb => { if (cb.checked) selected.push(cb.dataset.serverId); });
    await chrome.storage.local.set({ valuableSelectedServers: selected });
}

async function updateValuableDownloadSelection() {
    const cbs = valuableContentDownloads.querySelectorAll('input[type="checkbox"][data-file-id]');
    const selected = [];
    cbs.forEach(cb => { if (cb.checked) selected.push(cb.dataset.fileId); });
    await chrome.storage.local.set({ valuableSelectedDownloads: selected });
}

// Button mutual exclusion
function updateValuableButtons() {
    if (valuableSearchRunning) {
        valuableSearchBtn.textContent = '■ Stop Valuable Search';
        valuableSearchBtn.className = 'valuable-btn stop';
        valuableSellerBtn.disabled = true;
    } else if (valuableSellerRunning) {
        valuableSellerBtn.textContent = '■ Stop Valuable Seller';
        valuableSellerBtn.className = 'valuable-btn stop';
        valuableSearchBtn.disabled = true;
    } else {
        valuableSearchBtn.textContent = '▶ Start Valuable Search';
        valuableSearchBtn.className = 'valuable-btn start';
        valuableSearchBtn.disabled = false;
        valuableSellerBtn.textContent = '▶ Start Valuable Seller';
        valuableSellerBtn.className = 'valuable-btn start';
        valuableSellerBtn.disabled = false;
    }
}

// Start Valuable Search
valuableSearchBtn.addEventListener('click', async () => {
    if (valuableSearchRunning) {
        valuableSearchRunning = false;
        updateValuableButtons();
        addValuableLog('Valuable Search stopped by user.', 'warn');
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: "stopValuable" });
        } catch (e) {}
        await chrome.storage.local.set({ valuableSearchRunning: false, valuableSellerRunning: false });
    } else {
        valuableSearchRunning = true;
        updateValuableButtons();
        addValuableLog('Starting Valuable Search...', 'info');
        await chrome.storage.local.set({ valuableSearchRunning: true, valuableSellerRunning: false });
        try {
            const tab = await getCor3Tab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: "startValuableSearch"
                });
            }
        } catch (e) {
            addValuableLog('Failed to start Valuable Search: ' + e.message, 'error');
        }
    }
});

// Start Valuable Seller
valuableSellerBtn.addEventListener('click', async () => {
    if (valuableSellerRunning) {
        valuableSellerRunning = false;
        updateValuableButtons();
        addValuableLog('Valuable Seller stopped by user.', 'warn');
        try {
            const tab = await getCor3Tab();
            if (tab) await chrome.tabs.sendMessage(tab.id, { action: "stopValuable" });
        } catch (e) {}
        await chrome.storage.local.set({ valuableSellerRunning: false, valuableSearchRunning: false });
    } else {
        // Collect selected servers and downloads
        const { valuableSelectedServers, valuableSelectedDownloads } = await chrome.storage.local.get(['valuableSelectedServers', 'valuableSelectedDownloads']);
        const selectedServers = valuableSelectedServers || [];
        const selectedDownloads = valuableSelectedDownloads || [];
        if (selectedServers.length === 0 && selectedDownloads.length === 0) {
            addValuableLog('No servers or downloads selected for selling.', 'warn');
            return;
        }
        valuableSellerRunning = true;
        updateValuableButtons();
        addValuableLog(`Starting Valuable Seller: ${selectedServers.length} server(s), ${selectedDownloads.length} download(s) selected.`, 'info');
        await chrome.storage.local.set({ valuableSellerRunning: true, valuableSearchRunning: false });
        try {
            const tab = await getCor3Tab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: "startValuableSeller",
                    selectedServers,
                    selectedDownloads
                });
            }
        } catch (e) {
            addValuableLog('Failed to start Valuable Seller: ' + e.message, 'error');
        }
    }
});

// Debug console toggle
chrome.storage.sync.get('valuableDebugConsoleEnabled', (data) => {
    const enabled = !!data.valuableDebugConsoleEnabled;
    valuableDebugToggle.checked = enabled;
    valuableDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) renderValuableDebugLogs();
});
valuableDebugToggle.addEventListener('change', () => {
    const enabled = valuableDebugToggle.checked;
    chrome.storage.sync.set({ valuableDebugConsoleEnabled: enabled });
    valuableDebugConsole.style.display = enabled ? '' : 'none';
    if (enabled) renderValuableDebugLogs();
});

function addValuableLog(msg, level = 'info') {
    valuableDebugLogs.push({ timestamp: new Date().toISOString(), msg, level });
    if (valuableDebugLogs.length > VALUABLE_MAX_LOGS) valuableDebugLogs.shift();
    renderValuableDebugLogs();
    chrome.storage.local.set({ valuableDebugLogs });
}

function renderValuableDebugLogs() {
    if (valuableDebugLogs.length === 0) {
        valuableDebugLogsBody.replaceChildren(_h('div', {style: 'color:var(--text-dim);'}, 'No logs yet.'));
        return;
    }
    const frag = document.createDocumentFragment();
    for (const log of valuableDebugLogs) {
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
    valuableDebugLogsBody.replaceChildren(frag);
    valuableDebugLogsBody.scrollTop = valuableDebugLogsBody.scrollHeight;
}

// Listen for storage changes from auto-valuable-seller engine
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.valuableServersData) {
        renderValuableServers(changes.valuableServersData.newValue);
    }
    if (changes.valuableDownloadsData) {
        renderValuableDownloads(changes.valuableDownloadsData.newValue);
    }
    if (changes.valuableMaintenanceData) {
        renderValuableMaintenance(changes.valuableMaintenanceData.newValue);
    }
    if (changes.forceMaintenanceInProgress && changes.forceMaintenanceInProgress.newValue) {
        const fm = changes.forceMaintenanceInProgress.newValue;
        if (fm.batch && fm.currentServerId) {
            const batchIds = fm.serverIds || [];
            batchIds.forEach(sid => {
                const statusEl = valuableContentMaintenance.querySelector(`.maint-status[data-server-id="${sid}"]`);
                if (statusEl && !statusEl.classList.contains('in-maintenance')) {
                    statusEl.style.background = sid === fm.currentServerId ? 'var(--accent-orange)' : 'var(--accent-light-cyan)';
                    statusEl.style.color = 'var(--bg-primary)';
                    statusEl.style.textAlign = 'center';
                    statusEl.style.justifySelf = 'end';
                    statusEl.style.width = '80px';
                    statusEl.textContent = sid === fm.currentServerId ? 'FORCING...' : 'QUEUED';
                }
            });
        }
    }
    if (changes.valuableForceMaintenanceServerDone && changes.valuableForceMaintenanceServerDone.newValue) {
        const sd = changes.valuableForceMaintenanceServerDone.newValue;
        const statusEl = valuableContentMaintenance.querySelector(`.maint-status[data-server-id="${sd.serverId}"]`);
        if (statusEl) {
            statusEl.classList.remove('upcoming', 'in-progress');
            statusEl.classList.add('in-maintenance');
            statusEl.style.background = '';
            statusEl.style.color = '';
            statusEl.style.textAlign = '';
            statusEl.style.justifySelf = '';
            statusEl.style.width = '';
            statusEl.textContent = 'IN MAINTENANCE';
        }
    }
    if (changes.valuableForceMaintenanceDone) {
        chrome.storage.local.remove('forceMaintenanceInProgress');
        const allCbs = valuableContentMaintenance.querySelectorAll('.maint-checkbox');
        const batchBtn = document.getElementById('maintForceSelectedBtn');
        allCbs.forEach(cb => { cb.disabled = false; cb.checked = false; });
        if (batchBtn) { batchBtn.disabled = false; batchBtn.classList.remove('in-progress'); batchBtn.textContent = 'Force selected!'; }
    }
    if (changes.valuableSearchRunning) {
        valuableSearchRunning = !!changes.valuableSearchRunning.newValue;
        updateValuableButtons();
    }
    if (changes.valuableSellerRunning) {
        valuableSellerRunning = !!changes.valuableSellerRunning.newValue;
        updateValuableButtons();
    }
    if (changes.valuableDebugLogs) {
        valuableDebugLogs = changes.valuableDebugLogs.newValue || [];
        renderValuableDebugLogs();
    }
});

// Restore state on popup open
chrome.storage.local.get(['valuableDebugLogs', 'valuableSearchRunning', 'valuableSellerRunning', 'forceMaintenanceInProgress'], (data) => {
    if (data.valuableDebugLogs) {
        valuableDebugLogs = data.valuableDebugLogs;
        renderValuableDebugLogs();
    }
    if (data.valuableSearchRunning) {
        valuableSearchRunning = true;
        updateValuableButtons();
    }
    if (data.valuableSellerRunning) {
        valuableSellerRunning = true;
        updateValuableButtons();
    }
    if (data.forceMaintenanceInProgress && data.forceMaintenanceInProgress.batch) {
        var fm = data.forceMaintenanceInProgress;
        var batchIds = fm.serverIds || [];
        setTimeout(() => {
            batchIds.forEach(sid => {
                const statusEl = valuableContentMaintenance.querySelector(`.maint-status[data-server-id="${sid}"]`);
                if (statusEl && !statusEl.classList.contains('in-maintenance')) {
                    statusEl.classList.remove('upcoming');
                    statusEl.classList.add('in-progress');
                    statusEl.style.background = sid === fm.currentServerId ? 'var(--accent-orange)' : 'var(--accent-light-cyan)';
                    statusEl.style.color = 'var(--bg-primary)';
                    statusEl.style.textAlign = 'center';
                    statusEl.style.justifySelf = 'end';
                    statusEl.style.width = '80px';
                    statusEl.textContent = sid === fm.currentServerId ? 'FORCING...' : 'QUEUED';
                }
            });
            const allCbs = valuableContentMaintenance.querySelectorAll('.maint-checkbox');
            const batchBtn = document.getElementById('maintForceSelectedBtn');
            allCbs.forEach(cb => { cb.disabled = true; });
            if (batchBtn) { batchBtn.disabled = true; batchBtn.classList.add('in-progress'); batchBtn.textContent = 'Forcing...'; }
        }, 100);
    }
});
