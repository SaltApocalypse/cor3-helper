// Personal Drone Assembling — UI + control logic.
import { _h, _noData, _clearEl } from './dom-helpers.js';
import { getCor3Tab, formatTimeRemaining, showLastUpdated, waitForStorageKey } from './utils.js';
import { state } from './state.js';
import { savePinnedState, renderPinnedTimers } from './pinned-timers.js';
import { t, getUiLang, onLangChange, translateErrorText, translateStatus } from './i18n.js';

const refreshDroneBtn = document.getElementById('refreshDroneBtn');
const personalDroneContainer = document.getElementById('personalDroneContainer');
const personalDroneLastUpdated = document.getElementById('personalDroneLastUpdated');
const droneWarning = document.getElementById('droneWarning');
const droneLocationSelect = document.getElementById('droneLocationSelect');
const droneMissionSelect = document.getElementById('droneMissionSelect');
const droneMissionSelectRow = document.getElementById('droneMissionSelectRow');
const autoDroneToggle = document.getElementById('autoDroneToggle');
const autoDroneClaimToggle = document.getElementById('autoDroneClaimToggle');
const autoDroneDecideToggle = document.getElementById('autoDroneDecideToggle');
const autoChooseDroneLocationToggle = document.getElementById('autoChooseDroneLocationToggle');
const autoDroneFullChargeToggle = document.getElementById('autoDroneFullChargeToggle');
const autoDroneRepairToggle = document.getElementById('autoDroneRepairToggle');
const droneRepairThresholdInput = document.getElementById('droneRepairThresholdInput');
const autoDroneRepairOnLowBatteryToggle = document.getElementById('autoDroneRepairOnLowBatteryToggle');
const droneLowBatteryThresholdInput = document.getElementById('droneLowBatteryThresholdInput');
const autoDronePauseOnFailToggle = document.getElementById('autoDronePauseOnFailToggle');

const droneActiveContainer = document.getElementById('droneActiveContainer');
const droneActiveLastUpdated = document.getElementById('droneActiveLastUpdated');
const droneDecisionsToggle = document.getElementById('droneDecisionsToggle');
const droneDecisionsSectionBody = document.getElementById('droneDecisionsSectionBody');
const droneDecisionsContainer = document.getElementById('droneDecisionsContainer');
const droneDecisionsCount = document.getElementById('droneDecisionsCount');
const droneDecisionsLastUpdated = document.getElementById('droneDecisionsLastUpdated');
const droneArchivedToggle = document.getElementById('droneArchivedToggle');
const droneArchivedSectionBody = document.getElementById('droneArchivedSectionBody');
const droneArchivedContainer = document.getElementById('droneArchivedContainer');
const droneArchivedLastUpdated = document.getElementById('droneArchivedLastUpdated');
const refreshDroneActiveBtn = document.getElementById('refreshDroneActiveBtn');
const refreshDroneArchivedBtn = document.getElementById('refreshDroneArchivedBtn');
const droneExpActiveToggle = document.getElementById('droneExpActiveToggle');
const droneExpActiveBody = document.getElementById('droneExpActiveBody');

let _droneData = null;
let _droneMissionData = null;
let _droneArchivedLoaded = false;

// --- Settings -----------------------------------------------------------
function droneSettingsToStorage() {
    return {
        enabled: autoDroneToggle ? autoDroneToggle.checked : false,
        autoClaim: autoDroneClaimToggle ? autoDroneClaimToggle.checked : true,
        autoDecide: autoDroneDecideToggle ? autoDroneDecideToggle.checked : true,
        autoChooseLocation: autoChooseDroneLocationToggle ? autoChooseDroneLocationToggle.checked : false,
        fullChargeBeforeLaunch: autoDroneFullChargeToggle ? autoDroneFullChargeToggle.checked : false,
        locationConfigId: droneLocationSelect ? droneLocationSelect.value : '',
        missionConfigId: droneMissionSelect ? droneMissionSelect.value : '',
        repairEnabled: autoDroneRepairToggle ? autoDroneRepairToggle.checked : false,
        repairThreshold: droneRepairThresholdInput ? (parseInt(droneRepairThresholdInput.value, 10) || 60) : 60,
        repairOnLowBattery: autoDroneRepairOnLowBatteryToggle ? autoDroneRepairOnLowBatteryToggle.checked : false,
        lowBatteryThreshold: droneLowBatteryThresholdInput ? (parseInt(droneLowBatteryThresholdInput.value, 10) || 30) : 30,
        pauseOnRepairFail: autoDronePauseOnFailToggle ? autoDronePauseOnFailToggle.checked : true
    };
}

