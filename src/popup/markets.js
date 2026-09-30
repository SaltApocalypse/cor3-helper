// --- Markets ---
import { _h, _noData, _clearEl, _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab, formatTimeRemaining, waitForStorageKey } from './utils.js';
import { refreshAllTimestamps } from './timestamps.js';
import { TIMER_LABELS, alarmTimerSelect, renderAlarmList } from './alarms.js';
import { renderPinnedTimers } from './pinned-timers.js';
import { state, zoomList } from './state.js';
import { findMaintenanceBlocker } from '../shared/server-map.js';

const marketContainer = document.getElementById('marketContainer');
const darkMarketContainer = document.getElementById('darkMarketContainer');
const soyuzMarketContainer = document.getElementById('soyuzMarketContainer');
const usolMarketContainer = document.getElementById('usolMarketContainer');
const refreshMarketBtn = document.getElementById('refreshMarketBtn');
const refreshDarkMarketBtn = document.getElementById('refreshDarkMarketBtn');
const refreshSoyuzMarketBtn = document.getElementById('refreshSoyuzMarketBtn');
const refreshUsolMarketBtn = document.getElementById('refreshUsolMarketBtn');
const coreMarketLabel = document.getElementById('coreMarketLabel');
const darkMarketLabel = document.getElementById('darkMarketLabel');
const soyuzMarketLabel = document.getElementById('soyuzMarketLabel');
const usolMarketLabel = document.getElementById('usolMarketLabel');

function updateMarketLabel(labelEl, wsName, placeholder, icon) {
    const img = labelEl.querySelector('img.faction-icon');
    const text = wsName || placeholder;
    if (img) {
        labelEl.childNodes.forEach(n => { if (n.nodeType === 3) n.remove(); });
        labelEl.appendChild(document.createTextNode(' ' + text));
    } else {
        if (icon == '☭') {
            labelEl.replaceChildren(_h('span', {style: 'color:#c33b3b;margin-left:3px;margin-right:1px'}, '☭'), ' ' + text);
        } else if (icon == '☮') {
            labelEl.replaceChildren(_h('span', {style: 'color:#2592A7;margin-right:1px'}, '☮'), ' ' + text);
        } else {
            labelEl.textContent = `${icon} ${text}`;
        }
    }
}

function showMarketInfoPopup(lot) {
    const popup = document.getElementById('marketInfoPopup');
    const overlay = document.getElementById('marketInfoOverlay');
    if (!popup || !overlay) return;
    const det = lot.details || {};
    const isAccess = (lot.category || '').toUpperCase() === 'ACCESS';
    const INFO_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="color:currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 17V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="8" r="0.75" fill="currentColor"/></svg>';

    let itemName;
    if (isAccess) {
        itemName = (det.serverName || '') + ' ' + (det.accessType || '') + ' access';
    } else {
        itemName = det.name || 'Unknown';
    }

    let h = '<div class="info-title">' + INFO_SVG + ' ' + itemName.toUpperCase() + '</div>';
    h += '<div class="info-desc">';
    const matchedSbstr = itemName ? Object.keys(zoomList).find(substring => itemName.includes(substring)) : "";
    let zoomMarketImg = '';
    if (matchedSbstr) {
        zoomMarketImg = `style="transform:scale(${zoomList[matchedSbstr]});object-fit:contain;"`;
    }
    if (det.image) h += `<div style="overflow:clip;"><img ${zoomMarketImg} src="${det.image}" alt=""></div>`;
    h += '<span>' + (det.description || 'No description available.') + '</span>';
    h += '</div>';
    h += '<div class="info-specs">';
    h += '<div class="info-spec-item"><div class="info-spec-label">Price</div><div class="info-spec-val">' + (lot.price ? lot.price.toLocaleString() : '--') + '</div></div>';
    if (lot.priceModifier) h += '<div class="info-spec-item"><div class="info-spec-label">Price Modifier</div><div class="info-spec-val">' + (lot.priceModifier > 0 ? '+' : '') + lot.priceModifier + '</div></div>';

    if (isAccess) {
        if (lot.accessLevel) h += '<div class="info-spec-item"><div class="info-spec-label">Access Level</div><div class="info-spec-val">' + lot.accessLevel + '</div></div>';
        if (det.durationHours !== undefined) h += '<div class="info-spec-item"><div class="info-spec-label">Duration</div><div class="info-spec-val">' + det.durationHours + 'h</div></div>';
        if (det.accessType) h += '<div class="info-spec-item"><div class="info-spec-label">Access Type</div><div class="info-spec-val">' + det.accessType + '</div></div>';
        if (det.serverName) h += '<div class="info-spec-item"><div class="info-spec-label">Server</div><div class="info-spec-val">' + det.serverName + '</div></div>';
        h += '<div class="info-spec-item"><div class="info-spec-label">Available</div><div class="info-spec-val">' + (lot.availableCount !== undefined ? lot.availableCount : '--') + '</div></div>';
        if (lot.lockedByQuest) h += '<div class="info-spec-item"><div class="info-spec-label">Locked By Quest</div><div class="info-spec-val">' + lot.lockedByQuest + '</div></div>';
        if (lot.unavailableReason) h += '<div class="info-spec-item"><div class="info-spec-label">Status</div><div class="info-spec-val">' + lot.unavailableReason + '</div></div>';
    } else {
        if (det.manufacturer) h += '<div class="info-spec-item"><div class="info-spec-label">Manufacturer</div><div class="info-spec-val">' + det.manufacturer + '</div></div>';
        if (det.tier) h += '<div class="info-spec-item"><div class="info-spec-label">Tier</div><div class="info-spec-val">' + det.tier + '</div></div>';
        if (det.itemVulnerability !== undefined) h += '<div class="info-spec-item"><div class="info-spec-label">Vulnerability</div><div class="info-spec-val">' + det.itemVulnerability + ' %</div></div>';
        if (lot.accessLevel) h += '<div class="info-spec-item"><div class="info-spec-label">Access Level</div><div class="info-spec-val">' + lot.accessLevel + '</div></div>';
        if (det.specs && typeof det.specs === 'object') {
            if (Array.isArray(det.specs)) {
                for (const spec of det.specs) {
                    if (spec && typeof spec === 'object') {
                        if (spec.type) h += '<div class="info-spec-item"><div class="info-spec-label">Type</div><div class="info-spec-val">' + spec.type + '</div></div>';
                        if (spec.power && Array.isArray(spec.power)) h += '<div class="info-spec-item"><div class="info-spec-label">Power</div><div class="info-spec-val">' + spec.power[0] + ' – ' + spec.power[1] + '</div></div>';
                        if (spec.fileTypes && Array.isArray(spec.fileTypes)) h += '<div class="info-spec-item"><div class="info-spec-label">File Types</div><div class="info-spec-val">' + spec.fileTypes.join(', ') + '</div></div>';
                        if (spec.serverTypes && Array.isArray(spec.serverTypes)) h += '<div class="info-spec-item"><div class="info-spec-label">Server Types</div><div class="info-spec-val">' + spec.serverTypes.join(', ') + '</div></div>';
                        if (spec.remote !== undefined) h += '<div class="info-spec-item"><div class="info-spec-label">Remote</div><div class="info-spec-val">' + (spec.remote ? 'Yes' : 'No') + '</div></div>';
                    }
                }
            } else {
                for (const [specKey, specVal] of Object.entries(det.specs)) {
                    const label = specKey.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                    let displayVal;
                    if (Array.isArray(specVal)) { displayVal = specVal.join(', '); }
                    else if (specVal !== null && typeof specVal === 'object') { displayVal = JSON.stringify(specVal); }
                    else { displayVal = specVal; }
                    h += '<div class="info-spec-item"><div class="info-spec-label">' + label + '</div><div class="info-spec-val">' + displayVal + '</div></div>';
                }
            }
        }
    }
    h += '</div>';
    _safeSetHtml(popup, h);
    popup.classList.add('open');
    overlay.classList.add('open');
    const close = () => { popup.classList.remove('open'); overlay.classList.remove('open'); overlay.removeEventListener('click', close); };
    overlay.addEventListener('click', close);
}

