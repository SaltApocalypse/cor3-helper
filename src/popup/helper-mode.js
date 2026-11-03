// --- Helper-Only Mode ---
import { reRenderDecisions } from './modifiers.js';
import { loadMercenaries } from './mercenaries.js';
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
        'autoJobsDebugConsoleEnabled', 'autoUpdateMarkets', 'autoSendMerc', 'autoDrone'
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
                disabledValue = Object.assign({}, oldValues[key] || {}, {
                    enabled: false,
                    autoClaim: false,
                    autoResolveDecisions: false,
                    autoChooseMerc: false,
                    autoChooseUsolFirst: false,
                    ignoreEliteMerc: false,
                    applyMercCostLimiter: false,
                    maxMercCost: 15000,
                    disabledReason: null,
                    mercenaryId: "",
                    mercenaryName: ""
                });
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else if (key === 'autoDrone') {
                disabledValue = Object.assign({}, oldValues[key] || {}, {
                    enabled: false,
                    paused: true,
                    autoClaim: false,
                    autoDecide: false,
                    autoChooseLocation: false
                });
                value = state.isHelper ? disabledValue : (oldValues[key] ?? disabledValue);
                chrome.storage.sync.set({ [key]: value });
            } else {
                value = state.isHelper ? false : (oldValues[key] ?? false);
                chrome.storage.sync.set({ [key]: value });
            }
        });

        reRenderDecisions();
        loadMercenaries();

        let toggles = {};
        try {
            toggles = await chrome.storage.sync.get(['autoRefresh', 'autoJobSolverEnabled', 'autoUpdateMarkets', 'autoFinishAllJobsEnabled', 'autoJobsDebugConsoleEnabled', 'autoSendMerc', 'autoDrone', 'aggressiveDecisions']);
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

        // Auto Decisions / Mercenaries / Drone

        const merc = toggles.autoSendMerc || {};
        (document.getElementById('autoChooseCheckbox')).checked = !!merc.autoResolveDecisions;
        (document.getElementById('autoSendMercenaryToggle')).checked = !!merc.enabled;
        (document.getElementById('autoClaimMercToggle')).checked = merc.autoClaim !== false;
        (document.getElementById('autoChooseMercToggle')).checked = !!merc.autoChooseMerc;
        (document.getElementById('autoChooseUsolFirstToggle')).checked = !!merc.autoChooseUsolFirst;
        (document.getElementById('ignoreEliteMercToggle')).checked = !!merc.ignoreEliteMerc;
        (document.getElementById('applyMercCostLimiterToggle')).checked = !!merc.applyMercCostLimiter;
        (document.getElementById('maxMercCostInput')).value = merc.maxMercCost ?? 15000;
        (document.getElementById('mercCostDisplayValue')).textContent = merc.maxMercCost ?? 15000;

        const drone = toggles.autoDrone || {};
        (document.getElementById('autoDroneToggle')).checked = !!drone.enabled;
        (document.getElementById('autoDroneClaimToggle')).checked = drone.autoClaim !== false;
        (document.getElementById('autoDroneDecideToggle')).checked = drone.autoDecide !== false;
        (document.getElementById('autoChooseDroneLocationToggle')).checked = !!drone.autoChooseLocation;
        (document.getElementById('autoDroneFullChargeToggle')).checked = !!drone.fullChargeBeforeLaunch;
        (document.getElementById('autoDroneRepairToggle')).checked = !!drone.repairEnabled;
        (document.getElementById('autoDroneRepairOnLowBatteryToggle')).checked = !!drone.repairOnLowBattery;
        (document.getElementById('autoDronePauseOnFailToggle')).checked = drone.pauseOnRepairFail !== false;
        (document.getElementById('droneRepairThresholdInput')).value = drone.repairThreshold ?? 60;
        (document.getElementById('droneLowBatteryThresholdInput')).value = drone.lowBatteryThreshold ?? 30;

        const aggressive = !!toggles.aggressiveDecisions;
        (document.getElementById('aggressiveDecisionsToggle')).checked = aggressive;
        (document.getElementById('aggressiveDecisionsDroneToggle')).checked = aggressive;

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

    // Auto Decisions and Auto Mercs

    [
        'autoChooseCheckbox', 'autoChooseMercToggle', 'autoChooseUsolFirstToggle',
        'ignoreEliteMercToggle', 'applyMercCostLimiterToggle', 'autoSendMercenaryToggle',
        'autoClaimMercToggle', 'autoDroneToggle', 'autoDroneClaimToggle',
        'autoDroneDecideToggle', 'autoChooseDroneLocationToggle', 'autoDroneFullChargeToggle',
        'autoDroneRepairToggle', 'autoDroneRepairOnLowBatteryToggle', 'autoDronePauseOnFailToggle',
        'aggressiveDecisionsToggle', 'aggressiveDecisionsDroneToggle'
    ].forEach(key => {
        const el = document.getElementById(key);
        const row = el && el.closest('.auto-choose-row');
        if (row) row.style.display = state.isHelper ? 'none' : 'flex';
    });

    ['mercAdvancedBody', 'droneAdvancedBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = state.isHelper ? 'none' : '';
    });

    // Hide merc cost display/edit rows in helper mode
    if (document.getElementById('mercCostDisplay')) document.getElementById('mercCostDisplay').style.display = state.isHelper ? 'none' : '';
    if (document.getElementById('mercCostEditRow')) document.getElementById('mercCostEditRow').style.display = 'none';

    (document.getElementById('mercenariesContainer')).querySelectorAll('.merc-card').forEach(c => c.classList.remove('selected'));

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
