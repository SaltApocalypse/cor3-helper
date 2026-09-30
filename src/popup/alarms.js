// --- Multi-Alarm System ---
import { getCor3Tab } from './utils.js';
import { el, clearEl, noDataMsg } from './dom-helpers.js';
import { showDevTcs, isDevTcsVisible } from './dev-tcs.js';

const alarmList = document.getElementById('alarmList');
const alarmForm = document.getElementById('alarmForm');
const alarmFormTitle = document.getElementById('alarmFormTitle');
const addAlarmBtn = document.getElementById('addAlarmBtn');
const saveAlarmBtn = document.getElementById('saveAlarmBtn');
const cancelAlarmBtn = document.getElementById('cancelAlarmBtn');
const testAlarmBtn = document.getElementById('testAlarmBtn');
const stopAllAlarmsBtn = document.getElementById('stopAllAlarmsBtn');
export const alarmTimerSelect = document.getElementById('alarmTimerSelect');
const alarmMinutes = document.getElementById('alarmMinutes');
const alarmSeconds = document.getElementById('alarmSeconds');
const alarmContinuous = document.getElementById('alarmContinuous');
const alarmVolumeSlider = document.getElementById('alarmVolume');
const alarmVolumeLabel = document.getElementById('alarmVolumeLabel');
const statusDiv = document.getElementById('status');

let alarms = [];
let editingAlarmId = null;

export const TIMER_LABELS = {
    daily: 'Daily Ops',
    home_jobs: 'Market-1 Jobs Reset',
    dark_jobs: 'Market-2 Jobs Reset',
    soyuz_jobs: 'Market-3 Jobs Reset',
    usol_jobs: 'Market-4 Jobs Reset'
};

const alarmExpeditionGroup = document.getElementById('alarmExpeditionGroup');

export function updateExpeditionAlarmOptions(expeditions) {
    if (!alarmExpeditionGroup) return;
    clearEl(alarmExpeditionGroup);
    if (!expeditions || expeditions.length === 0) return;
    for (const exp of expeditions) {
        if (!exp.endTime) continue;
        const opt = document.createElement('option');
        opt.value = 'exp_' + exp.id;
        const label = (exp.locationName || 'Expedition') + ' — ' + (exp.zoneName || '');
        opt.textContent = label;
        TIMER_LABELS['exp_' + exp.id] = label;
        alarmExpeditionGroup.appendChild(opt);
    }
    renderAlarmList();
}

alarmVolumeSlider.addEventListener('input', () => {
    alarmVolumeLabel.textContent = alarmVolumeSlider.value + '%';
});

function generateAlarmId() {
    return 'alarm_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

export async function loadAlarms() {
    const data = await chrome.storage.sync.get('alarms');
    alarms = data.alarms || [];
    renderAlarmList();
    sendAlarmsToContent();
}

async function saveAlarms() {
    await chrome.storage.sync.set({ alarms });
    renderAlarmList();
    sendAlarmsToContent();
}

async function sendAlarmsToContent() {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "updateAlarms",
            alarms: alarms
        }).catch(() => {});
    }
}

export function renderAlarmList() {
    if (alarms.length === 0) {
        alarmList.replaceChildren(el('div', { className: 'no-alarms' }, 'No alarms configured. Click ➕ to add one.'));
        return;
    }
    const frag = document.createDocumentFragment();
    for (const a of alarms) {
        const mins = Math.floor(a.thresholdSeconds / 60);
        const secs = a.thresholdSeconds % 60;
        const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        const toggleInput = el('input', { type: 'checkbox', dataset: { action: 'toggle', id: a.id } });
        if (a.enabled) toggleInput.checked = true;
        toggleInput.addEventListener('change', async (e) => {
            const alarm = alarms.find(x => x.id === e.target.dataset.id);
            if (alarm) {
                alarm.enabled = e.target.checked;
                await saveAlarms();
            }
        });

        const editBtn = el('button', { dataset: { action: 'edit', id: a.id }, title: 'Edit' }, '✏️');
        editBtn.addEventListener('click', (e) => {
            const alarm = alarms.find(x => x.id === e.target.dataset.id);
            if (alarm) openAlarmForm(alarm);
        });

        const deleteBtn = el('button', { dataset: { action: 'delete', id: a.id }, title: 'Delete' }, '🗑️');
        deleteBtn.addEventListener('click', async (e) => {
            alarms = alarms.filter(x => x.id !== e.target.dataset.id);
            await saveAlarms();
        });

        const card = el('div', { className: 'alarm-card' + (a.enabled ? '' : ' alarm-off'), dataset: { id: a.id } },
            el('label', { className: 'alarm-toggle-switch' },
                toggleInput,
                el('span', { className: 'slider-track' })
            ),
            el('div', { className: 'alarm-info' },
                el('div', { className: 'alarm-name' }, TIMER_LABELS[a.timerSource] || a.timerSource),
                el('div', { className: 'alarm-detail' }, `⏱ ${timeStr} · 🔊 ${a.volume}%${a.continuous ? ' · 🔁' : ''}`)
            ),
            el('div', { className: 'alarm-actions' }, editBtn, deleteBtn)
        );
        frag.appendChild(card);
    }
    alarmList.replaceChildren(frag);
}