function saveDroneSettings() {
    chrome.storage.sync.get('autoDrone', (data) => {
        const existing = data.autoDrone || {};
        chrome.storage.sync.set({ autoDrone: Object.assign({}, existing, droneSettingsToStorage()) });
    });
}

function updateDroneMissionSelectRow() {
    if (autoChooseDroneLocationToggle && droneMissionSelectRow) {
        droneMissionSelectRow.style.display = autoChooseDroneLocationToggle.checked ? 'none' : 'flex';
    }
}

function updateDroneWarning(cfg) {
    if (!droneWarning) return;
    if (cfg && cfg.paused) {
        droneWarning.textContent = t('⚠️ Auto-drone is paused. Re-enable auto-dispatch to resume.', '⚠️ 自动无人机已暂停。请重新启用自动派遣以恢复。');
        droneWarning.style.display = '';
    } else {
        droneWarning.style.display = 'none';
    }
}

function populateDroneSelects() {
    if (!droneLocationSelect || !droneMissionSelect || !_droneData) return;
    const locations = (_droneData.locations || []);
    const prevLoc = droneLocationSelect.value;
    const prevMis = droneMissionSelect.value;
    droneLocationSelect.replaceChildren();
    for (const loc of locations) {
        droneLocationSelect.appendChild(_h('option', { value: loc.id }, loc.name));
    }
    if (locations.length === 0) { droneMissionSelect.replaceChildren(); return; }
    const selLoc = locations.find(l => l.id === prevLoc) || locations[0];
    droneLocationSelect.value = selLoc.id;
    droneMissionSelect.replaceChildren();
    for (const m of (selLoc.missions || [])) {
        droneMissionSelect.appendChild(_h('option', { value: m.id }, m.name));
    }
    if (selLoc.missions && selLoc.missions.some(m => m.id === prevMis)) droneMissionSelect.value = prevMis;
}

// --- Rendering ----------------------------------------------------------
function renderDrone() {
    if (!personalDroneContainer) return;
    if (!_droneData || !_droneData.drone) {
        personalDroneContainer.replaceChildren(_noData(t('No drone data yet. Click 🔄 to refresh.', '暂无无人机数据，点击 🔄 刷新。')));
        return;
    }
    const drone = _droneData.drone;
    const battery = _droneData.battery || {};
    const durPct = drone.maxDurability ? Math.max(0, Math.min(100, Math.round(drone.durability / drone.maxDurability * 100))) : 0;
    const battPct = battery.max ? Math.max(0, Math.min(100, Math.round(battery.current / battery.max * 100))) : 0;
    const durColor = durPct > 60 ? 'var(--accent-green)' : durPct > 30 ? 'var(--accent-orange)' : 'var(--accent-red,#ff4444)';
    const battColor = battPct > 40 ? 'var(--accent-green)' : battPct > 15 ? 'var(--accent-orange)' : 'var(--accent-red,#ff4444)';

    let statusText = t('Idle', '空闲'), statusColor = 'var(--accent-green)';
    if (drone.isDestroyed) { statusText = t('DESTROYED', '已摧毁'); statusColor = 'var(--accent-red,#ff4444)'; }
    else if (drone.isRepairing) { statusText = t('Repairing…', '维修中…'); statusColor = 'var(--accent-orange)'; }
    else if (_droneData.activeMissionId) { statusText = t('On mission', '执行任务中'); statusColor = 'var(--accent-blue)'; }

    const card = _h('div', { className: 'expedition-card' });
    const bar = (label, pct, color, right) => _h('div', { style: 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-muted);margin-top:4px;' },
        _h('span', { style: 'width:52px;' }, label),
        _h('div', { style: 'flex:1;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;' },
            _h('div', { style: `height:100%;width:${pct}%;background:${color};border-radius:4px;` })),
        _h('span', { style: 'width:52px;text-align:right;' }, right));

    card.appendChild(_h('div', { className: 'exp-header' },
        _h('span', { className: 'exp-title' }, `🛩️ ${drone.name || 'Drone'}`),
        _h('span', { className: 'exp-status', style: `color:${statusColor};` }, statusText)));
    const body = _h('div', { style: 'padding:4px 0;' });
    body.appendChild(bar(t('Durability', '耐久'), durPct, durColor, `${drone.durability}/${drone.maxDurability}`));
    body.appendChild(bar(t('Battery', '电量'), battPct, battColor, `${battPct}%`));
    if (drone.isRepairing && drone.repairSecondsRemaining != null) {
        body.appendChild(_h('div', { className: 'detail-row' }, _h('span', { className: 'label' }, t('Repair:', '维修：')), ` ${Math.ceil(drone.repairSecondsRemaining / 60)}${t('m remaining', ' 分钟后完成')}`));
    }
    if (typeof battery.restoreSeconds === 'number' && battery.restoreSeconds > 0 && battery.current < battery.max) {
        body.appendChild(_h('div', { className: 'detail-row' }, _h('span', { className: 'label' }, t('Full in:', '充满还需：')), ` ${Math.floor(battery.restoreSeconds / 3600)}h ${Math.floor((battery.restoreSeconds % 3600) / 60)}m`));
    }
    card.appendChild(body);
    personalDroneContainer.replaceChildren(card);
}

