// Solver injection/stop — decrypt, ICE wall, simple decrypt, daily hack

// --- Auto Decrypt Solver ---
let decryptSolverInjected = false;

export function injectDecryptSolver() {
    if (decryptSolverInjected) {
        window.postMessage({ type: 'COR3_START_DECRYPT_SOLVER' }, '*');
        return;
    }
    decryptSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('decrypt-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

export function stopDecryptSolver() {
    window.postMessage({ type: 'COR3_STOP_DECRYPT_SOLVER' }, '*');
    decryptSolverInjected = false;
}

// --- Auto Daily Hack Solver ---
let dailyHackInjected = false;

export function injectDailyHackSolver() {
    if (dailyHackInjected) {
        window.postMessage({ type: 'COR3_STOP_DAILY_HACK' }, '*');
        dailyHackInjected = false;
        setTimeout(() => injectDailyHackSolver(), 300);
        return;
    }
    dailyHackInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('daily-hack-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

export function stopDailyHackSolver() {
    window.postMessage({ type: 'COR3_STOP_DAILY_HACK' }, '*');
    dailyHackInjected = false;
}

// --- Auto ICE Wall Solver ---
let iceWallSolverInjected = false;

export function injectIceWallSolver() {
    if (iceWallSolverInjected) {
        window.postMessage({ type: 'COR3_START_ICE_WALL_SOLVER' }, '*');
        return;
    }
    iceWallSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('ice-wall-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

export function stopIceWallSolver() {
    window.postMessage({ type: 'COR3_STOP_ICE_WALL_SOLVER' }, '*');
    iceWallSolverInjected = false;
}

// --- Auto Simple Decrypt Solver ---
let simpleDecryptSolverInjected = false;

export function injectSimpleDecryptSolver() {
    if (simpleDecryptSolverInjected) {
        window.postMessage({ type: 'COR3_START_SIMPLE_DECRYPT_SOLVER' }, '*');
        return;
    }
    simpleDecryptSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('simple-decrypt-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
}

export function stopSimpleDecryptSolver() {
    window.postMessage({ type: 'COR3_STOP_SIMPLE_DECRYPT_SOLVER' }, '*');
    simpleDecryptSolverInjected = false;
}

// --- Auto Job Solver Engine Injection ---
let autoJobSolverInjected = false;

export function injectAutoJobSolver() {
    if (autoJobSolverInjected) return;
    autoJobSolverInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('auto-job-solver.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[COR3 Helper] Auto Job Solver engine injected');
}

// --- Auto Valuable Seller Engine Injection ---
let autoValuableSellerInjected = false;

export function injectAutoValuableSeller() {
    if (autoValuableSellerInjected) return;
    autoValuableSellerInjected = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('auto-valuable-seller.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
    console.log('[COR3 Helper] Auto Valuable Seller engine injected');
}

export function ensureAntiAfkEnabled() {
    window.postMessage({ type: 'COR3_ANTI_AFK_TOGGLE', enabled: true }, '*');
}

// Auto-start solvers if they were enabled before page load
chrome.storage.sync.get(['autoDecryptEnabled', 'autoIceWallEnabled', 'autoSimpleDecryptEnabled'], (data) => {
    if (data.autoDecryptEnabled) {
        injectDecryptSolver();
    }
    if (data.autoIceWallEnabled) {
        injectIceWallSolver();
    }
    if (data.autoSimpleDecryptEnabled) {
        injectSimpleDecryptSolver();
    }
});
