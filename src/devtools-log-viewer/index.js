// devtools-log-viewer.js — Offline log viewer (popout window) (modularized entry point)
// Supports importing JSON, MD table, and Discord clipboard formats exported by the extension.

import { PAGE_SIZE } from '../shared/devtools-constants.js';
import { formatTime, formatSize, escapeHtml, safeSetHtml, parseEvent, parseMsgData, extractAction, resolveServer, tryPrettyPrint } from '../shared/devtools-msg-utils.js';
import { buildTreeView } from '../shared/devtools-tree-view.js';
import { initDetailSearch, resetDetailSearch, performDetailSearch, nextDetailMatch } from '../shared/devtools-detail-search.js';

// --- State ---
let importedData = {
    wsLogs: [],
    autoJobSolverLogs: [],
    autoValuableSellerLogs: [],
    extensionErrors: [],
    pageConsoleLogs: [],
    extensionConsoleLogs: []
};
let allMessages = [];
let filteredMessages = [];
let selectedIndex = -1;
let detailFormat = 'pretty';
let selectedRawMessage = '';
let currentPage = 0;
let totalCount = 0;
let currentCategory = 'ws-messages';

// --- DOM refs ---
const messageList = document.getElementById('messageList');
const emptyState = document.getElementById('emptyState');
const detailPanel = document.getElementById('detailPanel');
const detailMeta = document.getElementById('detailMeta');
const detailBody = document.getElementById('detailBody');
const detailClose = document.getElementById('detailClose');
const detailResizeHandle = document.getElementById('detailResizeHandle');
const detailFormatSelect = document.getElementById('detailFormatSelect');
const detailSearchInput = document.getElementById('detailSearchInput');
const detailSearchBtn = document.getElementById('detailSearchBtn');
const detailSearchCount = document.getElementById('detailSearchCount');
const searchInput = document.getElementById('searchInput');
const filterSent = document.getElementById('filterSent');
const filterReceived = document.getElementById('filterReceived');
const statsLabel = document.getElementById('statsLabel');
const pageSelector = document.getElementById('pageSelector');
const categorySelect = document.getElementById('categorySelect');
const listHeader = document.getElementById('listHeader');
const btnImport = document.getElementById('btnImport');
const importFileInput = document.getElementById('importFileInput');

// --- Init detail search ---
initDetailSearch(detailBody, detailSearchCount, () => detailFormat);

function isLogCategory() { return currentCategory !== 'ws-messages'; }

// --- Import / Parse ---
function stripCodeFences(text) {
    text = text.trim();
    if (text.startsWith('```')) {
        const firstNewline = text.indexOf('\n');
        if (firstNewline !== -1) text = text.substring(firstNewline + 1);
    }
    if (text.endsWith('```')) {
        text = text.substring(0, text.lastIndexOf('```'));
    }
    return text.trim();
}

function detectAndParse(rawText) {
    const stripped = stripCodeFences(rawText);

    // Try JSON parse first
    try {
        const parsed = JSON.parse(stripped);
        if (parsed && typeof parsed === 'object') {
            return parseJsonExport(parsed);
        }
    } catch (e) { /* not JSON */ }

    // Try MD table
    if (stripped.includes('|') && stripped.includes('---')) {
        return parseMdExport(stripped);
    }

    return null;
}

