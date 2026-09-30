// Alarm system — audio alarms and timer checks

import { isContextValid } from './helpers.js';

export let alarms = [];
export let alarmTriggered = {};
let audioContext = null;
let continuousInterval = null;
export let isAlarmActive = false;

// Interval IDs — stored so we can clear them on context invalidation
export let alarmsIntervalId = null;
export let autoRefreshIntervalId = null;

export function clearAllIntervals() {
    if (alarmsIntervalId) { clearInterval(alarmsIntervalId); alarmsIntervalId = null; }
    if (autoRefreshIntervalId) { clearInterval(autoRefreshIntervalId); autoRefreshIntervalId = null; }
}

// Load alarms
chrome.storage.sync.get('alarms', (data) => {
    alarms = data.alarms || [];
});

export function setAlarms(v) { alarms = v; }
export function resetAlarmTriggered() { alarmTriggered = {}; }

export function playAlarm(volumePercent) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const now = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(volumePercent / 100, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(now + 0.5);
}

export function startContinuousAlarm(volume) {
    if (continuousInterval) clearInterval(continuousInterval);
    isAlarmActive = true;
    chrome.runtime.sendMessage({ action: "alarmActiveStatus", isActive: true }).catch(()=>{});
    playAlarm(volume);
    continuousInterval = setInterval(() => {
        playAlarm(volume);
    }, 2000);
}

export function stopAlarm() {
    if (continuousInterval) {
        clearInterval(continuousInterval);
        continuousInterval = null;
    }
    isAlarmActive = false;
    chrome.runtime.sendMessage({ action: "alarmActiveStatus", isActive: false }).catch(()=>{});
}

export function getTimerRemainingSeconds(timerSource) {
    return new Promise((resolve) => {
        if (!isContextValid()) { resolve(null); return; }
        if (timerSource === 'daily') {
            chrome.storage.local.get('dailyOpsData', (result) => {
                if (result.dailyOpsData && result.dailyOpsData.nextTaskTime) {
                    const diff = new Date(result.dailyOpsData.nextTaskTime).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'home_jobs') {
            chrome.storage.local.get('marketData', (result) => {
                if (result.marketData && result.marketData.nextJobsResetAt) {
                    const diff = new Date(result.marketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'dark_jobs') {
            chrome.storage.local.get('darkMarketData', (result) => {
                if (result.darkMarketData && result.darkMarketData.nextJobsResetAt) {
                    const diff = new Date(result.darkMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'soyuz_jobs') {
            chrome.storage.local.get('soyuzMarketData', (result) => {
                if (result.soyuzMarketData && result.soyuzMarketData.nextJobsResetAt) {
                    const diff = new Date(result.soyuzMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource === 'usol_jobs') {
            chrome.storage.local.get('usolMarketData', (result) => {
                if (result.usolMarketData && result.usolMarketData.nextJobsResetAt) {
                    const diff = new Date(result.usolMarketData.nextJobsResetAt).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
        } else if (timerSource.startsWith('exp_')) {
            const expId = timerSource.substring(4);
            chrome.storage.local.get('expeditionsData', (result) => {
                const exps = result.expeditionsData || [];
                const exp = exps.find(e => e.id === expId);
                if (exp && exp.endTime) {
                    const diff = new Date(exp.endTime).getTime() - Date.now();
                    resolve(diff > 0 ? Math.floor(diff / 1000) : 0);
                } else {
                    resolve(null);
                }
            });
		} else {
            resolve(null);
        }
    });
}

export async function checkAlarms() {
    try {
        if (!isContextValid()) return;
        for (const alarm of alarms) {
            if (!alarm.enabled || alarm.thresholdSeconds <= 0) continue;
            const remaining = await getTimerRemainingSeconds(alarm.timerSource);
            if (remaining === null) continue;

            if (remaining <= alarm.thresholdSeconds && remaining > 0 && !alarmTriggered[alarm.id]) {
                alarmTriggered[alarm.id] = true;
                if (alarm.continuous) {
                    startContinuousAlarm(alarm.volume);
                } else {
                    playAlarm(alarm.volume);
                }
            } else if (remaining > alarm.thresholdSeconds) {
                alarmTriggered[alarm.id] = false;
            }
        }
    } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) return;
    }
}

// Check alarms every second
alarmsIntervalId = setInterval(() => checkAlarms(), 1000);
