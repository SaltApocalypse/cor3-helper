import { getCor3Tab, formatTimeRemaining } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { updateDailyTimer } from './daily-ops.js';
import { updatePinnedTimerValues } from './pinned-timers.js';
import { getMarketContainers } from './markets.js';
import { state } from './state.js';

async function sendAutoRefreshToContent() {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "updateAutoRefresh",
            autoRefresh: state.autoRefresh
        }).catch(() => {});
    }
}

chrome.storage.sync.get('autoRefresh', (data) => {
    if (data.autoRefresh) state.autoRefresh = data.autoRefresh;
    sendAutoRefreshToContent();
});

function checkAutoRefreshFromPopup() {
    // No-op: content.js handles sequential auto-refresh for all markets.
    // Popup UI refreshes via storage listeners when new market data is written.
}

const { marketContainer, darkMarketContainer, soyuzMarketContainer, usolMarketContainer } = getMarketContainers();

setInterval(() => {
    updateDailyTimer();

    if (state.coreNextJobsResetAt) {
        const homeResetEl = marketContainer.querySelector('.home-reset-timer');
        if (homeResetEl) {
            homeResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(state.coreNextJobsResetAt)}`;
        }
    }
    if (state.bmiNextJobsResetAt) {
        const darkResetEl = darkMarketContainer.querySelector('.dark-reset-timer');
        if (darkResetEl) {
            darkResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(state.bmiNextJobsResetAt)}`;
        }
    }
    if (state.soyuzNextJobsResetAt) {
        const soyuzResetEl = soyuzMarketContainer.querySelector('.soyuz-reset-timer');
        if (soyuzResetEl) {
            soyuzResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(state.soyuzNextJobsResetAt)}`;
        }
    }
    if (state.usolNextJobsResetAt) {
        const usolResetEl = usolMarketContainer.querySelector('.usol-reset-timer');
        if (usolResetEl) {
            usolResetEl.textContent = `⏳ Jobs Reset: ${formatTimeRemaining(state.usolNextJobsResetAt)}`;
        }
    }

    document.querySelectorAll('.exp-timer').forEach(el => {
        const expId = el.dataset.expId;
        const endTime = state.expeditionEndTimes[expId];
        if (endTime) el.textContent = formatTimeRemaining(endTime);
    });

    document.querySelectorAll('.auto-jobs-reset-timer').forEach(el => {
        const resetAt = el.dataset.resetAt;
        if (resetAt) el.textContent = '⏳ Jobs Reset: ' + formatTimeRemaining(resetAt);
    });

    updatePinnedTimerValues();

    checkAutoRefreshFromPopup();
}, 1000);

setInterval(() => refreshAllTimestamps(), 30000);