function renderMarketInto(container, data, labelPrefix, idPrefix) {
    var openSections = {};
    container.querySelectorAll('.expandable-header.open').forEach(hdr => {
        var key = hdr.getAttribute('data-expand') || hdr.id;
        if (key) openSections[key] = true;
    });

    _clearEl(container);

    if (!data || !data.market) {
        container.replaceChildren(_noData('No market data available.', 'Make sure you have the cor3.gg tab open.'));
        return;
    }

    const md = data;
    const market = md.market;
    const rep = md.reputation;

    let html = '';

    if (idPrefix == 'home') {
        html += '<img src="factions/core_faction-96x96.png" class="faction-icon" alt="">';
    } else if (idPrefix == 'dark') {
        html += '<img src="factions/bmi_faction-96x96.png" class="faction-icon" alt="">';
    } else if (idPrefix == 'soyuz') {
        html += '<img src="factions/soyuz_faction-96x96.png" class="faction-icon" alt="">';
    } else if (idPrefix == 'usol') {
        html += '<img src="factions/usol_faction-96x96.png" class="faction-icon" alt="">';
    }

    if (md.userCredits !== undefined) {
        html += `<div style="font-size:11px;color:var(--accent-green);margin-bottom:4px;">💰 Credits: ${md.userCredits.toLocaleString()}</div>`;
    }

    if (rep) {
        const pct = rep.requiredReputation > 0 ? Math.min(100, Math.floor((rep.progress / rep.requiredReputation) * 100)) : 0;
        html += `<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px;">Reputation — Level ${rep.level}</div>`;
        html += `<div class="market-rep-bar"><div class="market-rep-fill" style="width:${pct}%"></div></div>`;
        html += `<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">`;
        html += `Progress: ${rep.progress}/${rep.requiredReputation} · `;
        html += `Level Locked: ${rep.isLevelLocked ? 'Yes' : 'No'} · `;
        html += `Max Level: ${rep.isMaxLevel ? 'Yes' : 'No'}`;
        html += `</div>`;
    }

    const jobCount = md.jobs ? md.jobs.length : 0;
    const availableJobs = md.jobs ? md.jobs.filter(j => !j.isCompleted && !j.isExpired).length : 0;

    if (md.nextJobsResetAt) {
        html += `<div class="${idPrefix}-reset-timer" style="font-size:11px;color:var(--accent-orange);margin-bottom:8px;">⏳ Jobs Reset: ${formatTimeRemaining(md.nextJobsResetAt)}</div>`;
    } else if (jobCount > 0) {
        html += `<div style="font-size:11px;color:var(--accent-orange);margin-bottom:8px;">Jobs: ${availableJobs}/${jobCount}</div>`;
    }

    html += `<div class="expandable-header" id="${idPrefix}ItemsToggle"><span class="expand-arrow">▶</span><span class="expand-label">Items List (${(md.lots || []).length})</span></div>`;
    html += `<div class="expandable-body" id="${idPrefix}ItemsBody">`;

    if (md.lots && md.lots.length > 0) {
        const groups = {};
        for (const lot of md.lots) {
            const cat = lot.category || 'OTHER';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(lot);
        }

        const INFO_BTN_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><g clip-path="url(#mi2)"><path d="M3.759 1.2H12.243c.703 0 1.3.246 1.81.75.502.503.748 1.095.748 1.797v8.495c0 .71-.246 1.305-.748 1.807-.51.505-1.107.751-1.81.751H3.76c-.71 0-1.306-.246-1.809-.749-.502-.502-.749-1.097-.749-1.808V3.747c0-.703.246-1.295.75-1.798.502-.503 1.098-.75 1.808-.75z" stroke="currentColor" stroke-width="0.8"/><path d="M6.994 3.837h2.002v1.992H6.994V3.837zM6.994 7.124h2.002v5.049H6.994V7.124z" fill="currentColor"/></g><defs><clipPath id="mi2"><rect width="16" height="16" fill="currentColor"/></clipPath></defs></svg>';
        var lotMap = [];
        for (const [cat, items] of Object.entries(groups)) {
            html += `<div class="market-category-title">${cat.charAt(0) + cat.slice(1).toLowerCase()}</div>`;
            for (const lot of items) {
                const det = lot.details || {};
                const isAccess = cat === 'ACCESS';
                const isBought = lot.availableCount === 0;
                const boughtTag = isBought && !isAccess ? '<span class="market-item-bought">BOUGHT</span>' : '';
                const matchedSubstring = det.name ? Object.keys(zoomList).find(substring => det.name.includes(substring)) : "";
                let zoomLotImg = '';
                if (matchedSubstring) {
                    zoomLotImg = `style="transform:scale(${zoomList[matchedSubstring]});object-fit:contain;"`;
                }
                const imgHtml = det.image ? `<div style="overflow:hidden;border-radius:6px;width:40px;height:40px;margin-top:6px;"><img src="${det.image}" alt="${det.name || ''}" loading="lazy" ${zoomLotImg}></div>` : '';

                let itemName;
                if (isAccess) {
                    itemName = (det.serverName || '') + ' ' + (det.accessType || '') + ' access';
                } else {
                    itemName = det.name || 'Unknown';
                }

                const unavailTag = lot.unavailableReason ? `<span class="market-item-bought" style="background:rgba(255,160,0,0.2);color:var(--accent-orange);">${lot.unavailableReason.toUpperCase()}</span>` : '';

                const lotIdx = lotMap.length;
                lotMap.push(lot);

                html += `<div class="market-item-card">`;
                html += imgHtml;
                html += `<div class="market-item-info">`;
                html += `<div class="market-item-header">`;
                html += `<div class="market-item-name">${itemName}${boughtTag}${unavailTag}</div>`;
                html += `<button class="market-item-info-btn" data-lot-idx="${lotIdx}">${INFO_BTN_SVG} INFO</button>`;
                html += `</div>`;
                html += `<div class="market-item-price">💰 ${lot.price ? lot.price.toLocaleString() : '--'}</div>`;

                const uid = idPrefix + '_mitem_' + lot.id;
                html += `<div class="expandable-header" data-expand="${uid}"><span class="expand-arrow">▶</span><span class="expand-label">Details</span></div>`;
                html += `<div class="expandable-body" id="${uid}">`;

                if (isAccess) {
                    if (lot.accessLevel) html += `<div class="detail-row"><span class="label">Access Level:</span> ${lot.accessLevel}</div>`;
                    if (det.durationHours !== undefined) html += `<div class="detail-row"><span class="label">Duration:</span> ${det.durationHours}h</div>`;
                    if (det.accessType) html += `<div class="detail-row"><span class="label">Access Type:</span> ${det.accessType}</div>`;
                    if (det.serverName) html += `<div class="detail-row"><span class="label">Server:</span> ${det.serverName}</div>`;
                    html += `<div class="detail-row"><span class="label">Available:</span> ${lot.availableCount !== undefined ? lot.availableCount : '--'}</div>`;
                    if (lot.lockedByQuest) html += `<div class="detail-row"><span class="label">Locked By Quest:</span> ${lot.lockedByQuest}</div>`;
                    if (lot.unavailableReason) html += `<div class="detail-row"><span class="label">Status:</span> ${lot.unavailableReason}</div>`;
                } else {
                    if (det.manufacturer) html += `<div class="detail-row"><span class="label">Manufacturer:</span> ${det.manufacturer}</div>`;
                    if (det.tier) html += `<div class="detail-row"><span class="label">Tier:</span> ${det.tier}</div>`;
                    if (det.itemVulnerability !== undefined) html += `<div class="detail-row"><span class="label">Vulnerability:</span> ${det.itemVulnerability}%</div>`;
                    if (det.price) html += `<div class="detail-row"><span class="label">Base Price:</span> 💰 ${det.price.toLocaleString()}</div>`;
                    if (lot.priceModifier) html += `<div class="detail-row"><span class="label">Price Modifier:</span> ${lot.priceModifier > 0 ? '+' : ''}${lot.priceModifier}</div>`;
                    if (lot.accessLevel) html += `<div class="detail-row"><span class="label">Access Level:</span> ${lot.accessLevel}</div>`;
                    if (det.specs && typeof det.specs === 'object') {
                        if (Array.isArray(det.specs)) {
                            for (const spec of det.specs) {
                                if (spec && typeof spec === 'object') {
                                    if (spec.type) html += `<div class="detail-row"><span class="label">Type:</span> ${spec.type}</div>`;
                                    if (spec.power && Array.isArray(spec.power)) html += `<div class="detail-row"><span class="label">Power:</span> ${spec.power[0]} – ${spec.power[1]}</div>`;
                                    if (spec.fileTypes && Array.isArray(spec.fileTypes)) html += `<div class="detail-row"><span class="label">File Types:</span> ${spec.fileTypes.join(', ')}</div>`;
                                    if (spec.serverTypes && Array.isArray(spec.serverTypes)) html += `<div class="detail-row"><span class="label">Server Types:</span> ${spec.serverTypes.join(', ')}</div>`;
                                    if (spec.remote !== undefined) html += `<div class="detail-row"><span class="label">Remote:</span> ${spec.remote ? 'Yes' : 'No'}</div>`;
                                }
                            }
                        } else {
                            for (const [specKey, specVal] of Object.entries(det.specs)) {
                                const label = specKey.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
                                let displayVal;
                                if (Array.isArray(specVal)) {
                                    displayVal = specVal.join(', ');
                                } else if (specVal !== null && typeof specVal === 'object') {
                                    displayVal = JSON.stringify(specVal);
                                } else {
                                    displayVal = specVal;
                                }
                                html += `<div class="detail-row"><span class="label">${label}:</span> ${displayVal}</div>`;
                            }
                        }
                    }
                    if (det.description) html += `<div class="detail-row" style="color:var(--text-dim);font-style:italic;margin-top:2px;">${det.description}</div>`;
                }
                html += `</div>`;

                html += `</div></div>`;
            }
        }
    } else {
        html += '<div class="no-decisions">No items in market.</div>';
    }
    html += `</div>`;

    const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired).map(j => ({ ...j, _status: 'OPEN' }));
    const recentActive = (md.recentJobs || []).filter(j => j.status === 'TAKEN' || j.status === 'FAILED').map(j => ({ ...j, _status: j.status === 'FAILED' ? 'FAILED' : 'IN PROGRESS' }));
    const completedJobs = (md.jobs || []).filter(j => j.isCompleted || j.isExpired).map(j => ({ ...j, _status: j.isCompleted ? 'COMPLETED' : 'EXPIRED' }));
    const allJobsList = [...openJobs, ...recentActive, ...completedJobs];
    const activeJobCount = openJobs.length + recentActive.length;
    html += `<div class="expandable-header" id="${idPrefix}JobsToggle"><span class="expand-arrow">▶</span><span class="expand-label">Jobs List (${activeJobCount}/${allJobsList.length})</span></div>`;
    html += `<div class="expandable-body" id="${idPrefix}JobsBody">`;
    if (allJobsList.length > 0) {
        allJobsList.sort((a, b) => {
            const sA = (a.relatedServers && a.relatedServers[0] ? a.relatedServers[0].serverName : '') || '';
            const sB = (b.relatedServers && b.relatedServers[0] ? b.relatedServers[0].serverName : '') || '';
            return sA.localeCompare(sB);
        });
        html += `<table style="width:100%;font-size:10px;border-collapse:collapse;margin-bottom:4px;">`;
        html += `<tr style="color:var(--text-dim);border-bottom:1px solid var(--border);"><th style="text-align:left;padding:3px 4px;">Job</th><th style="text-align:left;padding:3px 4px;">Server</th><th style="text-align:center;padding:3px 4px;">Status</th><th style="text-align:right;padding:3px 4px;">Reward/Penalty</th></tr>`;
        for (const job of allJobsList) {
            const dimStyle = (job._status === 'COMPLETED' || job._status === 'EXPIRED') ? 'opacity:0.5;' : '';
            const jobName = job.name || job.id || 'Unknown';
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'N/A';
            let rewardStr = '--';
            let rewardColor = 'var(--accent-green)';
            const isFailed = job._status === 'FAILED' || job._status === 'EXPIRED';
            if (isFailed) {
                if (job.reputationPenalty > 0) {
                    rewardStr = `<span style="color:var(--accent-red,#f38ba8);">⭐ -${job.reputationPenalty.toLocaleString()}</span>`;
                    rewardColor = 'var(--accent-red, #f38ba8)';
                } else if (job.deposit > 0) {
                    rewardStr = `<span style="color:var(--accent-red,#f38ba8);">💰 -${job.deposit.toLocaleString()}</span>`;
                    rewardColor = 'var(--accent-red, #f38ba8)';
                }
            } else {
                if (job.rewardCredits) {
                    rewardStr = `💰 ${job.rewardCredits.toLocaleString()}`;
                    if (job.deposit) rewardStr += ` <span style="color:var(--accent-red,#f38ba8);">(-${job.deposit.toLocaleString()})</span>`;
                }
                if (job.rewardReputation) {
                    rewardStr += ` · ⭐ ${job.rewardReputation}`;
                }
            }
            let statusColor, statusIcon;
            switch (job._status) {
                case 'OPEN': statusColor = 'var(--accent-blue, #89b4fa)'; statusIcon = '🔹'; break;
                case 'IN PROGRESS': statusColor = 'var(--accent-orange, #fab387)'; statusIcon = '🔄'; break;
                case 'FAILED': statusColor = 'var(--accent-red, #f38ba8)'; statusIcon = '❌'; break;
                case 'COMPLETED': statusColor = 'var(--accent-green, #a6e3a1)'; statusIcon = '✅'; break;
                case 'EXPIRED': statusColor = 'var(--text-dim, #6c7086)'; statusIcon = '⏰'; break;
                default: statusColor = 'var(--text-dim)'; statusIcon = '—'; break;
            }
            html += `<tr style="${dimStyle}border-bottom:1px solid var(--border);">`;
            html += `<td style="padding:3px 4px;color:var(--text-secondary);">${jobName}</td>`;
            html += `<td style="padding:3px 4px;color:var(--text-muted);">${serverName}</td>`;
            html += `<td style="padding:3px 4px;text-align:center;color:${statusColor};font-size:9px;">${statusIcon} ${job._status}</td>`;
            html += `<td style="padding:3px 4px;text-align:right;color:${rewardColor};">${rewardStr}</td>`;
            html += `</tr>`;
        }
        html += `</table>`;
    } else {
        html += '<div class="no-decisions">No jobs available.</div>';
    }
    html += `</div>`;

    _safeSetHtml(container, html);

    container.querySelectorAll('.expandable-header').forEach(hdr => {
        var key = hdr.getAttribute('data-expand') || hdr.id;
        if (key && openSections[key]) {
            hdr.classList.add('open');
            var bodyId = hdr.getAttribute('data-expand') || hdr.id.replace('Toggle', 'Body');
            var body = document.getElementById(bodyId);
            if (body) body.classList.add('open');
        }
        hdr.addEventListener('click', () => {
            hdr.classList.toggle('open');
            const targetId = hdr.getAttribute('data-expand') || hdr.id.replace('Toggle', 'Body');
            const body = document.getElementById(targetId);
            if (body) body.classList.toggle('open');
        });
    });

    if (lotMap && lotMap.length > 0) {
        container.querySelectorAll('.market-item-info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.lotIdx, 10);
                if (!isNaN(idx) && lotMap[idx]) showMarketInfoPopup(lotMap[idx]);
            });
        });
    }

    const cleanupBtnMap = { home: 'cleanupCoreMarketBtn', dark: 'cleanupDarkMarketBtn', soyuz: 'cleanupSoyuzMarketBtn', usol: 'cleanupUsolMarketBtn' };
    const cleanupBtn = document.getElementById(cleanupBtnMap[idPrefix]);
    if (cleanupBtn) {
        const failedJobs = (md.recentJobs || []).filter(j => j.status === 'FAILED');
        cleanupBtn.style.display = failedJobs.length > 0 ? '' : 'none';
    }
}

