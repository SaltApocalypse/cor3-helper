// --- Modifier edit/save/cancel/toggle ---
import { renderDecisions, checkAutoChoose, setModifiers, updateModifierDisplayValues } from './expeditions.js';

const lootModInput = document.getElementById('lootModifier');
const riskModInput = document.getElementById('riskModifier');
const autoChooseCheckbox = document.getElementById('autoChooseCheckbox');
const noWaitAutoChooseCheckbox = document.getElementById('noWaitAutoChooseCheckbox');
const noWaitRow = document.getElementById('noWaitRow');
const editModifiersBtn = document.getElementById('editModifiersBtn');
const saveModifiersBtn = document.getElementById('saveModifiersBtn');
const cancelModifiersBtn = document.getElementById('cancelModifiersBtn');
const modifierEditRow = document.getElementById('modifierEditRow');
const modifierDisplay = document.getElementById('modifierDisplay');
const modifiersEnabledToggle = document.getElementById('modifiersEnabledToggle');
const getRidOfVeteransToggle = document.getElementById('getRidOfVeteransToggle');

let savedLootMod = 1;
let savedRiskMod = -5;
let modifiersEnabled = true;

function syncModifiers() {
    setModifiers(modifiersEnabled, savedLootMod, savedRiskMod);
}

export function reRenderDecisions() {
    chrome.storage.local.get('expeditionDecisions', (result) => {
        renderDecisions(result.expeditionDecisions || []);
    });
}

function saveDecisionModifiers() {
    chrome.storage.sync.set({
        decisionModifiers: {
            loot: savedLootMod,
            risk: savedRiskMod,
            enabled: modifiersEnabled,
            autoChoose: autoChooseCheckbox.checked,
            noWaitAutoChoose: noWaitAutoChooseCheckbox ? noWaitAutoChooseCheckbox.checked : false,
            getRidOfVeterans: getRidOfVeteransToggle ? getRidOfVeteransToggle.checked : false
        }
    });
}

editModifiersBtn.addEventListener('click', () => {
    lootModInput.value = savedLootMod;
    riskModInput.value = savedRiskMod;
    modifierEditRow.style.display = '';
    modifierDisplay.style.display = 'none';
});

saveModifiersBtn.addEventListener('click', () => {
    savedLootMod = parseInt(lootModInput.value) || 3;
    savedRiskMod = parseInt(riskModInput.value) || -2;
    modifierEditRow.style.display = 'none';
    modifierDisplay.style.display = '';
    syncModifiers();
    updateModifierDisplayValues();
    saveDecisionModifiers();
    reRenderDecisions();
});

cancelModifiersBtn.addEventListener('click', () => {
    modifierEditRow.style.display = 'none';
    modifierDisplay.style.display = '';
});

modifiersEnabledToggle.addEventListener('change', () => {
    modifiersEnabled = modifiersEnabledToggle.checked;
    syncModifiers();
    saveDecisionModifiers();
    reRenderDecisions();
});

autoChooseCheckbox.addEventListener('change', () => {
    if (noWaitRow) noWaitRow.style.display = autoChooseCheckbox.checked ? '' : 'none';
    saveDecisionModifiers();
    reRenderDecisions();
});

if (noWaitAutoChooseCheckbox) {
    noWaitAutoChooseCheckbox.addEventListener('change', () => {
        saveDecisionModifiers();
        if (autoChooseCheckbox.checked && noWaitAutoChooseCheckbox.checked) {
            chrome.storage.local.get('expeditionDecisions', (result) => {
                checkAutoChoose(result.expeditionDecisions || []);
            });
        }
    });
}

if (getRidOfVeteransToggle) {
    getRidOfVeteransToggle.addEventListener('change', () => {
        saveDecisionModifiers();
        reRenderDecisions();
    });
}

chrome.storage.sync.get('decisionModifiers', (data) => {
    if (data.decisionModifiers) {
        savedLootMod = data.decisionModifiers.loot ?? 1;
        savedRiskMod = data.decisionModifiers.risk ?? -5;
        modifiersEnabled = data.decisionModifiers.enabled !== false;
        autoChooseCheckbox.checked = !!data.decisionModifiers.autoChoose;
        if (noWaitAutoChooseCheckbox) noWaitAutoChooseCheckbox.checked = !!data.decisionModifiers.noWaitAutoChoose;
        if (getRidOfVeteransToggle) getRidOfVeteransToggle.checked = !!data.decisionModifiers.getRidOfVeterans;
        if (noWaitRow) noWaitRow.style.display = autoChooseCheckbox.checked ? '' : 'none';
    }
    modifiersEnabledToggle.checked = modifiersEnabled;
    syncModifiers();
    updateModifierDisplayValues();
    reRenderDecisions();
});
