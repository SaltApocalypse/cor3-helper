// Inventory sorting UI: triggers the content-side warehouse sorter and shows
// progress. Sorting is server-driven and can take a long time, so the popup
// must stay open; the content script keeps running even if it is closed.
import { getCor3Tab } from './utils.js';

const smartBtn = document.getElementById('invSortSmartBtn');
const compactBtn = document.getElementById('invSortCompactBtn');
const statusEl = document.getElementById('invSortStatus');
const hintEl = document.getElementById('invSortHint');
const noticeEl = document.getElementById('invSortNotice');

let _sorting = false;
let _confirmMode = null;
let _confirmTimer = null;

const LABELS = {
    smart: 'Smart Sort',
    compact: 'Compact Sort'
};

function setButtonsEnabled(enabled) {
    [smartBtn, compactBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '' : '0.45';
    });
}

function resetConfirm() {
    if (_confirmTimer) { clearTimeout(_confirmTimer); _confirmTimer = null; }
    _confirmMode = null;
    [smartBtn, compactBtn].forEach(btn => {
        if (!btn) return;
        btn.classList.remove('inv-sort-confirm');
        const mode = btn === smartBtn ? 'smart' : 'compact';
        btn.textContent = LABELS[mode];
    });
}

function showNotice(text) {
    if (!noticeEl) return;
    if (text) {
        noticeEl.textContent = text;
        noticeEl.style.display = '';
    } else {
        noticeEl.textContent = '';
        noticeEl.style.display = 'none';
    }
}

function render(progress, sorting, notice) {
    _sorting = !!sorting;
    setButtonsEnabled(!_sorting);
    if (hintEl) hintEl.style.display = _sorting ? '' : 'none';
    if (statusEl) {
        if (progress && progress.text) {
            statusEl.textContent = progress.text;
            statusEl.style.display = '';
            statusEl.style.color = progress.error ? 'var(--accent-red)' : (progress.phase === 'done' ? 'var(--accent-green)' : 'var(--accent-cyan)');
        } else if (_sorting) {
            statusEl.textContent = 'Sorting…';
            statusEl.style.display = '';
            statusEl.style.color = 'var(--accent-cyan)';
        } else {
            statusEl.textContent = '';
            statusEl.style.display = 'none';
        }
    }
    showNotice(notice || null);
    if (!_sorting) resetConfirm();
}

async function startSort(mode) {
    if (_sorting) return;
    const btn = mode === 'smart' ? smartBtn : compactBtn;
    if (!btn) return;

    if (_confirmMode !== mode) {
        resetConfirm();
        _confirmMode = mode;
        btn.classList.add('inv-sort-confirm');
        btn.textContent = 'Confirm?';
        _confirmTimer = setTimeout(resetConfirm, 4000);
        return;
    }

    resetConfirm();
    _sorting = true;
    setButtonsEnabled(false);
    showNotice(null);
    if (statusEl) {
        statusEl.textContent = 'Starting sort…';
        statusEl.style.display = '';
        statusEl.style.color = 'var(--accent-cyan)';
    }
    if (hintEl) hintEl.style.display = '';

    try {
        const tab = await getCor3Tab();
        if (!tab) throw new Error('No cor3.gg tab found.');
        const res = await chrome.tabs.sendMessage(tab.id, { action: 'sortStash', mode: mode });
        if (!res || res.ok === false) {
            _sorting = false;
            setButtonsEnabled(true);
            if (statusEl) {
                statusEl.textContent = (res && (res.reason || res.error)) || 'Sort failed (no response from the page).';
                statusEl.style.color = 'var(--accent-red)';
                statusEl.style.display = '';
            }
            if (hintEl) hintEl.style.display = 'none';
            if (res && res.notice) showNotice(res.notice);
        } else if (res.notice) {
            showNotice(res.notice);
        }
    } catch (err) {
        _sorting = false;
        setButtonsEnabled(true);
        if (statusEl) {
            statusEl.textContent = 'Sort failed: ' + (err && err.message ? err.message : String(err));
            statusEl.style.color = 'var(--accent-red)';
            statusEl.style.display = '';
        }
        if (hintEl) hintEl.style.display = 'none';
    }
}

if (smartBtn) {
    smartBtn.addEventListener('click', (e) => { e.stopPropagation(); startSort('smart'); });
}
if (compactBtn) {
    compactBtn.addEventListener('click', (e) => { e.stopPropagation(); startSort('compact'); });
}

function loadState() {
    chrome.storage.local.get(['stashSortProgress', 'stashSorting', 'stashSortNotice'], (data) => {
        render(data.stashSortProgress || null, !!data.stashSorting, data.stashSortNotice || null);
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.stashSortProgress || changes.stashSorting || changes.stashSortNotice) {
        chrome.storage.local.get(['stashSortProgress', 'stashSorting', 'stashSortNotice'], (data) => {
            render(data.stashSortProgress || null, !!data.stashSorting, data.stashSortNotice || null);
        });
    }
});

loadState();