function parseJsonExport(data) {
    const result = {
        wsLogs: [],
        autoJobSolverLogs: [],
        autoValuableSellerLogs: [],
        extensionErrors: [],
        pageConsoleLogs: [],
        extensionConsoleLogs: []
    };

    // Check if it's the copyAllLogs format (has named keys)
    if (data.wsLogs || data.autoJobSolverLogs || data.autoValuableSellerLogs ||
        data.extensionErrors || data.pageConsoleLogs || data.extensionConsoleLogs) {
        if (Array.isArray(data.wsLogs)) {
            result.wsLogs = data.wsLogs.map(e => ({
                timestamp: e.timestamp,
                direction: e.direction || 'received',
                message: e.message || e.raw || ''
            }));
        }
        if (Array.isArray(data.autoJobSolverLogs)) {
            result.autoJobSolverLogs = data.autoJobSolverLogs.map(e => ({
                timestamp: e.timestamp,
                level: e.level || 'info',
                message: e.message || e.args || '',
                category: 'auto-jobs'
            }));
        }
        if (Array.isArray(data.autoValuableSellerLogs)) {
            result.autoValuableSellerLogs = data.autoValuableSellerLogs.map(e => ({
                timestamp: e.timestamp,
                level: e.level || 'info',
                message: e.message || e.args || '',
                category: 'auto-valuable'
            }));
        }
        if (Array.isArray(data.extensionErrors)) {
            result.extensionErrors = data.extensionErrors.map(e => ({
                timestamp: e.timestamp || e.ts,
                level: 'error',
                message: (e.source ? '[' + e.source + '] ' : '') + (e.message || e.msg || ''),
                category: 'error-logs'
            }));
        }
        if (Array.isArray(data.pageConsoleLogs)) {
            result.pageConsoleLogs = data.pageConsoleLogs.map(e => ({
                timestamp: e.timestamp,
                level: e.level || 'log',
                message: e.args || e.message || '',
                category: 'page-console'
            }));
        }
        if (Array.isArray(data.extensionConsoleLogs)) {
            result.extensionConsoleLogs = data.extensionConsoleLogs.map(e => ({
                timestamp: e.timestamp,
                level: e.level || 'log',
                message: '[' + (e.source || 'unknown') + '] ' + (e.args || e.message || ''),
                category: 'ext-console'
            }));
        }
        return result;
    }

    // Check if it's a DevTools export (flat array)
    if (Array.isArray(data)) {
        // Detect type by shape
        const sample = data[0];
        if (!sample) return result;
        if (sample.direction !== undefined && sample.raw !== undefined) {
            // WS export from DevTools
            result.wsLogs = data.map(e => ({
                timestamp: e.timestamp,
                direction: e.direction || 'received',
                message: e.raw || e.message || ''
            }));
        } else if (sample.level !== undefined || sample.category !== undefined) {
            // Log export from DevTools
            const cat = sample.category || 'auto-jobs';
            const key = cat === 'auto-valuable' ? 'autoValuableSellerLogs'
                : cat === 'error-logs' ? 'extensionErrors'
                : cat === 'page-console' ? 'pageConsoleLogs'
                : cat === 'ext-console' ? 'extensionConsoleLogs'
                : 'autoJobSolverLogs';
            result[key] = data.map(e => ({
                timestamp: e.timestamp,
                level: e.level || 'info',
                message: e.message || '',
                category: cat
            }));
        }
        return result;
    }

    return result;
}

function parseMdExport(text) {
    const result = {
        wsLogs: [],
        autoJobSolverLogs: [],
        autoValuableSellerLogs: [],
        extensionErrors: [],
        pageConsoleLogs: [],
        extensionConsoleLogs: []
    };

    const lines = text.split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length < 3) return result;

    const headerLine = lines[0];
    const headerCells = headerLine.split('|').map(c => c.trim()).filter(c => c);
    const isWsFormat = headerCells.some(h => h === 'Dir');

    const dataLines = lines.slice(2); // skip header + separator

    if (isWsFormat) {
        for (const line of dataLines) {
            const cells = line.split('|').map(c => c.trim()).filter(c => c);
            if (cells.length < 3) continue;
            const dir = cells[0] === '\u25B2' ? 'sent' : 'received';
            const timeStr = cells[1] || '';
            const raw = cells.length >= 7 ? (cells[5] || '').replace(/\\\|/g, '|') : '';
            result.wsLogs.push({
                timestamp: timeStr,
                direction: dir,
                message: raw
            });
        }
    } else {
        // Log format: Time | Level | Message
        for (const line of dataLines) {
            const cells = line.split('|').map(c => c.trim()).filter(c => c);
            if (cells.length < 3) continue;
            result.autoJobSolverLogs.push({
                timestamp: cells[0] || '',
                level: (cells[1] || 'info').toLowerCase(),
                message: (cells[2] || '').replace(/\\\|/g, '|'),
                category: 'auto-jobs'
            });
        }
    }
    return result;
}

