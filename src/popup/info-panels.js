// Info Panel visibility toggles (Markets) — information panels, not automation.
const marketsPanelToggle = document.getElementById('marketsPanelToggle');
const marketsPanelStatus = document.getElementById('marketsPanelStatus');
const marketsPanelSection = document.getElementById('marketsPanelSection');

function applyPanelVisibility(toggleEl, statusEl, section, key) {
    const enabled = toggleEl.checked;
    if (statusEl) {
        statusEl.textContent = enabled ? 'On' : 'Off';
        statusEl.style.color = enabled ? 'var(--accent-green)' : 'var(--text-dim)';
    }
    if (section) {
        section.style.display = enabled ? '' : 'none';
        const card = section.closest('.popout-card');
        if (card) card.style.display = enabled ? '' : 'none';
    }
    chrome.storage.sync.set({ [key]: enabled });
}

chrome.storage.sync.get('marketsPanelEnabled', (data) => {
    if (marketsPanelToggle) marketsPanelToggle.checked = data.marketsPanelEnabled !== false;
    if (marketsPanelToggle && marketsPanelStatus && marketsPanelSection) {
        applyPanelVisibility(marketsPanelToggle, marketsPanelStatus, marketsPanelSection, 'marketsPanelEnabled');
    }
});

if (marketsPanelToggle && marketsPanelStatus && marketsPanelSection) {
    marketsPanelToggle.addEventListener('change', () =>
        applyPanelVisibility(marketsPanelToggle, marketsPanelStatus, marketsPanelSection, 'marketsPanelEnabled'));
}
