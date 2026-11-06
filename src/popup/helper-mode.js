// --- Helper-Only Mode ---
import { renderDebugJobs, renderDebugLogs } from './auto-job-solver-ui.js';
import { loadPinnedState } from './pinned-timers.js';
import { updateAutoUpdateMarketsStatus } from './ui-toggles.js';
import { state } from './state.js';

chrome.storage.sync.get('helperMode', (result) => {
    state.isHelper = result.helperMode;
});

let oldValues = {};
const helperModeToggle = document.getElementById('helperModeToggle');
export async function applyHelperMode(helper, mode) {
    state.isHelper = helper;
    if (state.isHelper) {console.log("Enabling helper mode!!");}
    else {console.log("Disabling helper mode!!");}

    const automationKeys = [
        'autoRefresh', 'autoJobSolverEnabled', 'autoFinishAllJobsEnabled',
        'autoJobsDebugConsoleEnabled', 'autoUpdateMarkets', 'autoSendMerc', 'autoDrone',
        'autoDailyHackEnabled'
    ];

    if (mode === 'update') {
        let disabledValue = '';
        let value = '';
        if (state.isHelper) {
            oldValues = await chrome.storage.sync.get(automationKeys);
            chrome.storage.sync.set({ oldValues: oldValues });
        } else {
            oldValues = await chrome.storage.sync.get('oldValues');
        }
        console.log(JSON.stringify(oldValues));
        automationKeys.forEach(key => {
            if (key === 'autoRefresh') {
                disabledValue = {"dark_jobs":false,"home_jobs":false,"soyuz_jobs":false,"usol_jobs":false};
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else if (key === 'autoSendMerc') {
                disabledValue = {
                    enabled: false,
                    hasInsurance: false,
                    disabledReason: null
                };
                const oldMerc = oldValues[key] || {};
                value = state.isHelper ? disabledValue : {
                    enabled: !!oldMerc.enabled,
                    hasInsurance: !!oldMerc.hasInsurance,
                    disabledReason: oldMerc.disabledReason || null
                };
                chrome.storage.sync.set({ [key]: value });
            } else if (key === 'autoDrone') {
                disabledValue = {
                    enabled: false,
                    paused: true,
                    repairEnabled: false
                };
                const oldDrone = oldValues[key] || {};
                value = state.isHelper ? disabledValue : {
                    enabled: !!oldDrone.enabled,
                    paused: false,
                    repairEnabled: !!oldDrone.repairEnabled
                };
                chrome.storage.sync.set({ [key]: value });
            } else {
                value = state.isHelper ? false : (oldValues[key] ?? false);
                chrome.storage.sync.set({ [key]: value });
            }
        });

        if (state.isHelper) {
            chrome.storage.local.remove(['mercWarning', 'droneWarning', 'expeditionLaunchError']);
        }

        let toggles = {};
        try {
            toggles = await chrome.storage.sync.get(['autoRefresh', 'autoJobSolverEnabled', 'autoUpdateMarkets', 'autoFinishAllJobsEnabled', 'autoJobsDebugConsoleEnabled', 'autoSendMerc', 'autoDrone']);
        } catch (err) {
            console.log("Couldn't find the related item on storage -> " + err);
        }

        // --- Update Toggles ---

        // Pinned Auto Refresh Timers

        const setPinnedAutoRefresh = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!value;
        };
        const autoRefresh = toggles.autoRefresh || {};
        setPinnedAutoRefresh('autoRefreshCore', autoRefresh.home_jobs);
        setPinnedAutoRefresh('autoRefreshDark', autoRefresh.dark_jobs);
        setPinnedAutoRefresh('autoRefreshSoyuz', autoRefresh.soyuz_jobs);
        setPinnedAutoRefresh('autoRefreshUsol', autoRefresh.usol_jobs);

        loadPinnedState()

        // Auto Jobs and Auto Update Markets

        (document.getElementById('autoJobSolverToggle')).checked = !!toggles.autoJobSolverEnabled ?? false;
        (document.getElementById('autoJobSolverStatus')).textContent = !!toggles.autoJobSolverEnabled ? 'Active' : 'Off';
        (document.getElementById('autoJobSolverStatus')).style.color = !!toggles.autoJobSolverEnabled ? 'var(--accent-green)' : 'var(--text-dim)';
        (document.getElementById('autoUpdateMarketsToggle')).checked = !!toggles.autoUpdateMarkets ?? false;
        (document.getElementById('autoUpdateMarketsStatus')).textContent = !!toggles.autoUpdateMarkets ? 'Active' : 'Off';
        (document.getElementById('autoUpdateMarketsStatus')).style.color = !!toggles.autoUpdateMarkets ? 'var(--accent-green)' : 'var(--text-dim)';

        (document.getElementById('autoJobSolverSection')).style.display = !!toggles.autoJobSolverEnabled ? '' : 'none';

        (document.getElementById('autoFinishAllJobsToggle')).checked = !!toggles.autoFinishAllJobsEnabled ?? false;
        (document.getElementById('autoJobsDebugToggle')).checked =  !!toggles.autoJobsDebugConsoleEnabled ?? false;
        (document.getElementById('autoJobsDebugConsole')).style.display = !!toggles.autoJobsDebugConsoleEnabled ? '' : 'none';
        if (!!toggles.autoJobsDebugConsoleEnabled) {
            renderDebugJobs();
            renderDebugLogs();
        }

        updateAutoUpdateMarketsStatus();

        // Mercenaries / Drone

        const merc = toggles.autoSendMerc || {};
        (document.getElementById('autoSendMercenaryToggle')).checked = !!merc.enabled;
        (document.getElementById('mercInsuranceToggle')).checked = !!merc.hasInsurance;

        const drone = toggles.autoDrone || {};
        (document.getElementById('autoDroneToggle')).checked = !!drone.enabled;
        (document.getElementById('autoDroneRepairToggle')).checked = !!drone.repairEnabled;

    }

    // --- Update Toggle Rows, Checkbox and Container sections ---

    // Pinned Auto Refresh Timers

    (document.querySelectorAll('.pinned-auto-refresh')).forEach(element => {
        element.style.display = state.isHelper ? 'none' : 'flex';
    });

    // Auto Jobs and Auto Update Markets

    ['autoJobSolverToggle', 'autoValuableSellerToggle', 'autoUpdateMarketsToggle'].forEach(key => {
        ((document.getElementById(key)).closest('.auto-decrypt-row')).style.display = state.isHelper ? 'none' : 'flex';
    });

    // Mercenary and Drone automation

    [
        'mercInsuranceToggle', 'autoSendMercenaryToggle',
        'autoDroneToggle', 'autoDroneRepairToggle'
    ].forEach(key => {
        const el = document.getElementById(key);
        const row = el && el.closest('.auto-choose-row');
        if (row) row.style.display = state.isHelper ? 'none' : 'flex';
    });

}
if (helperModeToggle) {
    chrome.storage.sync.get('helperMode', (result) => {
        helperModeToggle.checked = result.helperMode || false;
        applyHelperMode(helperModeToggle.checked, 'render');
    });
    helperModeToggle.addEventListener('change', () => {
        state.isHelper = helperModeToggle.checked;
        chrome.storage.sync.set({ helperMode: state.isHelper });
        applyHelperMode(state.isHelper, 'update');
    });
}
