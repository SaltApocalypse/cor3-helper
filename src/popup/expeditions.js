// --- Expedition Info + Decisions (inline) ---
import { getCor3Tab, formatTimeRemaining } from './utils.js';
import { el, clearEl, noDataMsg } from './dom-helpers.js';
import { refreshAllTimestamps } from './timestamps.js';
import { state } from './state.js';
import { savePinnedState, renderPinnedTimers } from './pinned-timers.js';
import { t, translateErrorText } from './i18n.js';

const expeditionInfoContainer = document.getElementById('expeditionInfoContainer');

const personalDroneSectionToggle = document.getElementById('personalDroneSectionToggle');
const personalDroneSectionBody = document.getElementById('personalDroneSectionBody');

if (personalDroneSectionToggle && personalDroneSectionBody) {
    personalDroneSectionToggle.addEventListener('click', async () => {
        personalDroneSectionToggle.classList.toggle('open');
        personalDroneSectionBody.classList.toggle('open');
    });
}

// On popup open: load cached expeditions (no WS requests)
loadExpeditions();

function renderExpeditionError(error) {
    const now = Date.now();
    if (error.noRetry) {
        return el('div', { className: 'warning-banner', style: 'background:rgba(255,80,80,0.15);border-color:var(--accent-red);color:var(--accent-red);' },
            el('div', { style: { fontWeight: 'bold', marginBottom: '4px' } }, t('❌ Expedition Error', '❌ 远征错误')),
            el('div', { style: { fontSize: '10px' } }, translateErrorText(error.error)),
            el('div', { style: { fontSize: '10px', marginTop: '4px' } }, t('Re-enable Auto expedition to retry.', '请重新启用“自动远征”后重试。'))
        );
    }
    const retryAfter = error.retryAfter || 120000;
    const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));
    if (timeUntilRetry > 0) {
        const retryMinutes = Math.ceil(timeUntilRetry / 60000);
        return el('div', { className: 'warning-banner', style: 'background:rgba(255,165,0,0.15);border-color:var(--accent-orange);color:var(--accent-orange);' },
            el('div', { style: { fontWeight: 'bold', marginBottom: '4px' } }, t('⚠️ Expedition Launch Failed', '⚠️ 远征派遣失败')),
            el('div', { style: { fontSize: '10px' } }, translateErrorText(error.error)),
            el('div', { style: { fontSize: '10px', marginTop: '4px' } }, t(`Retrying in ${retryMinutes} minute${retryMinutes !== 1 ? 's' : ''}...`, `将在 ${retryMinutes} 分钟后重试...`))
        );
    }
    chrome.storage.local.remove('expeditionLaunchError');
    return null;
}

function buildContainerItems(containerData) {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('div', { className: 'detail-row', style: 'color:var(--accent-green);font-weight:bold;' }, 'Items Found:'));
    for (const item of containerData) {
        const tierColor = item.tier === 'RARE' ? 'var(--accent-blue)' : item.tier === 'EPIC' ? 'var(--accent-purple,#a855f7)' : item.tier === 'LEGENDARY' ? 'var(--accent-orange)' : 'var(--text-dim)';
        const img = el('img', { src: item.imageUrl, style: 'width:32px;height:32px;border-radius:4px;background:rgba(255,255,255,0.05);' });
        img.onerror = function() { this.style.display = 'none'; };
        frag.appendChild(
            el('div', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;' },
                img,
                el('div', { style: 'flex:1;min-width:0;' },
                    el('div', { style: 'font-size:11px;font-weight:bold;color:var(--text-primary);' }, `${item.name} x${item.quantity}`),
                    el('div', { style: `font-size:9px;color:${tierColor};` }, item.tier)
                )
            )
        );
    }
    return frag;
}