function renderDroneActive() {
    if (!droneActiveContainer) return;
    const mission = _droneMissionData;
    const isRunning = mission && _droneData && _droneData.activeMissionId && mission.status === 'RUNNING';
    if (!isRunning) {
        droneActiveContainer.replaceChildren(_noData(t('No active drone mission.', '没有进行中的无人机任务。')));
        return;
    }
    const loc = (mission.location && mission.location.name) || '';
    const mis = (mission.mission && mission.mission.name) || '';
    if (mission.endTime) state.expeditionEndTimes[mission.id] = mission.endTime;
    const timerSpan = _h('span', { className: 'exp-timer', dataset: { expId: mission.id } }, mission.endTime ? formatTimeRemaining(mission.endTime) : '--');
    const pinBtn = _h('button', { className: 'refresh-btn-small pin-btn pin-exp-btn', dataset: { expId: mission.id }, title: t('Pin Expedition Timer', '固定远征计时器') }, '📌');
    const card = _h('div', { className: 'expedition-card' },
        _h('div', { className: 'exp-header' },
            _h('span', { className: 'exp-title' }, `📍 ${loc} — ${mis}`),
            _h('span', { className: 'exp-status running' }, mission.status || 'RUNNING')),
        _h('div', { className: 'detail-row' }, _h('span', { className: 'label' }, t('Risk:', '风险：')), ` ${mission.finalRisk ?? '--'}`),
        _h('div', { className: 'detail-row' }, _h('span', { className: 'label' }, t('Battery Cost:', '电量消耗：')), ` ${mission.batteryCost ?? '--'}`),
        mission.endTime ? _h('div', { className: 'exp-timer-row' },
            _h('span', { style: 'font-size:11px;color:var(--accent-orange);' }, '⏳ ', timerSpan), pinBtn) : null);
    droneActiveContainer.replaceChildren(card);
    // Pin wiring (same pattern as mercenary expedition cards)
    card.querySelectorAll('.pin-exp-btn').forEach(btn => {
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

function renderDroneDecisions() {
    if (!droneDecisionsContainer) return;
    const mission = _droneMissionData;
    const isRunning = mission && _droneData && _droneData.activeMissionId && mission.status === 'RUNNING';
    const events = isRunning && Array.isArray(mission.channelEvents) ? mission.channelEvents : [];
    const decisions = events.filter(e => e.type === 'DECISION' || e.type === 'HAZARD');
    if (droneDecisionsCount) droneDecisionsCount.textContent = decisions.length ? `(${decisions.length})` : '';
    if (!isRunning || decisions.length === 0) {
        droneDecisionsContainer.replaceChildren(_noData(t('No active mission decisions.', '没有进行中的任务决策。')));
        return;
    }
    const frag = document.createDocumentFragment();
    for (const ev of decisions) {
        const chosen = (Array.isArray(mission.resolvedEvents) ? mission.resolvedEvents : []).find(r => r.eventId === ev.eventId);
        const chosenLabel = chosen && Array.isArray(ev.options) ? (ev.options.find(o => o.id === chosen.optionId) || {}).label : null;
        const statusColor = ev.isResolved ? 'var(--accent-green)' : 'var(--accent-orange)';
        const row = _h('div', { style: 'font-size:10px;color:var(--text-muted);padding:4px 0;border-bottom:1px solid var(--border);' },
            _h('div', { style: 'display:flex;justify-content:space-between;gap:6px;' },
                _h('span', { style: `font-weight:bold;color:${ev.type === 'DECISION' ? 'var(--accent-cyan)' : 'var(--accent-red)'};` }, `${ev.type === 'DECISION' ? '🧭' : '⚠️'} ${ev.type === 'DECISION' ? t('DECISION', '决策') : t('HAZARD', '危险')}`),
                _h('span', { style: `color:${statusColor};` }, ev.isResolved ? t('Resolved', '已处理') : t('Pending', '待处理'))),
            _h('div', null, ev.message || ''),
            chosenLabel ? _h('div', { style: 'color:var(--accent-green);' }, `✔ ${chosenLabel}`) : null);
        frag.appendChild(row);
    }
    droneDecisionsContainer.replaceChildren(frag);
}

function renderDroneArchived(data) {
    if (!droneArchivedContainer) return;
    let items = data;
    if (data && !Array.isArray(data) && data.items) items = data.items;
    if (!items || !Array.isArray(items) || items.length === 0) {
        droneArchivedContainer.replaceChildren(_noData(t('No archived drone missions found.', '没有已归档的无人机任务。')));
        return;
    }
    const locale = getUiLang() === 'zh' ? 'zh-CN' : undefined;
    const frag = document.createDocumentFragment();
    for (const m of items) {
        const outcome = (m.outcome || m.status || 'ARCHIVED').toUpperCase();
        let cls = 'outcome-full';
        if (outcome.includes('SEVERELY') || outcome.includes('DESTROYED')) cls = 'outcome-death';
        else if (outcome.includes('DAMAGED')) cls = 'outcome-partial';
        else if (outcome.includes('PARTIAL')) cls = 'outcome-partial';
        else if (outcome.includes('FAIL')) cls = 'outcome-fail';

        const loc = (m.location && m.location.name) || '';
        const mis = (m.mission && m.mission.name) || '';
        const infoParts = [`📍 ${loc || '--'}`];
        if (m.finalRisk !== undefined) infoParts.push(`⚠️ ${t('Risk:', '风险：')} ${m.finalRisk}`);
        if (m.damageDealt !== undefined) infoParts.push(`💥 ${t('Damage:', '损伤：')} ${m.damageDealt}`);

        const card = _h('div', { className: 'archived-exp-card' },
            _h('div', { className: 'archived-exp-header' },
                _h('span', { className: 'archived-exp-merc' }, `🛩️ ${mis || '?'}`),
                _h('span', { className: `outcome-tag ${cls}` }, translateStatus(outcome))),
            _h('div', { className: 'archived-exp-info' }, infoParts.join(' · ')));

        const lootItems = Array.isArray(m.loot) ? m.loot : [];
        if (lootItems.length > 0) {
            const uid = 'drone_archived_' + m.id;
            const lootHeader = _h('div', { className: 'expandable-header', dataset: { expand: uid } },
                _h('span', { className: 'expand-arrow' }, '▶'),
                _h('span', { className: 'expand-label' }, `📦 ${t(`Loot (${lootItems.length} items)`, `战利品（${lootItems.length} 件）`)}`));
            const lootBody = _h('div', { className: 'expandable-body', id: uid });
            for (const li of lootItems) {
                const det = (li && typeof li === 'object' && li.item) ? li.item
                    : (li && typeof li === 'object' ? li : { name: String(li) });
                const imgSrc = det.imageUrl || det.image || '';
                const row = _h('div', { style: 'font-size:10px;margin:2px 0;' });
                if (imgSrc) {
                    row.appendChild(_h('img', {
                        src: imgSrc,
                        style: 'width:24px;height:24px;border-radius:4px;vertical-align:middle;margin-right:4px;'
                    }));
                }
                row.appendChild(document.createTextNode(det.name || det.id || '?'));
                if (det.tier) {
                    row.appendChild(_h('span', { className: 'tier-tag tier-tag-' + String(det.tier).toLowerCase() }, det.tier));
                }
                if (det.isCollected) {
                    row.appendChild(_h('span', { style: 'color:var(--accent-green);font-size:9px;' }, ` ✓ ${t('Collected', '已收集')}`));
                } else if (det.isDeleted) {
                    row.appendChild(_h('span', { style: 'color:var(--accent-red);font-size:9px;' }, ` ✗ ${t('Deleted', '已删除')}`));
                }
                lootBody.appendChild(row);
            }
            card.appendChild(_h('div', { className: 'container-items' }, lootHeader, lootBody));
        }

        const completedTs = m.completedAt || m.endTime || m.startTime;
        if (completedTs) {
            card.appendChild(_h('span', { style: 'font-size:9px;color:var(--text-dim);display:flex;flex-direction:row-reverse;' },
                `🕐 ${t('Completed', '完成于')} ${new Date(completedTs).toLocaleString(locale)}`));
        }
        frag.appendChild(card);
    }
    droneArchivedContainer.replaceChildren(frag);
    droneArchivedContainer.querySelectorAll('.expandable-header').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.classList.toggle('open');
            const targetId = hdr.getAttribute('data-expand');
            const body = document.getElementById(targetId);
            if (body) body.classList.toggle('openExtended');
        });
    });
}