export function renderMarket(data) {
    if (data && data.nextJobsResetAt) state.coreNextJobsResetAt = data.nextJobsResetAt;
    if (data && data.market && data.market.marketName) {
        state.coreMarketName = data.market.marketName;
        updateMarketLabel(coreMarketLabel, state.coreMarketName, 'Market-1', '🏠');
        TIMER_LABELS.home_jobs = state.coreMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.home_jobs;
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(marketContainer, data, 'Market-1', 'home');
}

export function renderDarkMarket(data, available, maintenanceEndsAt, blockerServer) {
    if (available === false) {
        let timerHtml = '';
        if (blockerServer) timerHtml += ' (' + blockerServer + ' in maintenance';
        if (maintenanceEndsAt) {
            const diff = new Date(maintenanceEndsAt).getTime() - Date.now();
            if (diff > 0) {
                const mins = Math.ceil(diff / 60000);
                timerHtml += (blockerServer ? ', ' : ' (') + '~' + mins + 'm remaining';
            }
        }
        if (timerHtml) timerHtml += ')';
        const warningEl = _h('div', {className: 'warning-banner'}, '⚠️ D4RK market server is currently unreachable' + timerHtml + '.');
        if (data && data.market) {
            if (data.nextJobsResetAt) state.bmiNextJobsResetAt = data.nextJobsResetAt;
            if (data.market.marketName) {
                state.darkMarketName = data.market.marketName;
                updateMarketLabel(darkMarketLabel, state.darkMarketName, 'Market-2', '🌑');
            }
            renderMarketInto(darkMarketContainer, data, 'Market-2 (cached)', 'dark');
            darkMarketContainer.prepend(warningEl);
        } else {
            darkMarketContainer.replaceChildren(warningEl, _noData('No cached market data available.'));
        }
        return;
    }
    if (data && data.nextJobsResetAt) state.bmiNextJobsResetAt = data.nextJobsResetAt;
    if (data && data.market && data.market.marketName) {
        state.darkMarketName = data.market.marketName;
        updateMarketLabel(darkMarketLabel, state.darkMarketName, 'Market-2', '🌑');
        TIMER_LABELS.dark_jobs = state.darkMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="dark_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.dark_jobs;
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(darkMarketContainer, data, 'Market-2', 'dark');
}

export function renderSoyuzMarket(data, available, maintenanceEndsAt, blockerServer) {
    if (available === false) {
        let timerHtml = '';
        if (blockerServer) timerHtml += ' (' + blockerServer + ' in maintenance';
        if (maintenanceEndsAt) {
            const diff = new Date(maintenanceEndsAt).getTime() - Date.now();
            if (diff > 0) {
                const mins = Math.ceil(diff / 60000);
                timerHtml += (blockerServer ? ', ' : ' (') + '~' + mins + 'm remaining';
            }
        }
        if (timerHtml) timerHtml += ')';
        const warningEl = _h('div', {className: 'warning-banner'}, '⚠️ SOYUZ market server is currently unreachable' + timerHtml + '.');
        if (data && data.market) {
            if (data.nextJobsResetAt) state.soyuzNextJobsResetAt = data.nextJobsResetAt;
            if (data.market.marketName) {
                state.soyuzMarketName = data.market.marketName;
                updateMarketLabel(soyuzMarketLabel, state.soyuzMarketName, 'Market-3', '☭');
            }
            renderMarketInto(soyuzMarketContainer, data, 'Market-3 (cached)', 'soyuz');
            soyuzMarketContainer.prepend(warningEl);
        } else {
            soyuzMarketContainer.replaceChildren(warningEl, _noData('No cached market data available.'));
        }
        return;
    }
    if (data && data.nextJobsResetAt) state.soyuzNextJobsResetAt = data.nextJobsResetAt;
    if (data && data.market && data.market.marketName) {
        state.soyuzMarketName = data.market.marketName;
        updateMarketLabel(soyuzMarketLabel, state.soyuzMarketName, 'Market-3', '☭');
        TIMER_LABELS.soyuz_jobs = state.soyuzMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="soyuz_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.soyuz_jobs;
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(soyuzMarketContainer, data, 'Market-3', 'soyuz');
}

export function renderUsolMarket(data, available, maintenanceEndsAt, blockerServer) {
    if (available === false) {
        let timerHtml = '';
        if (blockerServer) timerHtml += ' (' + blockerServer + ' in maintenance';
        if (maintenanceEndsAt) {
            const diff = new Date(maintenanceEndsAt).getTime() - Date.now();
            if (diff > 0) {
                const mins = Math.ceil(diff / 60000);
                timerHtml += (blockerServer ? ', ' : ' (') + '~' + mins + 'm remaining';
            }
        }
        if (timerHtml) timerHtml += ')';
        const warningEl = _h('div', {className: 'warning-banner'}, '⚠️ USOL market server is currently unreachable' + timerHtml);
        if (data && data.market) {
            if (data.nextJobsResetAt) state.usolNextJobsResetAt = data.nextJobsResetAt;
            if (data.market.marketName) {
                state.usolMarketName = data.market.marketName;
                updateMarketLabel(usolMarketLabel, state.usolMarketName, 'Market-4', '☮');
            }
            renderMarketInto(usolMarketContainer, data, 'Market-4 (cached)', 'usol');
            usolMarketContainer.prepend(warningEl);
        } else {
            usolMarketContainer.replaceChildren(warningEl, _noData('No cached market data available.'));
        }
        return;
    }
    if (data && data.nextJobsResetAt) state.usolNextJobsResetAt = data.nextJobsResetAt;
    if (data && data.market && data.market.marketName) {
        state.usolMarketName = data.market.marketName;
        updateMarketLabel(usolMarketLabel, state.usolMarketName, 'Market-4', '☮');
        TIMER_LABELS.usol_jobs = state.usolMarketName + ' Jobs Reset';
        const opt = alarmTimerSelect.querySelector('option[value="usol_jobs"]');
        if (opt) opt.textContent = TIMER_LABELS.usol_jobs;
        renderPinnedTimers();
        renderAlarmList();
    }
    renderMarketInto(usolMarketContainer, data, 'Market-4', 'usol');
}

export async function loadMarket() {
    const { marketData } = await chrome.storage.local.get('marketData');
    renderMarket(marketData);
}

export async function loadDarkMarket() {
    const { darkMarketData, darkMarketAvailable, darkMarketMaintenanceEndsAt, darkMarketBlockerServer } = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable', 'darkMarketMaintenanceEndsAt', 'darkMarketBlockerServer']);
    renderDarkMarket(darkMarketData, darkMarketAvailable, darkMarketMaintenanceEndsAt, darkMarketBlockerServer);
}

export async function loadSoyuzMarket() {
    const { soyuzMarketData, soyuzMarketAvailable, soyuzMarketMaintenanceEndsAt, soyuzMarketBlockerServer } = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable', 'soyuzMarketMaintenanceEndsAt', 'soyuzMarketBlockerServer']);
    renderSoyuzMarket(soyuzMarketData, soyuzMarketAvailable, soyuzMarketMaintenanceEndsAt, soyuzMarketBlockerServer);
}

export async function loadUsolMarket() {
    const { usolMarketData, usolMarketAvailable, usolMarketMaintenanceEndsAt, usolMarketBlockerServer } = await chrome.storage.local.get(['usolMarketData', 'usolMarketAvailable', 'usolMarketMaintenanceEndsAt', 'usolMarketBlockerServer']);
    renderUsolMarket(usolMarketData, usolMarketAvailable, usolMarketMaintenanceEndsAt, usolMarketBlockerServer);
}

export async function requestMarketData() {
    marketContainer.replaceChildren(_noData('Requesting market data...'));
    darkMarketContainer.replaceChildren(_noData('Requesting market data...'));
    soyuzMarketContainer.replaceChildren(_noData('Requesting market data...'));
    usolMarketContainer.replaceChildren(_noData('Requesting market data...'));
    await chrome.storage.local.remove(['marketData', 'darkMarketData', 'darkMarketAvailable', 'soyuzMarketData', 'soyuzMarketAvailable', 'usolMarketData', 'usolMarketAvailable']);

    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get('marketData');
            if (data.marketData && data.marketData.market) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadMarket();
    refreshAllTimestamps();

    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestDarkMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
            if ((data.darkMarketData && data.darkMarketData.market) || data.darkMarketAvailable === false) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadDarkMarket();
    refreshAllTimestamps();

    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestSoyuzMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable']);
            if ((data.soyuzMarketData && data.soyuzMarketData.market) || data.soyuzMarketAvailable === false) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 20000);
    });
    await loadSoyuzMarket();
    refreshAllTimestamps();

    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "requestUsolMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['usolMarketData', 'usolMarketAvailable']);
            if ((data.usolMarketData && data.usolMarketData.market) || data.usolMarketAvailable === false) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 500);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 20000);
    });
    await loadUsolMarket();
    refreshAllTimestamps();
}