function openAlarmForm(alarm = null) {
    if (alarm) {
        editingAlarmId = alarm.id;
        alarmFormTitle.textContent = 'Edit Alarm';
        alarmTimerSelect.value = alarm.timerSource;
        alarmMinutes.value = Math.floor(alarm.thresholdSeconds / 60);
        alarmSeconds.value = alarm.thresholdSeconds % 60;
        alarmContinuous.checked = alarm.continuous;
        alarmVolumeSlider.value = alarm.volume;
        alarmVolumeLabel.textContent = alarm.volume + '%';
    } else {
        editingAlarmId = null;
        alarmFormTitle.textContent = 'New Alarm';
        alarmTimerSelect.value = 'daily';
        alarmMinutes.value = 1;
        alarmSeconds.value = 0;
        alarmContinuous.checked = false;
        alarmVolumeSlider.value = 50;
        alarmVolumeLabel.textContent = '50%';
    }
    alarmForm.style.display = '';
}

function closeAlarmForm() {
    alarmForm.style.display = 'none';
    editingAlarmId = null;
}

addAlarmBtn.addEventListener('click', () => openAlarmForm());
cancelAlarmBtn.addEventListener('click', () => closeAlarmForm());

saveAlarmBtn.addEventListener('click', async () => {
    const thresholdSec = (parseInt(alarmMinutes.value) || 0) * 60 + (parseInt(alarmSeconds.value) || 0);
    if (thresholdSec <= 0) return;
    const alarmData = {
        timerSource: alarmTimerSelect.value,
        thresholdSeconds: thresholdSec,
        continuous: alarmContinuous.checked,
        volume: parseInt(alarmVolumeSlider.value),
        enabled: true
    };
    if (editingAlarmId) {
        const idx = alarms.findIndex(a => a.id === editingAlarmId);
        if (idx >= 0) {
            alarms[idx] = { ...alarms[idx], ...alarmData };
        }
    } else {
        alarms.push({ id: generateAlarmId(), ...alarmData });
    }
    await saveAlarms();
    closeAlarmForm();
});

let _devTcHoldTimer = null;
let _devTcHoldTriggered = false;
testAlarmBtn.addEventListener('mousedown', () => {
    _devTcHoldTriggered = false;
    _devTcHoldTimer = setTimeout(() => {
        _devTcHoldTriggered = true;
        if (!isDevTcsVisible()) showDevTcs();
    }, 5000);
});
testAlarmBtn.addEventListener('mouseup', () => { clearTimeout(_devTcHoldTimer); });
testAlarmBtn.addEventListener('mouseleave', () => { clearTimeout(_devTcHoldTimer); });
testAlarmBtn.addEventListener('click', async () => {
    if (_devTcHoldTriggered) return;
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, {
            action: "testAlarm",
            volume: parseInt(alarmVolumeSlider.value),
            continuous: alarmContinuous.checked
        });
    }
});

stopAllAlarmsBtn.addEventListener('click', async () => {
    const tab = await getCor3Tab();
    if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: "stopAlarm" });
        stopAllAlarmsBtn.style.display = 'none';
    }
});

chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "alarmActiveStatus") {
        stopAllAlarmsBtn.style.display = request.isActive ? '' : 'none';
        statusDiv.textContent = request.isActive ? 'Alarm sounding...' : 'Ready';
    }
});

loadAlarms();