function loadImportedData() {
    const catMap = {
        'ws-messages': importedData.wsLogs,
        'auto-jobs': importedData.autoJobSolverLogs,
        'auto-valuable': importedData.autoValuableSellerLogs,
        'error-logs': importedData.extensionErrors,
        'page-console': importedData.pageConsoleLogs,
        'ext-console': importedData.extensionConsoleLogs
    };

    const catData = catMap[currentCategory] || [];
    totalCount = catData.length;
    const pages = Math.ceil(totalCount / PAGE_SIZE) || 1;

    pageSelector.replaceChildren();
    for (let i = 0; i < pages; i++) {
        const start = i * PAGE_SIZE;
        const isLast = i === pages - 1;
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = isLast ? `${start}-${totalCount}` : `${start}-${start + PAGE_SIZE}`;
        pageSelector.appendChild(opt);
    }
    if (currentPage >= pages) currentPage = Math.max(0, pages - 1);
    pageSelector.value = String(currentPage);

    const start = currentPage * PAGE_SIZE;
    allMessages = catData.slice(start, start + PAGE_SIZE);
    applyFilters();
}

// --- Filtering ---
function applyFilters() {
    const search = searchInput.value.toLowerCase().trim();
    const showSent = filterSent.checked;
    const showReceived = filterReceived.checked;

    if (isLogCategory()) {
        filteredMessages = allMessages.filter(m => {
            if (search && !(m.message || '').toLowerCase().includes(search)) return false;
            return true;
        });
    } else {
        filteredMessages = allMessages.filter(m => {
            if (m.direction === 'sent' && !showSent) return false;
            if (m.direction === 'received' && !showReceived) return false;
            if (search) {
                const parsed = parseEvent(m.message);
                const msgData = parseMsgData(m.message);
                const action = msgData ? extractAction(msgData) : '';
                const server = msgData ? resolveServer(msgData) : '';
                const haystack = (parsed.event + ' ' + action + ' ' + server + ' ' + (m.message || '')).toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            return true;
        });
    }
    renderList();
    updateStats();
}

// --- Render ---
function renderList() {
    if (filteredMessages.length === 0) {
        messageList.replaceChildren();
        messageList.appendChild(emptyState);
        emptyState.style.display = '';
        return;
    }
    emptyState.style.display = 'none';
    const fragment = document.createDocumentFragment();

    if (isLogCategory()) {
        for (let i = 0; i < filteredMessages.length; i++) {
            const m = filteredMessages[i];
            const row = document.createElement('div');
            row.className = 'log-row' + (i === selectedIndex ? ' selected' : '');
            row.dataset.index = i;
            const time = document.createElement('span');
            time.className = 'msg-time';
            time.textContent = formatTime(m.timestamp);
            row.appendChild(time);
            const lvl = document.createElement('span');
            lvl.className = 'log-level ' + (m.level || 'info');
            lvl.textContent = (m.level || 'info').toUpperCase();
            row.appendChild(lvl);
            const msg = document.createElement('span');
            msg.className = 'log-message';
            msg.textContent = m.message || '';
            msg.title = m.message || '';
            row.appendChild(msg);
            row.addEventListener('click', () => selectMessage(i));
            fragment.appendChild(row);
        }
    } else {
        for (let i = 0; i < filteredMessages.length; i++) {
            const m = filteredMessages[i];
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            const action = msgData ? extractAction(msgData) : '\u2014';
            const server = msgData ? resolveServer(msgData) : '\u2014';
            const row = document.createElement('div');
            row.className = 'msg-row' + (i === selectedIndex ? ' selected' : '');
            row.dataset.index = i;
            const dir = document.createElement('span');
            dir.className = 'msg-dir ' + m.direction;
            dir.textContent = m.direction === 'sent' ? '\u25B2' : '\u25BC';
            dir.title = m.direction;
            row.appendChild(dir);
            const time = document.createElement('span');
            time.className = 'msg-time';
            time.textContent = formatTime(m.timestamp);
            row.appendChild(time);
            const evt = document.createElement('span');
            evt.className = 'msg-event';
            evt.textContent = parsed.event;
            evt.title = parsed.event;
            row.appendChild(evt);
            const act = document.createElement('span');
            act.className = 'msg-action';
            act.textContent = action;
            act.title = action;
            row.appendChild(act);
            const srv = document.createElement('span');
            srv.className = 'msg-server';
            srv.textContent = server;
            srv.title = server;
            row.appendChild(srv);
            const preview = document.createElement('span');
            preview.className = 'msg-preview';
            let previewText = '';
            if (msgData) {
                try { previewText = JSON.stringify(msgData); } catch (e) { previewText = m.message || ''; }
            } else {
                previewText = m.message || '';
            }
            if (previewText.length > 200) previewText = previewText.substring(0, 200) + '\u2026';
            preview.textContent = previewText;
            preview.title = previewText;
            row.appendChild(preview);
            const size = document.createElement('span');
            size.className = 'msg-size';
            size.textContent = formatSize(m.message);
            row.appendChild(size);
            row.addEventListener('click', () => selectMessage(i));
            fragment.appendChild(row);
        }
    }
    messageList.replaceChildren(fragment);
}

function selectMessage(index) {
    selectedIndex = index;
    const m = filteredMessages[index];
    if (!m) return;
    const rows = messageList.querySelectorAll('.msg-row, .log-row');
    rows.forEach((r, i) => r.classList.toggle('selected', i === index));
    detailPanel.classList.add('open');
    if (isLogCategory()) {
        safeSetHtml(detailMeta, `<span>Time: ${formatTime(m.timestamp)}</span>`
            + `<span>Level: <strong class="log-level ${m.level || 'info'}">${(m.level || 'info').toUpperCase()}</strong></span>`
            + `<span>Category: <strong>${escapeHtml(m.category || currentCategory)}</strong></span>`);
        selectedRawMessage = m.message || '';
    } else {
        const parsed = parseEvent(m.message);
        const msgData = parseMsgData(m.message);
        const action = msgData ? extractAction(msgData) : '\u2014';
        const server = msgData ? resolveServer(msgData) : '\u2014';
        const dirClass = m.direction === 'sent' ? 'dir-sent' : 'dir-received';
        const dirLabel = m.direction === 'sent' ? '\u25B2 SENT' : '\u25BC RECEIVED';
        safeSetHtml(detailMeta, `<span class="${dirClass}">${dirLabel}</span>`
            + `<span>Time: ${formatTime(m.timestamp)}</span>`
            + `<span>Event: <strong>${escapeHtml(parsed.event)}</strong></span>`
            + `<span>Action: <strong>${escapeHtml(action)}</strong></span>`
            + `<span>Server: <strong>${escapeHtml(server)}</strong></span>`
            + `<span>Size: ${formatSize(m.message)}</span>`);
        selectedRawMessage = m.message;
    }
    renderDetailBody();
    detailSearchInput.value = '';
    resetDetailSearch();
}

function renderDetailBody() {
    detailBody.replaceChildren();
    if (detailFormat === 'tree') {
        const tree = buildTreeView(selectedRawMessage);
        if (tree) detailBody.appendChild(tree);
        else detailBody.textContent = selectedRawMessage;
    } else if (detailFormat === 'pretty') {
        detailBody.textContent = tryPrettyPrint(selectedRawMessage);
    } else {
        detailBody.textContent = selectedRawMessage;
    }
}

function closeDetail() {
    detailPanel.classList.remove('open');
    selectedIndex = -1;
    const rows = messageList.querySelectorAll('.msg-row, .log-row');
    rows.forEach(r => r.classList.remove('selected'));
}

function updateStats() {
    if (isLogCategory()) {
        statsLabel.textContent = `(${filteredMessages.length} entries)`;
    } else {
        const sent = filteredMessages.filter(m => m.direction === 'sent').length;
        const recv = filteredMessages.filter(m => m.direction === 'received').length;
        statsLabel.textContent = `(\u25B2${sent} \u25BC${recv})`;
    }
}

// --- Auto-select first non-empty category after import ---
function autoSelectCategory() {
    const priority = ['ws-messages', 'auto-jobs', 'auto-valuable', 'error-logs', 'page-console', 'ext-console'];
    const catMap = {
        'ws-messages': importedData.wsLogs,
        'auto-jobs': importedData.autoJobSolverLogs,
        'auto-valuable': importedData.autoValuableSellerLogs,
        'error-logs': importedData.extensionErrors,
        'page-console': importedData.pageConsoleLogs,
        'ext-console': importedData.extensionConsoleLogs
    };
    for (const cat of priority) {
        if (catMap[cat] && catMap[cat].length > 0) {
            currentCategory = cat;
            categorySelect.value = cat;
            break;
        }
    }
}

// --- Event listeners ---
btnImport.addEventListener('click', () => importFileInput.click());

importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const parsed = detectAndParse(text);
        if (!parsed) {
            alert('Could not parse the imported file. Supported formats: JSON (Export or Copy-All-Logs), MD table, Discord clipboard format.');
            return;
        }
        importedData = parsed;
        currentPage = 0;
        autoSelectCategory();
        const logMode = isLogCategory();
        document.body.classList.toggle('log-mode', logMode);
        filterSent.parentElement.style.display = logMode ? 'none' : '';
        filterReceived.parentElement.style.display = logMode ? 'none' : '';
        loadImportedData();
    } catch (err) {
        alert('Error reading file: ' + err.message);
    }
    importFileInput.value = '';
});

