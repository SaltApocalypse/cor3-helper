// Inventory sorting UI: triggers the content-side warehouse sorter and shows
// progress. Sorting is server-driven and can take a long time, so the popup
// must stay open; the content script keeps running even if it is closed.
import { getCor3Tab } from './utils.js';

const defaultBtn = document.getElementById('invSortDefaultBtn');
const horizontalBtn = document.getElementById('invSortHorizontalBtn');
const statusEl = document.getElementById('invSortStatus');
const hintEl = document.getElementById('invSortHint');

let _sorting = false;
let _confirmMode = null;
let _confirmTimer = null;

const LABELS = {
    default: 'Default Sort',
    horizontal: 'Horizontal Sort'
};

function setButtonsEnabled(enabled) {
    [defaultBtn, horizontalBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = !enabled;
        btn.style.opacity = enabled ? '' : '0.45';
    });
}

function resetConfirm() {
    if (_confirmTimer) { clearTimeout(_confirmTimer); _confirmTimer = null; }
    _confirmMode = null;
    if (defaultBtn) {
        defaultBtn.classList.remove('inv-sort-confirm');
        defaultBtn.textContent = LABELS.default;
    }
    if (horizontalBtn) {
        horizontalBtn.classList.remove('inv-sort-confirm');
        horizontalBtn.textContent = LABELS.horizontal;
    }
}

function render(progress, sorting) {
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
    if (!_sorting) resetConfirm();
}

async function startSort(mode) {
    if (_sorting) return;
    const btn = mode === 'horizontal' ? horizontalBtn : defaultBtn;
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

if (defaultBtn) {
    defaultBtn.addEventListener('click', (e) => { e.stopPropagation(); startSort('default'); });
}
if (horizontalBtn) {
    horizontalBtn.addEventListener('click', (e) => { e.stopPropagation(); startSort('horizontal'); });
}

function loadState() {
    chrome.storage.local.get(['stashSortProgress', 'stashSorting'], (data) => {
        render(data.stashSortProgress || null, !!data.stashSorting);
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.stashSortProgress || changes.stashSorting) {
        chrome.storage.local.get(['stashSortProgress', 'stashSorting'], (data) => {
            render(data.stashSortProgress || null, !!data.stashSorting);
        });
    }
});

loadState();