export function getMarketContainers() {
    return { marketContainer, darkMarketContainer, soyuzMarketContainer, usolMarketContainer };
}

export function initMarketRefreshButtons() {
    refreshMarketBtn.addEventListener('click', async () => {
        marketContainer.replaceChildren(_noData('Refreshing market data...'));
        try {
            const tab = await getCor3Tab();
            if (!tab) throw new Error('No cor3.gg tab');
            await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
            setTimeout(() => { loadMarket(); refreshAllTimestamps(); }, 3000);
        } catch (e) {
            setTimeout(() => { loadMarket(); refreshAllTimestamps(); }, 500);
        }
    });

    refreshDarkMarketBtn.addEventListener('click', async () => {
        darkMarketContainer.replaceChildren(_noData('Refreshing market data...'));
        try {
            const tab = await getCor3Tab();
            if (!tab) throw new Error('No cor3.gg tab');
            await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
            setTimeout(() => { loadDarkMarket(); refreshAllTimestamps(); }, 3000);
        } catch (e) {
            setTimeout(() => { loadDarkMarket(); refreshAllTimestamps(); }, 500);
        }
    });

    refreshSoyuzMarketBtn.addEventListener('click', async () => {
        soyuzMarketContainer.replaceChildren(_noData('Refreshing market data...'));
        try {
            const tab = await getCor3Tab();
            if (!tab) throw new Error('No cor3.gg tab');
            await chrome.tabs.sendMessage(tab.id, { action: "refreshSoyuzMarket" });
            setTimeout(() => { loadSoyuzMarket(); refreshAllTimestamps(); }, 5000);
        } catch (e) {
            setTimeout(() => { loadSoyuzMarket(); refreshAllTimestamps(); }, 500);
        }
    });

    refreshUsolMarketBtn.addEventListener('click', async () => {
        usolMarketContainer.replaceChildren(_noData('Refreshing market data...'));
        try {
            const tab = await getCor3Tab();
            if (!tab) throw new Error('No cor3.gg tab');
            await chrome.tabs.sendMessage(tab.id, { action: "refreshUsolMarket" });
            setTimeout(() => { loadUsolMarket(); refreshAllTimestamps(); }, 5000);
        } catch (e) {
            setTimeout(() => { loadUsolMarket(); refreshAllTimestamps(); }, 500);
        }
    });
}