// --- Data loading -------------------------------------------------------
export async function loadDrone() {
    const { droneData, droneMissionData } = await chrome.storage.local.get(['droneData', 'droneMissionData']);
    _droneData = droneData || null;
    _droneMissionData = droneMissionData || null;
    populateDroneSelects();
    renderDrone();
    renderDroneActive();
    renderDroneDecisions();
    if (personalDroneLastUpdated) showLastUpdated(personalDroneLastUpdated, 'droneDataUpdatedAt');
    if (droneActiveLastUpdated) showLastUpdated(droneActiveLastUpdated, 'droneMissionUpdatedAt');
    if (droneDecisionsLastUpdated) showLastUpdated(droneDecisionsLastUpdated, 'droneMissionUpdatedAt');
}

async function requestDrone() {
    if (personalDroneContainer) personalDroneContainer.replaceChildren(_noData(t('Requesting drone data...', '正在请求无人机数据...')));
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'requestDroneOptions' });
    } catch (e) { /* not reachable */ }
    await waitForStorageKey('droneData', 8000);
    await loadDrone();
}

async function loadDroneArchived() {
    const { droneArchivedData } = await chrome.storage.local.get('droneArchivedData');
    renderDroneArchived(droneArchivedData || null);
    if (droneArchivedLastUpdated) showLastUpdated(droneArchivedLastUpdated, 'droneArchivedUpdatedAt');
}

