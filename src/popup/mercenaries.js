// --- Mercenary automation: two switches only ---
import { getCor3Tab, waitForStorageKey } from './utils.js';
import { state } from './state.js';
import { loadExpeditions } from './expeditions.js';
import { translateErrorText } from './i18n.js';

const autoSendMercenaryToggle = document.getElementById('autoSendMercenaryToggle');
const mercInsuranceToggle = document.getElementById('mercInsuranceToggle');
const mercWarning = document.getElementById('mercWarning');

const PAUSE_REASONS = {
    stash_full: 'Auto expedition paused: stash is full. Clear stash space, then turn Auto expedition off and on to resume.',
    insufficient_credits: 'Auto expedition paused: not enough credits. Earn credits, then turn Auto expedition off and on to resume.'
};

let _settings = { enabled: false, hasInsurance: false, disabledReason: null };
let _localWarning = '';

function normalizeSettings(raw) {
    const settings = raw || {};
    return {
        enabled: !!settings.enabled,
        hasInsurance: !!settings.hasInsurance,
        disabledReason: settings.disabledReason || null
    };
}

function setWarningText(text) {
    if (!mercWarning) return;
    if (!text) {
        mercWarning.style.display = 'none';
        mercWarning.textContent = '';
        return;
    }
    mercWarning.textContent = '⚠️ ' + translateErrorText(text);
    mercWarning.style.borderColor = 'var(--accent-orange)';
    mercWarning.style.color = 'var(--accent-orange)';
    mercWarning.style.background = 'rgba(255,160,0,0.15)';
    mercWarning.style.display = '';
}

function renderWarning() {
    const parts = [];
    if (_settings.disabledReason) {
        parts.push(PAUSE_REASONS[_settings.disabledReason] ||
            'Auto expedition paused: ' + _settings.disabledReason + '. Turn Auto expedition off and on to retry.');
    }
    if (_localWarning) parts.push(_localWarning);
    setWarningText(parts.join(' '));
}

export function updateMercWarning(settings, localWarning) {
    _settings = normalizeSettings(settings);
    if (localWarning !== undefined) _localWarning = localWarning || '';
    renderWarning();
}

export async function requestMercenaries() {
    try {
        const tab = await getCor3Tab();
        if (!tab) return;
        await chrome.storage.local.remove(['coreMercsDone', 'usolMercsDone']);
        await chrome.tabs.sendMessage(tab.id, { action: "requestMercenaries" });
        await waitForStorageKey('coreMercsDone', 30000);
        try { await chrome.tabs.sendMessage(tab.id, { action: "requestUsolMercenaries" }); } catch (e) {}
        await waitForStorageKey('usolMercsDone', 30000).catch(() => {});
    } catch (e) { /* not reachable */ }
}

function applySettingsToUi(raw) {
    _settings = normalizeSettings(raw);
    if (autoSendMercenaryToggle) autoSendMercenaryToggle.checked = _settings.enabled;
    if (mercInsuranceToggle) mercInsuranceToggle.checked = _settings.hasInsurance;
    renderWarning();
}

// Load settings and migrate the old multi-toggle object to the two-switch model.
chrome.storage.sync.get('autoSendMerc', (data) => {
    const raw = data.autoSendMerc || {};
    applySettingsToUi(raw);
    const allowed = new Set(['enabled', 'hasInsurance', 'disabledReason']);
    const hasLegacyKeys = Object.keys(raw).some(k => !allowed.has(k));
    if (hasLegacyKeys) {
        chrome.storage.sync.set({ autoSendMerc: normalizeSettings(raw) });
    }
    chrome.storage.local.get('mercWarning', (local) => {
        _localWarning = local.mercWarning || '';
        renderWarning();
    });
});

function saveSettings(clearDisabledReason) {
    if (state.isHelper) return;
    const enabled = !!autoSendMercenaryToggle.checked;
    const hasInsurance = !!mercInsuranceToggle.checked;
    chrome.storage.sync.get('autoSendMerc', (data) => {
        const existing = data.autoSendMerc || {};
        chrome.storage.sync.set({
            autoSendMerc: {
                enabled,
                hasInsurance,
                disabledReason: clearDisabledReason ? null : (existing.disabledReason || null)
            }
        });
    });
}

if (autoSendMercenaryToggle) {
    autoSendMercenaryToggle.addEventListener('change', () => {
        saveSettings(true);
        if (autoSendMercenaryToggle.checked) {
            _localWarning = '';
            if (mercWarning) mercWarning.style.display = 'none';
            chrome.storage.local.remove(['expeditionLaunchError', 'mercWarning']);
            loadExpeditions();
        } else {
            _localWarning = '';
            chrome.storage.local.remove(['expeditionLaunchError', 'mercWarning']);
            renderWarning();
        }
    });
}

if (mercInsuranceToggle) {
    mercInsuranceToggle.addEventListener('change', () => {
        saveSettings(false);
        // Refresh configure quotes so auto-selection uses insurance-adjusted costs.
        setTimeout(() => requestMercenaries(), 300);
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.autoSendMerc) {
        applySettingsToUi(changes.autoSendMerc.newValue || {});
    }
    if (area === 'local' && changes.mercWarning) {
        _localWarning = changes.mercWarning.newValue || '';
        renderWarning();
    }
});
