// devtools-panel.js — CORE Helper DevTools panel logic (modularized entry point)

import { PAGE_SIZE } from '../shared/devtools-constants.js';
import { formatTime, formatSize, escapeHtml, safeSetHtml, parseEvent, parseMsgData, extractAction, resolveServer, tryPrettyPrint } from '../shared/devtools-msg-utils.js';
import { buildTreeView } from '../shared/devtools-tree-view.js';
import { initDetailSearch, resetDetailSearch, performDetailSearch, nextDetailMatch } from '../shared/devtools-detail-search.js';
import { getInspectedTabId, dbCount, dbGetPage, dbGetAfter, dbClear, logDbCount, logDbGetPage, logDbGetAfter, logDbClear } from './idb-access.js';

// --- State ---
let allMessages = [];
let filteredMessages = [];
let selectedIndex = -1;
let liveMode = false;
let liveTimer = null;
let lastLiveTimestamp = null;
let detailFormat = 'pretty';
let selectedRawMessage = '';
let currentPage = -1; // -1 = latest page (XXX-now)
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
const btnLive = document.getElementById('btnLive');
const btnRefresh = document.getElementById('btnRefresh');
const btnClear = document.getElementById('btnClear');
const btnSendToggle = document.getElementById('btnSendToggle');
const sendPanel = document.getElementById('sendPanel');
const sendInput = document.getElementById('sendInput');
const btnSend = document.getElementById('btnSend');
const listHeader = document.getElementById('listHeader');
const categorySelect = document.getElementById('categorySelect');
const btnExport = document.getElementById('btnExport');
const exportMenu = document.getElementById('exportMenu');
const btnExportJson = document.getElementById('btnExportJson');
const btnExportMd = document.getElementById('btnExportMd');

// --- Init detail search ---
initDetailSearch(detailBody, detailSearchCount, () => detailFormat);

function isLogCategory() { return currentCategory !== 'ws-messages'; }

// --- Page selector ---
async function refreshPageSelector() {
    totalCount = isLogCategory() ? await logDbCount(currentCategory) : await dbCount();
    const pages = Math.ceil(totalCount / PAGE_SIZE);
    const prevVal = pageSelector.value;
    pageSelector.replaceChildren();
    if (pages === 0) {
        const opt = document.createElement('option');
        opt.value = '-1';
        opt.textContent = '0-now';
        pageSelector.appendChild(opt);
    } else {
        for (let i = 0; i < pages; i++) {
            const start = i * PAGE_SIZE;
            const isLast = i === pages - 1;
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = isLast ? `${start}-now` : `${start}-${start + PAGE_SIZE}`;
            pageSelector.appendChild(opt);
        }
    }
    if (currentPage === -1 || currentPage >= pages) {
        pageSelector.value = String(Math.max(0, pages - 1));
        currentPage = Math.max(0, pages - 1);
    } else {
        pageSelector.value = String(currentPage);
    }
}

async function loadCurrentPage() {
    const start = currentPage * PAGE_SIZE;
    if (isLogCategory()) {
        allMessages = await logDbGetPage(currentCategory, start, PAGE_SIZE);
    } else {
        allMessages = await dbGetPage(start, PAGE_SIZE);
    }
    applyFilters();
}

async function pullLiveMessages() {
    try {
        if (!lastLiveTimestamp) return;
        let newMsgs;
        if (isLogCategory()) {
            newMsgs = await logDbGetAfter(currentCategory, lastLiveTimestamp);
        } else {
            newMsgs = await dbGetAfter(lastLiveTimestamp);
        }
        if (newMsgs.length === 0) return;
        for (const m of newMsgs) allMessages.push(m);
        if (allMessages.length > PAGE_SIZE) {
            allMessages = allMessages.slice(allMessages.length - PAGE_SIZE);
        }
        lastLiveTimestamp = newMsgs[newMsgs.length - 1].timestamp;
        applyFilters();
        await refreshPageSelector();
    } catch (e) {
        console.log('[COR3 Panel] Failed to pull live messages:', e);
    }
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

// --- Render message list ---
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

    if (liveMode) {
        messageList.scrollTop = messageList.scrollHeight;
    }
}

