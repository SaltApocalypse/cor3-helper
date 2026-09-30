import { _h, _noData, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab, waitForStorageKey } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';

const archivedExpSectionToggle = document.getElementById('archivedExpSectionToggle');
const archivedExpSectionBody = document.getElementById('archivedExpSectionBody');
const archivedExpContainer = document.getElementById('archivedExpContainer');
const refreshArchivedBtn = document.getElementById('refreshArchivedBtn');

archivedExpSectionToggle.addEventListener('click', () => {
    archivedExpSectionToggle.classList.toggle('open');
    archivedExpSectionBody.classList.toggle('open');
});

async function requestArchivedExpeditions() {
    archivedExpContainer.replaceChildren(_noData('Loading archived expeditions...'));
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestArchivedExpeditions" });
    } catch (e) { /* not reachable */ }
    setTimeout(() => loadArchivedExpeditions(), 3000);
}

if (refreshArchivedBtn) {
    refreshArchivedBtn.addEventListener('click', () => requestArchivedExpeditions());
}

export async function loadArchivedExpeditions() {
    const { archivedExpeditionsData } = await chrome.storage.local.get('archivedExpeditionsData');
    renderArchivedExpeditions(archivedExpeditionsData);
    refreshAllTimestamps();
}

function renderArchivedExpeditions(data) {
    if (!archivedExpContainer) return;
    _clearEl(archivedExpContainer);

    let items = data;
    if (data && !Array.isArray(data) && data.items) items = data.items;
    if (data && !Array.isArray(data) && data.data) items = data.data;

    if (!items || !Array.isArray(items) || items.length === 0) {
        archivedExpContainer.replaceChildren(_noData('No archived expeditions found.'));
        return;
    }
    for (const exp of items) {
        const card = document.createElement('div');
        card.className = 'archived-exp-card';

        const factionDisplay = (exp.mercenary && exp.mercenary.faction) ? ((exp.mercenary.faction.name || '').replace('factions.', '').replace(/([A-Z])/g, ' $1').trim().split(" ")[0].toUpperCase()) : 'UNEMPLOYED';
        const mercName = exp.mercenary ? exp.mercenary.callsign : 'Unknown';
        const outcome = (exp.outcome || exp.status || 'COMPLETED').toUpperCase();
        let outcomeClass = 'outcome-full';
        if (outcome.includes('PARTIAL')) outcomeClass = 'outcome-partial';
        else if (outcome.includes('FAIL')) outcomeClass = 'outcome-fail';
        else if (outcome.includes('DEATH')) outcomeClass = 'outcome-death';

        let html = `<div class="archived-exp-header">`;
        html += `<span class="archived-exp-merc">🧑 ${mercName}</span>`;
        html += `<span class="outcome-tag ${outcomeClass}">${outcome}</span>`;
        html += `</div>`;
        html += `<div class="archived-exp-info">`;
        html += `Faction: <b>${factionDisplay}</b>`;
        html += `<br>`;
        if ((exp.locationName && exp.zoneName) && (exp.locationName.length + exp.zoneName.length) > 30) {
            html += `📍 ${exp.locationName || '--'} /`;
            html += `<br>`;
            html +=  `${exp.zoneName || '--'}`;
        } else {
            html += `📍 ${exp.locationName || '--'} / ${exp.zoneName || '--'}`;
        }
        if (exp.objectiveName) html += ` — ${exp.objectiveName}`;
        html += `<br>`;
        if (exp.totalCost !== undefined) html += `💰 Cost: ${exp.totalCost.toLocaleString()} · `;
        if (exp.riskScore !== undefined) html += `⚠️ Risk: ${exp.riskScore}`;
        html += `</div>`;

        const rawContainer = exp.containerData || exp.container;
        const containerItems = Array.isArray(rawContainer) ? rawContainer
            : (rawContainer && Array.isArray(rawContainer.items) ? rawContainer.items : null);
        if (containerItems && containerItems.length > 0) {
            const uid = 'archived_' + exp.id;
            html += `<div class="container-items">`;
            html += `<div class="expandable-header" data-expand="${uid}"><span class="expand-arrow">▶</span><span class="expand-label">Loot (${containerItems.length} items)</span></div>`;
            html += `<div class="expandable-body" id="${uid}">`;
            for (const ci of containerItems) {
                const det = ci.item || ci;
                const imgSrc = det.imageUrl || det.image || '';
                const imgTag = imgSrc ? `<img src="${imgSrc}" style="width:24px;height:24px;border-radius:4px;vertical-align:middle;margin-right:4px;" loading="lazy">` : '';
                const tierTag = det.tier ? ` <span class="tier-tag tier-tag-${det.tier.toLowerCase()}">${det.tier}</span>` : '';
                let statusTag = '';
                if (det.isCollected) statusTag = ' <span style="color:var(--accent-green);font-size:9px;">✓ Collected</span>';
                else if (det.isDeleted) statusTag = ' <span style="color:var(--accent-red);font-size:9px;">✗ Deleted</span>';
                html += `<div style="font-size:10px;margin:2px 0;">${imgTag}${det.name || det.id || '?'}${tierTag}${statusTag}</div>`;
            }
            html += `</div></div>`;
        }
        if (exp.completedAt) {
            const agoMs = Date.now() - new Date(exp.completedAt).getTime();
            let agoText = '';
            if (agoMs < 60000) agoText = 'just now';
            else if (agoMs < 3600000) agoText = Math.floor(agoMs / 60000) + 'm ago';
            else if (agoMs < 86400000) { const h = Math.floor(agoMs / 3600000); const m = Math.floor((agoMs % 3600000) / 60000); agoText = h + 'h' + (m > 0 ? ' ' + m + 'm' : '') + ' ago'; }
            else { const d = Math.floor(agoMs / 86400000); const h = Math.floor((agoMs % 86400000) / 3600000); agoText = d + 'd' + (h > 0 ? ' ' + h + 'h' : '') + ' ago'; }
            html += `<span style="font-size:9px;color:var(--text-dim);display:flex;flex-direction:row-reverse;">🕐 Completed ${agoText}</span>`;
        }

        _safeSetHtml(card, html);
        archivedExpContainer.appendChild(card);
    }
    archivedExpContainer.querySelectorAll('.expandable-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.classList.toggle('open');
            const targetId = hdr.getAttribute('data-expand');
            const body = document.getElementById(targetId);
            if (body) body.classList.toggle('openExtended');
        });
    });
}

export async function refreshArchivedOnly() {
    archivedExpContainer.replaceChildren(_noData('Loading archived expeditions...'));
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestArchivedExpeditions" });
    } catch (e) {}
    await waitForStorageKey('archivedExpeditionsData', 5000);
    await loadArchivedExpeditions();
    refreshAllTimestamps();
}

loadArchivedExpeditions();
