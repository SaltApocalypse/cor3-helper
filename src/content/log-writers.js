// Serialized batched log writers for auto-jobs and valuable seller

import { isContextValid } from './helpers.js';

// --- Auto Job Logs ---
let _autoJobLogQueue = [];
let _autoJobLogFlushTimer = null;
let _autoJobLogFlushing = false;

function _flushAutoJobLogs() {
    _autoJobLogFlushTimer = null;
    if (_autoJobLogFlushing || _autoJobLogQueue.length === 0 || !isContextValid()) return;
    _autoJobLogFlushing = true;
    const pending = _autoJobLogQueue.splice(0);
    chrome.storage.local.get('autoJobsDebugLogs', (result) => {
        if (!isContextValid()) { _autoJobLogFlushing = false; return; }
        const logs = Array.isArray(result.autoJobsDebugLogs) ? result.autoJobsDebugLogs : [];
        for (const entry of pending) logs.push(entry);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        chrome.storage.local.set({ autoJobsDebugLogs: logs }, () => {
            _autoJobLogFlushing = false;
            if (_autoJobLogQueue.length > 0) {
                _flushAutoJobLogs();
            }
        });
    });
}

export function queueAutoJobLog(msg, level) {
    _autoJobLogQueue.push({ timestamp: new Date().toISOString(), msg: msg, level: level || 'info' });
    if (!_autoJobLogFlushTimer && !_autoJobLogFlushing) {
        _autoJobLogFlushTimer = setTimeout(_flushAutoJobLogs, 100);
    }
    if (typeof cor3LogEntry === 'function') cor3LogEntry('auto-jobs', msg, level || 'info');
}

// --- Valuable Seller Logs ---
let _valuableLogQueue = [];
let _valuableLogFlushTimer = null;
let _valuableLogFlushing = false;

function _flushValuableLogs() {
    _valuableLogFlushTimer = null;
    if (_valuableLogFlushing || _valuableLogQueue.length === 0 || !isContextValid()) return;
    _valuableLogFlushing = true;
    const pending = _valuableLogQueue.splice(0);
    chrome.storage.local.get('valuableDebugLogs', (result) => {
        if (!isContextValid()) { _valuableLogFlushing = false; return; }
        const logs = Array.isArray(result.valuableDebugLogs) ? result.valuableDebugLogs : [];
        for (const entry of pending) logs.push(entry);
        if (logs.length > 200) logs.splice(0, logs.length - 200);
        chrome.storage.local.set({ valuableDebugLogs: logs }, () => {
            _valuableLogFlushing = false;
            if (_valuableLogQueue.length > 0) {
                _flushValuableLogs();
            }
        });
    });
}

export function queueValuableLog(msg, level) {
    _valuableLogQueue.push({ timestamp: new Date().toISOString(), msg: msg, level: level || 'info' });
    if (!_valuableLogFlushTimer && !_valuableLogFlushing) {
        _valuableLogFlushTimer = setTimeout(_flushValuableLogs, 100);
    }
    if (typeof cor3LogEntry === 'function') cor3LogEntry('auto-valuable', msg, level || 'info');
}