// --- Select a message to show detail ---
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
        if (tree) {
            detailBody.appendChild(tree);
        } else {
            detailBody.textContent = selectedRawMessage;
        }
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

// --- Stats ---
function updateStats() {
    if (isLogCategory()) {
        statsLabel.textContent = `(${filteredMessages.length} entries)`;
    } else {
        const sent = filteredMessages.filter(m => m.direction === 'sent').length;
        const recv = filteredMessages.filter(m => m.direction === 'received').length;
        statsLabel.textContent = `(\u25B2${sent} \u25BC${recv})`;
    }
}

function toggleLive() {
    liveMode = !liveMode;
    btnLive.classList.toggle('active', liveMode);
    btnLive.textContent = liveMode ? '\u25CF Live ON' : '\u25CF Live';

    if (liveMode) {
        lastLiveTimestamp = new Date().toISOString();
        allMessages = [];
        applyFilters();
        liveTimer = setInterval(pullLiveMessages, 1500);
        console.log('[COR3 Panel] Live mode ON from', lastLiveTimestamp);
    } else {
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = null;
        console.log('[COR3 Panel] Live mode OFF');
        refreshPageSelector().then(() => loadCurrentPage());
    }
}

// --- Export ---
function getPreviewText(msgData, raw) {
    let previewText = '';
    if (msgData) {
        try { previewText = JSON.stringify(msgData); } catch (e) { previewText = raw || ''; }
    } else {
        previewText = raw || '';
    }
    if (previewText.length > 200) previewText = previewText.substring(0, 200) + '\u2026';
    return previewText;
}

function exportAsJson() {
    if (isLogCategory()) {
        const data = filteredMessages.map(m => ({
            timestamp: m.timestamp,
            level: m.level || 'info',
            category: m.category || currentCategory,
            message: m.message
        }));
        downloadFile('cor3-' + currentCategory + '-export.json', JSON.stringify(data, null, 2), 'application/json');
    } else {
        const data = filteredMessages.map(m => {
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            return {
                direction: m.direction,
                timestamp: m.timestamp,
                event: parsed.event,
                action: msgData ? extractAction(msgData) : '\u2014',
                server: msgData ? resolveServer(msgData) : '\u2014',
                preview: getPreviewText(msgData, m.message),
                raw: m.message,
                data: msgData
            };
        });
        downloadFile('cor3-ws-export.json', JSON.stringify(data, null, 2), 'application/json');
    }
}