export async function refreshMarket1Only() {
    marketContainer.replaceChildren(_noData('Refreshing Market-1...'));
    await chrome.storage.local.remove('marketData');
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshMarket" });
    } catch (e) {}
    await waitForStorageKey('marketData', 8000);
    await loadMarket();
    refreshAllTimestamps();
}

export async function setDarkMarketEndpoint() {
    darkMarketContainer.replaceChildren(_noData('Setting Market-2 endpoint...'));
}

export async function refreshMarket2Only() {
    darkMarketContainer.replaceChildren(_noData('Refreshing Market-2...'));
    await chrome.storage.local.remove(['darkMarketData', 'darkMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshDarkMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable']);
            if (data.darkMarketData || data.darkMarketAvailable !== undefined) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 10000);
    });
    await loadDarkMarket();
    refreshAllTimestamps();
}

export async function refreshMarket3Only() {
    soyuzMarketContainer.replaceChildren(_noData('Refreshing Market-3...'));
    await chrome.storage.local.remove(['soyuzMarketData', 'soyuzMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshSoyuzMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['soyuzMarketData', 'soyuzMarketAvailable']);
            if (data.soyuzMarketData || data.soyuzMarketAvailable !== undefined) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadSoyuzMarket();
    refreshAllTimestamps();
}

export async function refreshMarket4Only() {
    usolMarketContainer.replaceChildren(_noData('Refreshing Market-4...'));
    await chrome.storage.local.remove(['usolMarketData', 'usolMarketAvailable']);
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: "refreshUsolMarket" });
    } catch (e) {}
    await new Promise((resolve) => {
        let done = false;
        const poll = setInterval(async () => {
            const data = await chrome.storage.local.get(['usolMarketData', 'usolMarketAvailable']);
            if (data.usolMarketData || data.usolMarketAvailable !== undefined) {
                clearInterval(poll); if (!done) { done = true; resolve(); }
            }
        }, 400);
        setTimeout(() => { clearInterval(poll); if (!done) { done = true; resolve(); } }, 15000);
    });
    await loadUsolMarket();
    refreshAllTimestamps();
}

