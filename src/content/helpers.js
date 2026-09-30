// content.js helpers — context check, automation queue

export function isContextValid() {
    try { return !!chrome.runtime.id; } catch (e) { return false; }
}

// --- Automation Queue: prevents parallel endpoint-changing processes ---
let _automationQueue = [];
let _automationActive = null; // { type, startedAt }

export function _automationQueueStatus() {
    return {
        active: _automationActive ? _automationActive.type : null,
        queued: _automationQueue.map(q => q.type)
    };
}

export function getAutomationActive() { return _automationActive; }
export function setAutomationActive(v) { _automationActive = v; }
export function getAutomationQueue() { return _automationQueue; }
export function setAutomationQueue(v) { _automationQueue = v; }

export function _broadcastQueueStatus() {
    if (!isContextValid()) return;
    try { chrome.storage.local.set({ automationQueueStatus: _automationQueueStatus() }); } catch (e) {}
}

export function _automationFinish(type) {
    if (_automationActive && _automationActive.type === type) {
        console.log('[COR3 Helper] Automation finished:', type);
        _automationActive = null;
        _broadcastQueueStatus();
        _automationProcessNext();
    }
}

export function _automationProcessNext() {
    if (_automationActive) return;
    if (_automationQueue.length === 0) {
        _broadcastQueueStatus();
        setTimeout(() => {
            if (_automationActive || _automationQueue.length > 0) return;
            chrome.storage.local.get('expeditionsData', (result) => {
                if (result.expeditionsData) {
                    // Lazy import to avoid circular dependency
                    import('./auto-send.js').then(m => m.checkAutoSendOnExpeditionData(result.expeditionsData));
                }
            });
        }, 3000);
        return;
    }
    var next = _automationQueue.shift();
    _automationActive = { type: next.type, startedAt: Date.now() };
    console.log('[COR3 Helper] Automation starting:', next.type);
    _broadcastQueueStatus();
    next.run();
}

export function _automationEnqueue(type, runFn) {
    if (_automationActive && _automationActive.type === type) return 'already-running';
    if (_automationQueue.some(q => q.type === type)) return 'already-queued';
    if (!_automationActive) {
        _automationActive = { type: type, startedAt: Date.now() };
        console.log('[COR3 Helper] Automation starting:', type);
        _broadcastQueueStatus();
        runFn();
        return 'started';
    }
    _automationQueue.push({ type: type, run: runFn });
    console.log('[COR3 Helper] Automation queued:', type, '(waiting for', _automationActive.type, ')');
    _broadcastQueueStatus();
    return 'queued';
}
