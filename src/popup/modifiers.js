// Decision automation settings.
//
// - Auto-resolve decisions: mercenary expeditions use autoSendMerc.autoResolveDecisions.
// - Aggressive decisions: shared by mercenary and drone decisions.
import { renderDecisions, checkAutoChoose } from './expeditions.js';

const autoResolveMercToggle = document.getElementById('autoChooseCheckbox');
const aggressiveMercToggle = document.getElementById('aggressiveDecisionsToggle');
const aggressiveDroneToggle = document.getElementById('aggressiveDecisionsDroneToggle');

let _aggressive = false;

export function reRenderDecisions() {
    chrome.storage.local.get('expeditionDecisions', (result) => {
        const decisions = result.expeditionDecisions || [];
        renderDecisions(decisions);
        checkAutoChoose(decisions);
    });
}

function saveMercAutoResolve() {
    if (!autoResolveMercToggle) return;
    chrome.storage.sync.get('autoSendMerc', (data) => {
        const existing = data.autoSendMerc || {};
        chrome.storage.sync.set({
            autoSendMerc: Object.assign({}, existing, {
                autoResolveDecisions: !!autoResolveMercToggle.checked
            })
        });
    });
}

function saveAggressive() {
    _aggressive = !!(aggressiveMercToggle && aggressiveMercToggle.checked) ||
        !!(aggressiveDroneToggle && aggressiveDroneToggle.checked);
    chrome.storage.sync.set({ aggressiveDecisions: _aggressive });
    if (aggressiveMercToggle) aggressiveMercToggle.checked = _aggressive;
    if (aggressiveDroneToggle) aggressiveDroneToggle.checked = _aggressive;
    reRenderDecisions();
}

if (autoResolveMercToggle) {
    autoResolveMercToggle.addEventListener('change', () => {
        saveMercAutoResolve();
        reRenderDecisions();
    });
}
if (aggressiveMercToggle) aggressiveMercToggle.addEventListener('change', saveAggressive);
if (aggressiveDroneToggle) aggressiveDroneToggle.addEventListener('change', saveAggressive);

function applySettings() {
    chrome.storage.sync.get(['autoSendMerc', 'aggressiveDecisions', 'decisionModifiers'], (data) => {
        const merc = data.autoSendMerc || {};
        const enabled = merc.autoResolveDecisions !== undefined
            ? !!merc.autoResolveDecisions
            : !!(data.decisionModifiers && data.decisionModifiers.autoChoose);
        if (autoResolveMercToggle) autoResolveMercToggle.checked = enabled;

        _aggressive = !!data.aggressiveDecisions;
        if (aggressiveMercToggle) aggressiveMercToggle.checked = _aggressive;
        if (aggressiveDroneToggle) aggressiveDroneToggle.checked = _aggressive;
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.autoSendMerc || changes.aggressiveDecisions) applySettings();
});

applySettings();