categorySelect.addEventListener('change', () => {
    currentCategory = categorySelect.value;
    const logMode = isLogCategory();
    document.body.classList.toggle('log-mode', logMode);
    filterSent.parentElement.style.display = logMode ? 'none' : '';
    filterReceived.parentElement.style.display = logMode ? 'none' : '';
    currentPage = 0;
    selectedIndex = -1;
    closeDetail();
    loadImportedData();
});

pageSelector.addEventListener('change', () => {
    currentPage = parseInt(pageSelector.value) || 0;
    loadImportedData();
});

searchInput.addEventListener('input', applyFilters);
filterSent.addEventListener('change', applyFilters);
filterReceived.addEventListener('change', applyFilters);

detailClose.addEventListener('click', closeDetail);
detailFormatSelect.addEventListener('change', () => {
    detailFormat = detailFormatSelect.value;
    if (selectedRawMessage) {
        renderDetailBody();
        if (detailSearchInput.value.trim()) performDetailSearch(detailSearchInput.value.trim());
    }
});
detailSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nextDetailMatch(detailSearchInput.value.trim()); }
});
detailSearchInput.addEventListener('input', () => performDetailSearch(detailSearchInput.value.trim()));
detailSearchBtn.addEventListener('click', () => performDetailSearch(detailSearchInput.value.trim()));

