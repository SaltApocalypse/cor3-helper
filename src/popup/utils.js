export async function getCor3Tab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && activeTab.url && (activeTab.url.includes('cor3.gg') || activeTab.url.includes('os.cor3.gg'))) {
        return activeTab;
    }
    const allTabs = await chrome.tabs.query({ url: ['https://cor3.gg/*', 'https://os.cor3.gg/*'] });
    return allTabs.length > 0 ? allTabs[0] : null;
}

export function formatTimeAgo(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Updated just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `Updated ${hrs}h ${remMins}m ago`;
}

export function showLastUpdated(el, tsKey) {
    chrome.storage.local.get(tsKey, (result) => {
        const ts = result[tsKey];
        el.textContent = ts ? formatTimeAgo(ts) : '';
    });
}

export function formatTimeRemaining(dateStr) {
    if (!dateStr) return '--';
    const diff = new Date(dateStr).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h}h:${m}m:${s}s`;
}

export function getRemainingSeconds(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(dateStr).getTime() - Date.now();
    return diff > 0 ? Math.floor(diff / 1000) : 0;
}

export function humanDelay(min = 400, max = 900) {
    return new Promise(r => setTimeout(r, min + Math.floor(Math.random() * (max - min))));
}

export function waitForStorageKey(key, timeoutMs = 8000) {
    return new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(key);
            if (data[key]) { clearInterval(poll); if (!done) { done = true; resolve(true); } }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(false); } }, timeoutMs);
    });
}

export function updateSelectAllState(selectAllCb, checkboxes) {
    if (checkboxes.length === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        return;
    }
    const checkedCount = checkboxes.filter(cb => cb.checked).length;
    selectAllCb.checked = checkedCount === checkboxes.length;
    selectAllCb.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}
