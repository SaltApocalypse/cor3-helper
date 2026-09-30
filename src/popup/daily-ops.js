import { _h, _noData } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state } from './state.js';

const dailyTimerLine = document.getElementById('dailyTimerLine');
const dailyStatusLine = document.getElementById('dailyStatusLine');
const dailyClaimed = document.getElementById('dailyClaimed');
const dailyStreak = document.getElementById('dailyStreak');
const dailyDifficulty = document.getElementById('dailyDifficulty');
const dailyStreakBonus = document.getElementById('dailyStreakBonus');
const refreshDailyBtn = document.getElementById('refreshDailyBtn');

export function updateDailyTimer() {
    if (!state.dailyNextTaskTime) {
        dailyTimerLine.textContent = '⏳ Next Task: --:--:--';
        return;
    }
    const now = Date.now();
    const diff = state.dailyNextTaskTime - now;
    if (diff <= 0) {
        dailyTimerLine.textContent = '⏳ Next Task: 0h:0m:0s';
        return;
    }
    const totalSec = Math.floor(diff / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    dailyTimerLine.textContent = `⏳ Next Task: ${h}h:${m}m:${s}s`;
}

function calcStreakBonus(streak, rewardsData) {
    if (!rewardsData || !Array.isArray(rewardsData) || streak === undefined || streak === null) return '--';
    const dayEntry = rewardsData.find(r => r.day === streak);
    if (dayEntry && dayEntry.amount !== undefined) return (dayEntry.amount / 100).toFixed(2);
    const sorted = rewardsData.filter(r => r.day <= streak).sort((a, b) => b.day - a.day);
    if (sorted.length > 0 && sorted[0].amount !== undefined) return (sorted[0].amount / 100).toFixed(2);
    return '--';
}

export async function displayDailyOpsData(data) {
    if (!data) return;
    state.dailyNextTaskTime = data.nextTaskTime ? new Date(data.nextTaskTime).getTime() : null;
    dailyClaimed.textContent = data.hasClaimedToday ? 'Yes' : 'No';
    dailyStreak.textContent = data.currentStreak ?? '--';
    dailyDifficulty.textContent = data.difficulty ? ((data.difficulty).charAt(0).toUpperCase() + (data.difficulty).slice(1)) : '--';
    const { dailyRewardsData } = await chrome.storage.local.get('dailyRewardsData');
    const bonus = calcStreakBonus(data.currentStreak, dailyRewardsData);
    dailyStreakBonus.textContent = bonus;
    updateDailyTimer();
}

export async function fetchDailyOps() {
    dailyStatusLine.style.display = '';
    dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-cyan);'}, '⏳ Refreshing daily ops...'));

    try {
        const tab = await getCor3Tab();
        if (!tab) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ No cor3.gg tab found'));
            return;
        }

        console.log('[COR3 Helper] Sending fetchDailyOps message to content script');
        const response = await chrome.tabs.sendMessage(tab.id, { action: "fetchDailyOps" });

        if (response && response.error && (response.error === 'token_expired' || response.error.includes('Invalid access token'))) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ Access token expired. Page refresh required.'));
            return;
        }

        if (response && response.data) {
            console.log('[COR3 Helper] Daily ops data received:', response.data);
            await displayDailyOpsData(response.data);
            dailyStatusLine.style.display = 'none';
            refreshAllTimestamps();
        } else if (response === undefined) {
            console.log('[COR3 Helper] No response from content script, trying cached data');
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                await displayDailyOpsData(dailyOpsData);
                dailyStatusLine.style.display = '';
                dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-orange);'}, '⚠️ Using cached data (content script not responding)'));
            } else {
                dailyStatusLine.style.display = '';
                dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ No data available. Refresh the page.'));
            }
        } else {
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) await displayDailyOpsData(dailyOpsData);
        }
    } catch (e) {
        console.log('[COR3 Helper] Daily ops fetch error:', e);
        cor3LogError('popup.js', e, { action: 'fetchDailyOps' });
        try {
            const { dailyOpsData } = await chrome.storage.local.get('dailyOpsData');
            if (dailyOpsData) {
                await displayDailyOpsData(dailyOpsData);
                dailyStatusLine.style.display = '';
                dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-orange);'}, '⚠️ Using cached data (error occurred)'));
            } else {
                dailyStatusLine.style.display = '';
                dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ Failed to load daily ops'));
            }
        } catch (e2) {
            dailyStatusLine.style.display = '';
            dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ Failed to load daily ops'));
        }
    }
}

export async function loadCachedDailyOps() {
    try {
        const { dailyOpsData, dailyOpsError } = await chrome.storage.local.get(['dailyOpsData', 'dailyOpsError']);
        if (dailyOpsError === 'token_expired') {
            dailyStatusLine.style.display = '';
            dailyStatusLine.replaceChildren(_h('span', {style: 'color:var(--accent-red);'}, '⚠️ Access token expired. Page refresh required.'));
        }
        if (dailyOpsData) await displayDailyOpsData(dailyOpsData);
    } catch (e) {}
}

export function initDailyOps() {
    loadCachedDailyOps();
    refreshDailyBtn.addEventListener('click', () => fetchDailyOps());
}

initDailyOps();