async function requestDroneArchived() {
    if (droneArchivedContainer) droneArchivedContainer.replaceChildren(_noData(t('Loading archived drone missions...', '正在加载已归档的无人机任务...')));
    try {
        const tab = await getCor3Tab();
        if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'requestDroneArchived', cursor: null, limit: 20 });
    } catch (e) { /* not reachable */ }
    await waitForStorageKey('droneArchivedData', 8000);
    await loadDroneArchived();
    _droneArchivedLoaded = true;
}

// --- Event wiring -------------------------------------------------------
if (refreshDroneBtn) refreshDroneBtn.addEventListener('click', () => requestDrone());
if (refreshDroneActiveBtn) refreshDroneActiveBtn.addEventListener('click', async () => {
    try { const tab = await getCor3Tab(); if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'requestDroneOptions' }); } catch (e) {}
    setTimeout(() => loadDrone(), 2000);
});
if (refreshDroneArchivedBtn) refreshDroneArchivedBtn.addEventListener('click', () => requestDroneArchived());

if (droneExpActiveToggle && droneExpActiveBody) {
    droneExpActiveToggle.addEventListener('click', () => { droneExpActiveToggle.classList.toggle('open'); droneExpActiveBody.classList.toggle('open'); });
}
if (droneDecisionsToggle && droneDecisionsSectionBody) {
    droneDecisionsToggle.addEventListener('click', () => { droneDecisionsToggle.classList.toggle('open'); droneDecisionsSectionBody.classList.toggle('open'); });
}
if (droneArchivedToggle && droneArchivedSectionBody) {
    droneArchivedToggle.addEventListener('click', () => {
        droneArchivedToggle.classList.toggle('open');
        droneArchivedSectionBody.classList.toggle('open');
        if (droneArchivedSectionBody.classList.contains('open') && !_droneArchivedLoaded) requestDroneArchived();
    });
}

