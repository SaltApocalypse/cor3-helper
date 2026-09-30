// --- Storage change listeners NOT covered by individual module self-init ---
// Markets, inventory, loadout, and mercenaries already register their own
// storage listeners via initMarketStorageListener(), initInventoryStorageListener(),
// initLoadoutStorageListener(), and inline listeners in mercenaries.js.
// This module handles the remaining cases.

import { refreshAllTimestamps } from './timestamps.js';
import { loadExpeditions } from './expeditions.js';
import { loadArchivedExpeditions } from './archived-expeditions.js';
import { loadCachedDailyOps } from './daily-ops.js';

const mercWarning = document.getElementById('mercWarning');

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Expedition data (not handled by expeditions.js — it only caches for veteran check)
    if (changes.expeditionsData) {
        loadExpeditions();
        refreshAllTimestamps();
    }

    // Archived expeditions
    if (changes.archivedExpeditionsData) {
        loadArchivedExpeditions();
    }

    // Mercenary warning (separate from merc data listener in mercenaries.js)
    if (changes.mercWarning) {
        const warning = changes.mercWarning.newValue;
        if (warning && mercWarning) {
            mercWarning.textContent = '⚠️ ' + warning;
            mercWarning.style.borderColor = 'var(--accent-orange)';
            mercWarning.style.color = 'var(--accent-orange)';
            mercWarning.style.background = 'rgba(255,160,0,0.15)';
            mercWarning.style.display = '';
        }
    }

    // Daily ops data
    if (changes.dailyOpsData) {
        loadCachedDailyOps();
        refreshAllTimestamps();
    }
});