export function initMarketStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.marketData) {
            const md = changes.marketData.newValue;
            if (md) {
                if (md.nextJobsResetAt) state.coreNextJobsResetAt = md.nextJobsResetAt;
                if (md.market && md.market.marketName) {
                    state.coreMarketName = md.market.marketName;
                    updateMarketLabel(coreMarketLabel, state.coreMarketName, 'Market-1', '🏠');
                    TIMER_LABELS.home_jobs = state.coreMarketName + ' Jobs Reset';
                    const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
                    if (opt) opt.textContent = TIMER_LABELS.home_jobs;
                }
                renderMarket(md);
                refreshAllTimestamps();
            }
        }
        if (changes.darkMarketData || changes.darkMarketAvailable) {
            loadDarkMarket();
            refreshAllTimestamps();
        }
        if (changes.soyuzMarketData || changes.soyuzMarketAvailable) {
            loadSoyuzMarket();
            refreshAllTimestamps();
        }
        if (changes.usolMarketData || changes.usolMarketAvailable) {
            loadUsolMarket();
            refreshAllTimestamps();
        }
        if (changes.serverMaintenanceMap) {
            chrome.storage.local.get(['darkMarketData', 'darkMarketAvailable', 'soyuzMarketData', 'soyuzMarketAvailable', 'usolMarketData', 'usolMarketAvailable'], (r) => {
                const map = changes.serverMaintenanceMap.newValue;
                if (!r.darkMarketData && r.darkMarketAvailable === undefined) {
                    const b = findMaintenanceBlocker(map, 'dark');
                    if (b) renderDarkMarket(null, false, b.maintenanceEndsAt, b.blockerName);
                }
                if (!r.soyuzMarketData && r.soyuzMarketAvailable === undefined) {
                    const b = findMaintenanceBlocker(map, 'soyuz');
                    if (b) renderSoyuzMarket(null, false, b.maintenanceEndsAt, b.blockerName);
                }
                if (!r.usolMarketData && r.usolMarketAvailable === undefined) {
                    const b = findMaintenanceBlocker(map, 'usol');
                    if (b) renderUsolMarket(null, false, b.maintenanceEndsAt, b.blockerName);
                }
            });
        }
    });
}

