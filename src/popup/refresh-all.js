import { _noData } from './dom-helpers.js';
import { getCor3Tab, humanDelay, waitForStorageKey } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { fetchDailyOps } from './daily-ops.js';
import { loadExpeditions, renderDecisions, requestExpeditions } from './expeditions.js';
import { loadMarket, loadDarkMarket, loadSoyuzMarket, loadUsolMarket, refreshMarket1Only, setDarkMarketEndpoint, refreshMarket2Only, refreshMarket3Only, refreshMarket4Only } from './markets.js';
import { loadInventory } from './inventory.js';
import { loadMercenaries, requestMercenaries } from './mercenaries.js';
import { loadLoadout } from './loadout.js';
import { refreshArchivedOnly, loadArchivedExpeditions } from './archived-expeditions.js';

const refreshAllBtn = document.getElementById('refreshAllBtn');
const refreshDailyBtn = document.getElementById('refreshDailyBtn');
const refreshExpeditionsBtn = document.getElementById('refreshExpeditionsBtn');

const inventoryContainer = document.getElementById('inventoryContainer');
const spaceInfo = document.getElementById('spaceInfo');
const mercenariesContainer = document.getElementById('mercenariesContainer');
const expeditionInfoContainer = document.getElementById('expeditionInfoContainer');

let isRefreshing = false;

refreshExpeditionsBtn.addEventListener('click', () => requestExpeditions());

async function refreshExpeditionsOnly() {
    expeditionInfoContainer.replaceChildren(_noData('Loading expedition data...'));
    await chrome.storage.local.remove(['expeditionsData', 'expeditionDecisions']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) {}
    await waitForStorageKey('expeditionsData', 8000);
    await loadExpeditions();
    refreshAllTimestamps();
    resetExpeditionUpdateTimer();
}

async function refreshInventoryOnly() {
    inventoryContainer.replaceChildren(_noData('Requesting inventory...'));
    spaceInfo.textContent = '-- / --';
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestStash" });
    } catch (e) {}
    await waitForStorageKey('stashData', 5000);
    await loadInventory();
    refreshAllTimestamps();
}

async function refreshMercenariesOnly() {
    mercenariesContainer.replaceChildren(_noData('Loading mercenaries...'));
    try {
        const tab = await getCor3Tab();
        if (tab) {
            await chrome.storage.local.remove(['coreMercsDone', 'usolMercsDone']);
            await chrome.tabs.sendMessage(tab.id, { action: "requestMercenaries" });
            await waitForStorageKey('coreMercsDone', 30000);
            try { await chrome.tabs.sendMessage(tab.id, { action: "requestUsolMercenaries" }); } catch (e) {}
            await waitForStorageKey('usolMercsDone', 30000).catch(() => {});
        }
    } catch (e) {}
    await loadMercenaries();
    refreshAllTimestamps();
}

async function refreshLoadoutOnly() {
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestLoadout" });
    } catch (e) {}
    await waitForStorageKey('loadoutData', 5000);
    await loadLoadout();
    refreshAllTimestamps();
}

refreshAllBtn.addEventListener('click', async () => {
    if (isRefreshing) return;
    isRefreshing = true;
    refreshAllBtn.classList.add('spinning');

    try {
        await executeRefreshStep('dailyOps', fetchDailyOps);
        await humanDelay();

        await executeRefreshStep('market1', refreshMarket1Only);
        await humanDelay();

        await executeRefreshStep('setDarkEndpoint', setDarkMarketEndpoint);
        await humanDelay();

        await executeRefreshStep('market2', refreshMarket2Only);
        await humanDelay();

        await executeRefreshStep('market3', refreshMarket3Only);
        await humanDelay();

        await executeRefreshStep('market4', refreshMarket4Only);
        await humanDelay();

        await executeRefreshStep('expeditions', refreshExpeditionsOnly);
        await humanDelay();

        await executeRefreshStep('decisions', async () => {
            const { expeditionDecisions } = await chrome.storage.local.get('expeditionDecisions');
            renderDecisions(expeditionDecisions || []);
        });
        await humanDelay();

        await executeRefreshStep('inventory', refreshInventoryOnly);
        await humanDelay();

        await executeRefreshStep('mercenaries', refreshMercenariesOnly);
        await humanDelay();

        await executeRefreshStep('archived', refreshArchivedOnly);
        await humanDelay();

        await executeRefreshStep('loadout', refreshLoadoutOnly);

    } catch (e) {
        console.log('[COR3 Helper] Refresh All error:', e);
        cor3LogError('popup.js', e, { action: 'refreshAll' });
    }

    refreshAllBtn.classList.remove('spinning');
    isRefreshing = false;
    refreshAllTimestamps();
});

async function executeRefreshStep(name, operation) {
    try {
        console.log(`[COR3 Helper] Refresh All: Starting ${name}`);
        await operation();
        console.log(`[COR3 Helper] Refresh All: Completed ${name}`);
    } catch (error) {
        console.log(`[COR3 Helper] Refresh All: Failed ${name}:`, error);
        cor3LogError('popup.js', error, { action: 'refreshStep-' + name });
    }
}

export function resetExpeditionUpdateTimer() {
    const now = Date.now();
    chrome.storage.local.set({ expeditionsDataUpdatedAt: now });
    console.log('[COR3 Helper] Expedition update timer reset');
}
