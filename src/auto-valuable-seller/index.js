// Entry point for auto-valuable-seller.
// Thin listener that dispatches to search, seller, and maintenance modes.

import { log, running, setRunning, setMode, signalDone } from './state.js';
import { runSearch } from './search-mode.js';
import { runSeller } from './seller-mode.js';
import { forceMaintenanceBatch } from './maintenance.js';

window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    if (event.data && event.data.type === 'COR3_VALUABLE_START_SEARCH') {
        if (running) {
            log('Already running \u2014 ignoring start request', 'warn');
            return;
        }
        setRunning(true);
        setMode('search');
        runSearch().catch(function (err) {
            if (err.message !== 'Stopped') log('Search error: ' + err.message, 'error');
            signalDone();
        });
    }

    if (event.data && event.data.type === 'COR3_VALUABLE_START_SELLER') {
        if (running) {
            log('Already running \u2014 ignoring start request', 'warn');
            return;
        }
        setRunning(true);
        setMode('seller');
        var sServers = event.data.selectedServers || [];
        var sDownloads = event.data.selectedDownloads || [];
        runSeller(sServers, sDownloads).catch(function (err) {
            if (err.message !== 'Stopped') log('Seller error: ' + err.message, 'error');
            signalDone();
        });
    }

    if (event.data && event.data.type === 'COR3_VALUABLE_STOP') {
        if (running) {
            log('Stopping...', 'warn');
            setRunning(false);
        }
    }

    if (event.data && event.data.type === 'COR3_VALUABLE_FORCE_MAINTENANCE_BATCH') {
        var fmServers = event.data.servers;
        if (fmServers && fmServers.length > 0) {
            forceMaintenanceBatch(fmServers);
        }
    }
});

log('Auto Valuable Seller engine loaded', 'info');