export function renderExpeditionInfo(expeditions) {
    clearEl(expeditionInfoContainer);

    chrome.storage.local.get('expeditionLaunchError', (result) => {
        if (result.expeditionLaunchError) {
            const errorEl = renderExpeditionError(result.expeditionLaunchError);
            if (errorEl) expeditionInfoContainer.appendChild(errorEl);
        }
    });

    if (!expeditions || expeditions.length === 0) {
        if (!expeditionInfoContainer.hasChildNodes()) {
            expeditionInfoContainer.appendChild(noDataMsg('No active expeditions.'));
        }
        return;
    }

    for (const exp of expeditions) {
        if (exp.endTime) {
            state.expeditionEndTimes[exp.id] = exp.endTime;
        }

        const card = document.createElement('div');
        card.className = 'expedition-card';

        const statusClass = exp.status === 'RUNNING' ? ' running' : '';
        const mercName = exp.mercenary ? exp.mercenary.callsign : 'Unknown';
        const insurance = exp.hasInsurance ? 'Yes' : 'No';

        // Header
        const header = el('div', { className: 'exp-header' },
            el('span', { className: 'exp-title' }, `📍 ${exp.locationName || 'Unknown'} — ${exp.zoneName || 'Unknown'}`),
            el('span', { className: 'exp-status' + statusClass }, exp.status || 'UNKNOWN')
        );
        card.appendChild(header);

        const payAndOpenMsg = exp.messages && exp.messages.find(m => m.actionType === 'pay_and_open');
        const hasContainerData = exp.containerData && Array.isArray(exp.containerData) && exp.containerData.length > 0;

        if (hasContainerData) {
            card.appendChild(buildContainerItems(exp.containerData));
        } else if (payAndOpenMsg && exp.status === 'COMPLETED' && !exp.containerOpenedAt) {
            const ad = payAndOpenMsg.actionData || {};
            const row = el('div', { style: 'display:flex;align-items:center;gap:10px;' },
                el('div', { style: 'flex:1;' },
                    el('div', { className: 'detail-row' },
                        el('span', { className: 'label' }, 'Open Cost:'), ` 💰 ${(ad.cost || 0).toLocaleString()}`
                    ),
                    el('div', { className: 'detail-row' },
                        el('span', { className: 'label' }, 'Items Inside:'), ` 📦 ${ad.itemCount || '?'}`
                    )
                )
            );
            if (ad.containerImageUrl) {
                const cImg = el('img', { src: ad.containerImageUrl, style: 'width:48px;height:48px;border-radius:6px;background:rgba(255,255,255,0.05);' });
                cImg.onerror = function() { this.style.display = 'none'; };
                row.appendChild(cImg);
            }
            card.appendChild(row);
        } else {
            const mercRow = el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Mercenary:'), ` 🧑 ${mercName}`
            );
            if (exp.specialization === "PROSPECTOR") {
                mercRow.appendChild(el('span', { className: 'merc-elite-badge' }, 'ELITE'));
            }
            card.appendChild(mercRow);
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Total Cost:'), ` 💰 ${exp.totalCost ? exp.totalCost.toLocaleString() : '--'}`
            ));
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Insurance:'), ` ${insurance}`
            ));
            card.appendChild(el('div', { className: 'detail-row' },
                el('span', { className: 'label' }, 'Risk Score:'), ` ${exp.riskScore ?? '--'}`
            ));

            if (exp.endTime) {
                const timerSpan = el('span', { className: 'exp-timer', dataset: { expId: exp.id } }, formatTimeRemaining(exp.endTime));
                const pinBtn = el('button', { className: 'refresh-btn-small pin-btn pin-exp-btn', dataset: { expId: exp.id }, title: 'Pin Expedition Timer' }, '📌');
                card.appendChild(el('div', { className: 'exp-timer-row' },
                    el('span', { style: 'font-size:11px;color:var(--accent-orange);' }, '⏳ ', timerSpan),
                    pinBtn
                ));
            }
        }

        expeditionInfoContainer.appendChild(card);
    }

    // Wire up pin buttons
    expeditionInfoContainer.querySelectorAll('.pin-exp-btn').forEach(btn => {
        const expId = btn.dataset.expId;
        btn.classList.toggle('pinned', !!state.pinnedTimers['exp_' + expId]);
        btn.addEventListener('click', async () => {
            const key = 'exp_' + expId;
            state.pinnedTimers[key] = !state.pinnedTimers[key];
            btn.classList.toggle('pinned', !!state.pinnedTimers[key]);
            await savePinnedState();
            renderPinnedTimers();
        });
    });
}

export async function loadExpeditions() {
    const { expeditionsData } = await chrome.storage.local.get('expeditionsData');
    renderExpeditionInfo(expeditionsData || []);
    refreshAllTimestamps();

    setInterval(() => {
        chrome.storage.local.get('expeditionLaunchError', (result) => {
            if (result.expeditionLaunchError) {
                const error = result.expeditionLaunchError;
                const now = Date.now();
                const retryAfter = error.retryAfter || 120000;
                const timeUntilRetry = Math.max(0, retryAfter - (now - error.timestamp));

                if (timeUntilRetry <= 0) {
                    chrome.storage.local.remove('expeditionLaunchError');
                    loadExpeditions();
                }
            }
        });
    }, 30000);
}

export async function requestExpeditions() {
    expeditionInfoContainer.replaceChildren(noDataMsg('Loading expedition data...'));
    await chrome.storage.local.remove(['expeditionsData', 'expeditionDecisions']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestExpeditions" });
    } catch (e) { /* not reachable */ }
    let loaded = false;
    const poll = setInterval(async () => {
        const { expeditionsData } = await chrome.storage.local.get('expeditionsData');
        if (expeditionsData) {
            clearInterval(poll);
            if (loaded) return;
            loaded = true;
            await loadExpeditions();
        }
    }, 300);
    setTimeout(() => {
        clearInterval(poll);
        if (!loaded) {
            loaded = true;
            expeditionInfoContainer.replaceChildren(noDataMsg('No active expeditions.'));
        }
    }, 5000);
}