// --- Column resize ---
const COL_VAR_MAP = { time: '--col-time', event: '--col-event', action: '--col-action', server: '--col-server' };
let resizeState = null;

function onResizeStart(e) {
    const col = e.target.dataset.col;
    if (!col || !COL_VAR_MAP[col]) return;
    e.preventDefault();
    e.stopPropagation();
    const cssVar = COL_VAR_MAP[col];
    const startX = e.clientX;
    const startWidth = parseInt(getComputedStyle(document.body).getPropertyValue(cssVar)) || 80;
    e.target.classList.add('active');
    resizeState = { cssVar, startX, startWidth, handle: e.target };
}

document.addEventListener('mousemove', (e) => {
    if (!resizeState) return;
    const diff = e.clientX - resizeState.startX;
    const newWidth = Math.max(40, resizeState.startWidth + diff);
    document.body.style.setProperty(resizeState.cssVar, newWidth + 'px');
});

document.addEventListener('mouseup', () => {
    if (!resizeState) return;
    if (resizeState.handle) resizeState.handle.classList.remove('active');
    resizeState = null;
});

listHeader.querySelectorAll('.col-resize').forEach(handle => {
    handle.addEventListener('mousedown', onResizeStart);
});

// --- Detail panel resize ---
(function initDetailResize() {
    let startX, startW;
    function onMouseDown(e) {
        e.preventDefault();
        startX = e.clientX;
        startW = detailPanel.offsetWidth;
        detailPanel.classList.add('resizing');
        detailResizeHandle.classList.add('active');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
    function onMouseMove(e) {
        const dx = startX - e.clientX;
        const newW = Math.max(200, Math.min(startW + dx, window.innerWidth * 0.85));
        detailPanel.style.width = newW + 'px';
    }
    function onMouseUp() {
        detailPanel.classList.remove('resizing');
        detailResizeHandle.classList.remove('active');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
    detailResizeHandle.addEventListener('mousedown', onMouseDown);
})();

// --- Keyboard navigation ---
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') { closeDetail(); return; }
    if (filteredMessages.length === 0) return;
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(selectedIndex + 1, filteredMessages.length - 1);
        selectMessage(next);
        const rows = messageList.querySelectorAll('.msg-row, .log-row');
        if (rows[next]) rows[next].scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(selectedIndex - 1, 0);
        selectMessage(prev);
        const rows = messageList.querySelectorAll('.msg-row, .log-row');
        if (rows[prev]) rows[prev].scrollIntoView({ block: 'nearest' });
    }
});

// --- Init: show empty page selector ---
const _initOpt = document.createElement('option');
_initOpt.value = '0';
_initOpt.textContent = '0-0';
pageSelector.replaceChildren(_initOpt);
