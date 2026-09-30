// Auto Job Solver — thin entry point.
// Imports all submodules so esbuild bundles them into a single IIFE.

import { state, sendCmd, log } from './state.js';
import { processQueue } from './main-loop.js';

(function () {
    // ---- Listen for start/stop commands ----
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        if (event.data && event.data.type === 'COR3_AUTOJOB_START') {
            state.jobQueue = event.data.jobs || [];
            state.solverSettings = event.data.settings || {};
            processQueue();
        }

        if (event.data && event.data.type === 'COR3_AUTOJOB_STOP') {
            state.abortFlag = true;
            log('Stop signal received — aborting after current step', 'warn');
        }
    });

    console.log('[COR3 Helper] Auto Job Solver engine loaded');
})();
