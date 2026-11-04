// --- Storage change listeners NOT covered by individual module self-init ---
// Markets, inventory, loadout, and mercenaries already register their own
// storage listeners via initMarketStorageListener(), initInventoryStorageListener(),
// initLoadoutStorageListener(), and inline listeners in mercenaries.js.
// This module handles the remaining cases.

import { refreshAllTimestamps } from './timestamps.js';
import { loadExpeditions } from './expeditions.js';
import { loadArchivedExpeditions } from './archived-expeditions.js';
import { loadCachedDailyOps } from './daily-ops.js';

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // Expedition data changes
    if (changes.expeditionsData) {
        loadExpeditions();
        refreshAllTimestamps();
    }

    // Archived expeditions
    if (changes.archivedExpeditionsData) {
        loadArchivedExpeditions();
    }

    // Daily ops data
    if (changes.dailyOpsData) {
        loadCachedDailyOps();
        refreshAllTimestamps();
    }
});
