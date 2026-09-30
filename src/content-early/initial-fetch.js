// Initial data fetch orchestration on page load / reconnect
import { humanDelay } from './ws-send.js';

// Auto-fetch all data on page load (called when WS opens)
var initialFetchDone = false;
window.__cor3ResetInitialFetch = function () {
    initialFetchDone = false;
    console.log('[COR3 Helper] Reset initial fetch flag for reconnect');
};
// Flag: initial merc fetch complete (markets + mercs all done)
window.__cor3InitialMercsFetchDone = false;

window.__cor3InitialFetch = function () {
    if (initialFetchDone) return;
    initialFetchDone = true;
    window.__cor3InitialMercsFetchDone = false;
    window.__cor3InitialFetchInProgress = true;
    console.log('[COR3 Helper] Running initial data fetch (page load)');

    // Trigger daily ops fetch via content script
    window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');

    // Follow Refresh All order:
    // 1. Markets sequentially: HOME → D4RK → SOYUZ → USOL
    // 2. Expedition data (server auto-provides via room join — no explicit request needed)
    // 3. Stash (inventory)
    // 4. CORE mercs → USOL mercs
    // 5. Archived expeditions
    // 6. Loadout
    // 7. Updater
    window.__cor3RequestMarket(function () {
        console.log('[COR3 Helper] Initial: HOME done, starting D4RK');
        window.__cor3RequestDarkMarket(function () {
            console.log('[COR3 Helper] Initial: D4RK done, starting SOYUZ');
            window.__cor3RequestSoyuzMarket(function () {
                console.log('[COR3 Helper] Initial: SOYUZ done, starting USOL');
                window.__cor3RequestUsolMarket(function () {
                    console.log('[COR3 Helper] Initial: All markets fetched');
                    // Expedition data already received from server room join — no request needed
                    // Notify content script that expedition data can be rendered
                    window.postMessage({ type: 'COR3_WS_EXPEDITIONS_READY' }, '*');
                    // Fetch stash (inventory)
                    setTimeout(function () {
                        window.__cor3RequestStash();
                    }, humanDelay());
                    // Fetch specialists data (stash expansion timers) after stash
                    setTimeout(function () {
                        window.__cor3RequestSpecialists();
                    }, humanDelay() + 500);
                    // CORE mercs after stash
                    setTimeout(function () {
                        console.log('[COR3 Helper] Initial: Starting CORE mercs');
                        window.__cor3RequestMercenaries(null, function () {
                            window.postMessage({ type: 'COR3_CORE_MERCS_DONE' }, '*');
                            console.log('[COR3 Helper] Initial: CORE mercs done, starting USOL mercs');
                            // USOL mercs after CORE done
                            setTimeout(function () {
                                window.__cor3RequestUsolMercenaries(function () {
                                    window.postMessage({ type: 'COR3_USOL_MERCS_DONE' }, '*');
                                    window.__cor3InitialMercsFetchDone = true;
                                    console.log('[COR3 Helper] Initial: All mercs done');
                                    // Archived expeditions after mercs
                                    setTimeout(function () {
                                        window.__cor3RequestArchivedExpeditions();
                                    }, humanDelay());
                                    // Loadout after archived
                                    setTimeout(function () {
                                        window.__cor3RequestLoadout();
                                    }, 2000);
                                    // Updater
                                    setTimeout(function () {
                                        window.__cor3RequestUpdater();
                                        window.__cor3InitialFetchInProgress = false;
                                        console.log('[COR3 Helper] Initial data fetch complete');
                                        window.postMessage({ type: 'COR3_INITIAL_FETCH_DONE' }, '*');
                                    }, 3500);
                                });
                            }, humanDelay());
                        });
                    }, 2500);
                });
            });
        });
    });
};

window.__cor3KeepAlive = function () {
    console.log('[COR3 Helper] Keeping service worker alive!');
};