function exportAsMd() {
    if (isLogCategory()) {
        let md = '| Time | Level | Message |\n';
        md += '|------|-------|---------|\n';
        for (const m of filteredMessages) {
            const msg = (m.message || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
            md += `| ${formatTime(m.timestamp)} | ${(m.level || 'info').toUpperCase()} | ${msg} |\n`;
        }
        downloadFile('cor3-' + currentCategory + '-export.md', md, 'text/markdown');
    } else {
        let md = '| Dir | Time | Event | Action | Server | Preview | Size |\n';
        md += '|-----|------|-------|--------|--------|---------|------|\n';
        for (const m of filteredMessages) {
            const parsed = parseEvent(m.message);
            const msgData = parseMsgData(m.message);
            const action = msgData ? extractAction(msgData) : '\u2014';
            const server = msgData ? resolveServer(msgData) : '\u2014';
            const dir = m.direction === 'sent' ? '\u25B2' : '\u25BC';
            let preview = getPreviewText(msgData, m.message);
            preview = preview.replace(/\|/g, '\\|');
            md += `| ${dir} | ${formatTime(m.timestamp)} | ${parsed.event} | ${action} | ${server} | ${preview} | ${formatSize(m.message)} |\n`;
        }
        downloadFile('cor3-ws-export.md', md, 'text/markdown');
    }
}

function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function sendWsMessage() {
    const msg = sendInput.value.trim();
    if (!msg) return;

    try {
        const tabId = getInspectedTabId();
        await chrome.tabs.sendMessage(tabId, {
            action: 'devtoolsSendWs',
            message: msg
        });
        sendInput.value = '';
        console.log('[COR3 Panel] Sent WS message to tab', tabId);
    } catch (e) {
        console.log('[COR3 Panel] Failed to send WS message:', e);
        alert('Failed to send: ' + e.message);
    }
}

// --- Clear messages (deletes from IndexedDB, per category) ---
async function clearMessages() {
    allMessages = [];
    filteredMessages = [];
    selectedIndex = -1;
    lastLiveTimestamp = new Date().toISOString();
    closeDetail();
    if (isLogCategory()) {
        await logDbClear(currentCategory);
    } else {
        await dbClear();
    }
    await refreshPageSelector();
    applyFilters();
}

// --- Column resize logic ---
const COL_VAR_MAP = {
    time: '--col-time',
    event: '--col-event',
    action: '--col-action',
    server: '--col-server'
};

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

// --- Category switch ---
categorySelect.addEventListener('change', async () => {
    currentCategory = categorySelect.value;
    const logMode = isLogCategory();
    document.body.classList.toggle('log-mode', logMode);
    filterSent.parentElement.style.display = logMode ? 'none' : '';
    filterReceived.parentElement.style.display = logMode ? 'none' : '';
    btnSendToggle.style.display = logMode ? 'none' : '';
    if (logMode && sendPanel.classList.contains('open')) {
        sendPanel.classList.remove('open');
        btnSendToggle.classList.remove('active');
    }
    if (liveMode) {
        liveMode = false;
        btnLive.classList.remove('active');
        btnLive.textContent = '\u25CF Live';
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = null;
    }
    allMessages = [];
    filteredMessages = [];
    selectedIndex = -1;
    currentPage = -1;
    closeDetail();
    await refreshPageSelector();
    await loadCurrentPage();
});

// --- Event Listeners ---
btnLive.addEventListener('click', toggleLive);
btnRefresh.addEventListener('click', async () => {
    await refreshPageSelector();
    await loadCurrentPage();
});
btnClear.addEventListener('click', clearMessages);
detailClose.addEventListener('click', closeDetail);
detailClose.addEventListener('mousedown', (e) => { e.stopPropagation(); });

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
detailSearchInput.addEventListener('input', () => {
    performDetailSearch(detailSearchInput.value.trim());
});
detailSearchBtn.addEventListener('click', () => {
    performDetailSearch(detailSearchInput.value.trim());
});

pageSelector.addEventListener('change', () => {
    currentPage = parseInt(pageSelector.value) || 0;
    if (liveMode) {
        liveMode = false;
        btnLive.classList.remove('active');
        btnLive.textContent = '\u25CF Live';
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = null;
    }
    loadCurrentPage();
});

const btnPopout = document.getElementById('btnPopout');
btnPopout.addEventListener('click', () => {
    const url = chrome.runtime.getURL('devtools-log-viewer.html');
    window.open(url, '_blank', 'width=1200,height=700,menubar=no,toolbar=no,location=no,status=no');
});

btnExport.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
});
btnExportJson.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsJson(); });
btnExportMd.addEventListener('click', () => { exportMenu.classList.remove('open'); exportAsMd(); });
document.addEventListener('click', () => exportMenu.classList.remove('open'));

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

btnSendToggle.addEventListener('click', () => {
    const isOpen = sendPanel.classList.toggle('open');
    btnSendToggle.classList.toggle('active', isOpen);
    if (isOpen) sendInput.focus();
});

btnSend.addEventListener('click', sendWsMessage);
sendInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendWsMessage();
    }
});

searchInput.addEventListener('input', applyFilters);
filterSent.addEventListener('change', applyFilters);
filterReceived.addEventListener('change', applyFilters);

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

// --- Initial load: populate page selector and load latest page ---
(async function init() {
    console.log('[COR3 Panel] Initializing, inspected tab:', getInspectedTabId());
    await refreshPageSelector();
    await loadCurrentPage();
    console.log('[COR3 Panel] Init complete \u2014 totalCount:', totalCount, 'loaded:', allMessages.length);
})();
