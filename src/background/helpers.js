export async function getCor3Tab() {
    try {
        const [tab] = await chrome.tabs.query({ url: "*://*.cor3.gg/*" });
        return tab || null;
    } catch (e) { return null; }
}

const BG_AUTO_JOBS_MAX_LOGS = 200;
export async function bgAutoJobLog(msg, level) {
    const entry = { timestamp: new Date().toISOString(), msg, level: level || 'info' };
    try {
        const data = await chrome.storage.local.get('autoJobsDebugLogs');
        const logs = Array.isArray(data.autoJobsDebugLogs) ? data.autoJobsDebugLogs : [];
        logs.push(entry);
        if (logs.length > BG_AUTO_JOBS_MAX_LOGS) logs.splice(0, logs.length - BG_AUTO_JOBS_MAX_LOGS);
        await chrome.storage.local.set({ autoJobsDebugLogs: logs });
    } catch (e) { /* storage error — ignore */ }
}

export const BG_ERROR_MAP = {
    'sai-hack-impossible': 'Not enough hack power',
    'sai-no-hack-software': 'No hacking software',
    'no-path-to-server': 'No path to server (unreachable)',
    'server-in-maintenance': 'Server is in maintenance',
    'invalid-access-token': 'Access token expired or invalid',
    'token-expired': 'Session token expired'
};

export function bgFriendlyError(msg) { return (msg && BG_ERROR_MAP[msg]) || msg || 'Unknown error'; }