const droneToggleEls = [autoDroneToggle, autoDroneClaimToggle, autoDroneDecideToggle, autoChooseDroneLocationToggle, autoDroneFullChargeToggle, autoDroneRepairToggle, autoDroneRepairOnLowBatteryToggle, autoDronePauseOnFailToggle].filter(Boolean);
droneToggleEls.forEach(el => {
    el.addEventListener('change', () => {
        if (el === autoChooseDroneLocationToggle) updateDroneMissionSelectRow();
        if (el === autoDroneToggle && autoDroneToggle.checked) {
            chrome.storage.sync.get('autoDrone', (data) => {
                const existing = data.autoDrone || {};
                chrome.storage.sync.set({ autoDrone: Object.assign({}, existing, droneSettingsToStorage(), { paused: false }) });
            });
            chrome.storage.local.remove('droneWarning');
            updateDroneWarning(null);
            requestDrone();
        } else {
            saveDroneSettings();
        }
    });
});
if (droneRepairThresholdInput) droneRepairThresholdInput.addEventListener('change', saveDroneSettings);
if (droneLowBatteryThresholdInput) droneLowBatteryThresholdInput.addEventListener('change', saveDroneSettings);
if (droneLocationSelect) droneLocationSelect.addEventListener('change', () => { populateDroneSelects(); saveDroneSettings(); });
if (droneMissionSelect) droneMissionSelect.addEventListener('change', saveDroneSettings);

// --- Initial load + storage listeners -----------------------------------
chrome.storage.sync.get('autoDrone', (data) => {
    const cfg = data.autoDrone || {};
    if (autoDroneToggle) autoDroneToggle.checked = !!cfg.enabled;
    if (autoDroneClaimToggle) autoDroneClaimToggle.checked = cfg.autoClaim !== false;
    if (autoDroneDecideToggle) autoDroneDecideToggle.checked = cfg.autoDecide !== false;
    if (autoChooseDroneLocationToggle) autoChooseDroneLocationToggle.checked = !!cfg.autoChooseLocation;
    if (autoDroneFullChargeToggle) autoDroneFullChargeToggle.checked = !!cfg.fullChargeBeforeLaunch;
    if (autoDroneRepairToggle) autoDroneRepairToggle.checked = !!cfg.repairEnabled;
    if (droneRepairThresholdInput) droneRepairThresholdInput.value = cfg.repairThreshold ?? 60;
    if (autoDroneRepairOnLowBatteryToggle) autoDroneRepairOnLowBatteryToggle.checked = !!cfg.repairOnLowBattery;
    if (droneLowBatteryThresholdInput) droneLowBatteryThresholdInput.value = cfg.lowBatteryThreshold ?? 30;
    if (autoDronePauseOnFailToggle) autoDronePauseOnFailToggle.checked = cfg.pauseOnRepairFail !== false;
    updateDroneMissionSelectRow();
    updateDroneWarning(cfg);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.droneData || changes.droneMissionData) loadDrone();
    if (changes.droneArchivedData) loadDroneArchived();
    if (changes.droneWarning) {
        const warn = changes.droneWarning.newValue;
        if (warn && droneWarning) { droneWarning.textContent = '⚠️ ' + translateErrorText(warn); droneWarning.style.display = ''; }
    }
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.autoDrone && changes.autoDrone.newValue) {
        const cfg = changes.autoDrone.newValue;
        if (autoDroneToggle) autoDroneToggle.checked = !!cfg.enabled;
        updateDroneWarning(cfg);
    }
});

onLangChange(() => {
    loadDrone();
    loadDroneArchived();
});

loadDrone();
loadDroneArchived();