export function initMarketCacheLoad() {
    chrome.storage.local.get(['marketData', 'darkMarketData', 'darkMarketAvailable', 'darkMarketMaintenanceEndsAt', 'darkMarketBlockerServer', 'soyuzMarketData', 'soyuzMarketAvailable', 'soyuzMarketMaintenanceEndsAt', 'soyuzMarketBlockerServer', 'usolMarketData', 'usolMarketAvailable', 'usolMarketMaintenanceEndsAt', 'usolMarketBlockerServer', 'serverMaintenanceMap'], (result) => {
        if (result.marketData) {
            if (result.marketData.nextJobsResetAt) state.coreNextJobsResetAt = result.marketData.nextJobsResetAt;
            if (result.marketData.market && result.marketData.market.marketName) {
                state.coreMarketName = result.marketData.market.marketName;
                updateMarketLabel(coreMarketLabel, state.coreMarketName, 'Market-1', '🏠');
                TIMER_LABELS.home_jobs = state.coreMarketName + ' Jobs Reset';
                const opt = alarmTimerSelect.querySelector('option[value="home_jobs"]');
                if (opt) opt.textContent = TIMER_LABELS.home_jobs;
            }
            renderMarket(result.marketData);
        } else {
            marketContainer.replaceChildren(_noData('No market data cached. Click 🔄 to refresh.'));
        }
        if (result.darkMarketData || result.darkMarketAvailable === false) {
            if (result.darkMarketData) {
                if (result.darkMarketData.nextJobsResetAt) state.bmiNextJobsResetAt = result.darkMarketData.nextJobsResetAt;
                if (result.darkMarketData.market && result.darkMarketData.market.marketName) {
                    state.darkMarketName = result.darkMarketData.market.marketName;
                    updateMarketLabel(darkMarketLabel, state.darkMarketName, 'Market-2', '🌑');
                    TIMER_LABELS.dark_jobs = state.darkMarketName + ' Jobs Reset';
                    const opt = alarmTimerSelect.querySelector('option[value="dark_jobs"]');
                    if (opt) opt.textContent = TIMER_LABELS.dark_jobs;
                }
            }
            renderDarkMarket(result.darkMarketData || null, result.darkMarketAvailable, result.darkMarketMaintenanceEndsAt, result.darkMarketBlockerServer);
        } else {
            const darkBlocker = findMaintenanceBlocker(result.serverMaintenanceMap, 'dark');
            if (darkBlocker) {
                renderDarkMarket(null, false, darkBlocker.maintenanceEndsAt, darkBlocker.blockerName);
            } else {
                darkMarketContainer.replaceChildren(_noData('No market data cached. Click 🔄 to refresh.'));
            }
        }
        if (result.soyuzMarketData || result.soyuzMarketAvailable === false) {
            if (result.soyuzMarketData) {
                if (result.soyuzMarketData.nextJobsResetAt) state.soyuzNextJobsResetAt = result.soyuzMarketData.nextJobsResetAt;
                if (result.soyuzMarketData.market && result.soyuzMarketData.market.marketName) {
                    state.soyuzMarketName = result.soyuzMarketData.market.marketName;
                    updateMarketLabel(soyuzMarketLabel, state.soyuzMarketName, 'Market-3', '☭');
                    TIMER_LABELS.soyuz_jobs = state.soyuzMarketName + ' Jobs Reset';
                    const opt = alarmTimerSelect.querySelector('option[value="soyuz_jobs"]');
                    if (opt) opt.textContent = TIMER_LABELS.soyuz_jobs;
                }
            }
            renderSoyuzMarket(result.soyuzMarketData || null, result.soyuzMarketAvailable, result.soyuzMarketMaintenanceEndsAt, result.soyuzMarketBlockerServer);
        } else {
            const soyuzBlocker = findMaintenanceBlocker(result.serverMaintenanceMap, 'soyuz');
            if (soyuzBlocker) {
                renderSoyuzMarket(null, false, soyuzBlocker.maintenanceEndsAt, soyuzBlocker.blockerName);
            } else {
                soyuzMarketContainer.replaceChildren(_noData('No market data cached. Click 🔄 to refresh.'));
            }
        }
        if (result.usolMarketData || result.usolMarketAvailable === false) {
            if (result.usolMarketData) {
                if (result.usolMarketData.nextJobsResetAt) state.usolNextJobsResetAt = result.usolMarketData.nextJobsResetAt;
                if (result.usolMarketData.market && result.usolMarketData.market.marketName) {
                    state.usolMarketName = result.usolMarketData.market.marketName;
                    updateMarketLabel(usolMarketLabel, state.usolMarketName, 'Market-4', '☮');
                    TIMER_LABELS.usol_jobs = state.usolMarketName + ' Jobs Reset';
                    const opt = alarmTimerSelect.querySelector('option[value="usol_jobs"]');
                    if (opt) opt.textContent = TIMER_LABELS.usol_jobs;
                }
            }
            renderUsolMarket(result.usolMarketData || null, result.usolMarketAvailable, result.usolMarketMaintenanceEndsAt, result.usolMarketBlockerServer);
        } else {
            const usolBlocker = findMaintenanceBlocker(result.serverMaintenanceMap, 'usol');
            if (usolBlocker) {
                renderUsolMarket(null, false, usolBlocker.maintenanceEndsAt, usolBlocker.blockerName);
            } else {
                usolMarketContainer.replaceChildren(_noData('No market data cached. Click 🔄 to refresh.'));
            }
        }
    });
}

initMarketRefreshButtons();
initMarketCacheLoad();
initMarketStorageListener();
