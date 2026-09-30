import { getCor3Tab, bgAutoJobLog } from './helpers.js';
import { MARKET_IDS, LOG_JOB_TYPES } from '../shared/server-constants.js';
import { FALLBACK_PATH_MAP, FALLBACK_SERVER_PRIORITY } from '../shared/server-map.js';

const SUPPORTED_JOB_TYPES_BG = [
    'File Decryption', 'IP Injection', 'Data Download', 'Log Deletion',
    'Log Download', 'Decrypt & Extract', 'File Elimination', 'Data Upload', 'IP Cleanup'
];

function isJobBuggedBg(job) {
    const sn = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : (job.serverName || '');
    return sn === 'D4RK RM7CE' && LOG_JOB_TYPES.includes(job.name);
}

const SERVER_PATH_MAP = FALLBACK_PATH_MAP;

function resolveRecentJobMarketBg(recentJob, fallbackKey, marketData, darkMarketData, soyuzMarketData, usolMarketData) {
    if (recentJob.marketId) {
        for (const [key, id] of Object.entries(MARKET_IDS)) {
            if (id === recentJob.marketId) return key;
        }
    }
    const jobId = recentJob.id;
    for (const [key, md] of [['home', marketData], ['dark', darkMarketData], ['soyuz', soyuzMarketData], ['usol', usolMarketData]]) {
        if (md && md.jobs) {
            if (md.jobs.find(j => j.id === jobId)) return key;
        }
    }
    return fallbackKey;
}

export function collectJobsBg(marketData, darkMarketData, completedResults, serverMaintenanceMap, soyuzMarketData, usolMarketData) {
    const SERVER_PRIORITY = FALLBACK_SERVER_PRIORITY;
    const JOB_TYPE_PRIORITY = ['IP Injection', 'IP Cleanup', 'Data Upload', 'Data Download', 'Log Deletion', 'Log Download', 'File Elimination', 'File Decryption', 'Decrypt & Extract'];
    const maint = serverMaintenanceMap || {};
    const now = Date.now();
    const skipIds = new Set();
    if (completedResults && completedResults.length > 0) {
        for (const cr of completedResults) {
            if (cr.status === 'failed' || cr.status === 'bugged' || cr.status === 'skipped') {
                skipIds.add(cr.jobId);
            }
        }
    }
    function getPathBlocker(serverName) {
        const path = SERVER_PATH_MAP[serverName];
        if (!path) return { blocked: false };
        for (const srv of path) {
            const info = maint[srv.id];
            if (info && info.isInMaintenance) {
                if (!info.maintenanceEndsAt || new Date(info.maintenanceEndsAt).getTime() > now) {
                    return { blocked: true, blockerName: srv.name, blockerId: srv.id, maintenanceEndsAt: info.maintenanceEndsAt || null };
                }
            }
        }
        return { blocked: false };
    }
    function getServerId(job) {
        return (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].id
            : (job.conditions && job.conditions.serverConfigId) ? job.conditions.serverConfigId : null;
    }
    const jobs = [];
    const skippedMaintenance = [];
    const seenTakenIds = new Set();
    for (const marketKey of ['dark', 'home', 'soyuz', 'usol']) {
        const md = marketKey === 'home' ? marketData : marketKey === 'dark' ? darkMarketData : marketKey === 'usol' ? usolMarketData : soyuzMarketData;
        if (!md) continue;
        const openJobs = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES_BG.includes(j.name) && !isJobBuggedBg(j) && !skipIds.has(j.id));
        const takenJobs = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES_BG.includes(j.name) && !isJobBuggedBg(j) && !skipIds.has(j.id));
        for (const job of openJobs) {
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = getServerId(job);
            const blocker = getPathBlocker(serverName);
            if (blocker.blocked) {
                skippedMaintenance.push({ serverName, serverId, blockerName: blocker.blockerName, blockerId: blocker.blockerId, maintenanceEndsAt: blocker.maintenanceEndsAt });
                continue;
            }
            jobs.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[marketKey], marketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: false, canComplete: false, status: 'pending'
            });
        }
        for (const job of takenJobs) {
            if (seenTakenIds.has(job.id)) continue;
            seenTakenIds.add(job.id);
            const trueMarketKey = resolveRecentJobMarketBg(job, marketKey, marketData, darkMarketData, soyuzMarketData, usolMarketData);
            const serverName = (job.relatedServers && job.relatedServers[0]) ? job.relatedServers[0].serverName : 'None';
            const serverId = getServerId(job);
            const blocker = getPathBlocker(serverName);
            if (blocker.blocked) {
                skippedMaintenance.push({ serverName, serverId, blockerName: blocker.blockerName, blockerId: blocker.blockerId, maintenanceEndsAt: blocker.maintenanceEndsAt });
                continue;
            }
            jobs.push({
                jobId: job.id, name: job.name, type: job.name, serverName, serverId,
                marketId: MARKET_IDS[trueMarketKey], marketKey: trueMarketKey,
                rewardCredits: job.rewardCredits, rewardReputation: job.rewardReputation,
                deposit: job.deposit || 0,
                conditions: job.conditions ? job.conditions.items || job.conditions : [],
                alreadyTaken: true, canComplete: !!job.canComplete, status: 'pending'
            });
        }
    }
    jobs.sort((a, b) => {
        const idxA = SERVER_PRIORITY.indexOf(a.serverName);
        const idxB = SERVER_PRIORITY.indexOf(b.serverName);
        const spA = (a.serverName === 'None' || !a.serverName) ? -1 : (idxA >= 0 ? idxA : SERVER_PRIORITY.length);
        const spB = (b.serverName === 'None' || !b.serverName) ? -1 : (idxB >= 0 ? idxB : SERVER_PRIORITY.length);
        const sp = spA - spB;
        if (sp !== 0) return sp;
        const tpA = JOB_TYPE_PRIORITY.indexOf(a.name);
        const tpB = JOB_TYPE_PRIORITY.indexOf(b.name);
        return (tpA >= 0 ? tpA : JOB_TYPE_PRIORITY.length) - (tpB >= 0 ? tpB : JOB_TYPE_PRIORITY.length);
    });
    jobs._skippedMaintenance = skippedMaintenance;
    return jobs;
}

let _scheduleAutoFinishDebounceTimer = null;
export function scheduleAutoFinishAllBgDebounced() {
    if (_scheduleAutoFinishDebounceTimer) clearTimeout(_scheduleAutoFinishDebounceTimer);
    _scheduleAutoFinishDebounceTimer = setTimeout(() => {
        _scheduleAutoFinishDebounceTimer = null;
        scheduleAutoFinishAllBg();
    }, 2000);
}

export async function scheduleAutoFinishAllBg() {
    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
    if (!settings.autoFinishAllJobsEnabled) {
        await chrome.alarms.clear('autoFinishAllJobs');
        return;
    }

    const { marketData, darkMarketData, soyuzMarketData, usolMarketData, autoJobsRunning, serverMaintenanceMap } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData', 'autoJobsRunning', 'serverMaintenanceMap']);

    if (autoJobsRunning) {
        return;
    }

    const { autoJobsCompletedResults: crSched } = await chrome.storage.local.get('autoJobsCompletedResults');
    const availableNow = collectJobsBg(marketData, darkMarketData, crSched || [], serverMaintenanceMap, soyuzMarketData, usolMarketData);
    if (availableNow.length > 0) {
        bgAutoJobLog('🔄 Auto Finish All: jobs available now — starting in 10s');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 10 / 60 });
        return;
    }

    let minWaitMs = Infinity;
    const now = Date.now();
    let scheduledReason = '';

    for (const md of [marketData, darkMarketData, soyuzMarketData, usolMarketData]) {
        if (md && md.nextJobsResetAt) {
            const diff = new Date(md.nextJobsResetAt).getTime() - now;
            if (diff > 0 && diff < minWaitMs) {
                minWaitMs = diff;
                scheduledReason = 'job reset';
            }
        }
    }

    const skipped = availableNow._skippedMaintenance || [];
    if (skipped.length > 0) {
        const seenBlockerIds = new Set();
        for (const s of skipped) {
            if (seenBlockerIds.has(s.blockerId)) continue;
            seenBlockerIds.add(s.blockerId);
            if (s.maintenanceEndsAt) {
                const diff = new Date(s.maintenanceEndsAt).getTime() + 3 * 60 * 1000 - now;
                if (diff > 0 && diff < minWaitMs) {
                    minWaitMs = diff;
                    scheduledReason = `${s.blockerName} maintenance end (+3m buffer)`;
                }
            }
        }
        const blockedPairs = [...new Set(skipped.map(s =>
            s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
        ))].join(', ');
        bgAutoJobLog(`🔄 Auto Finish All: skipped jobs due to maintenance: ${blockedPairs}`, 'warn');
    }

    const skippedFromResults = (crSched || []).filter(cr => cr.status === 'skipped');
    if (skippedFromResults.length > 0) {
        let hasEndTimeInfo = false;
        for (const sr of skippedFromResults) {
            if (sr.maintenanceEndsAt) {
                hasEndTimeInfo = true;
                const diff = new Date(sr.maintenanceEndsAt).getTime() + 3 * 60 * 1000 - now;
                if (diff > 0 && diff < minWaitMs) {
                    minWaitMs = diff;
                    scheduledReason = `maintenance end (${sr.serverName || 'unknown server'}) (+3m buffer)`;
                } else if (diff <= 0 && minWaitMs === Infinity) {
                    minWaitMs = 30 * 1000;
                    scheduledReason = `maintenance ended (${sr.serverName || 'unknown server'}) — rechecking`;
                }
            }
        }
        if (!hasEndTimeInfo && minWaitMs === Infinity) {
            minWaitMs = 10 * 60 * 1000;
            scheduledReason = 'maintenance fallback (no end time known)';
            bgAutoJobLog(`🔄 Auto Finish All: ${skippedFromResults.length} job(s) skipped (maintenance) with unknown end time — waiting 10m`, 'warn');
        }
        for (const sr of skippedFromResults) {
            if (sr.lockExpiresAt) {
                const diff = new Date(sr.lockExpiresAt).getTime() - now;
                if (diff > 0 && diff < minWaitMs) {
                    minWaitMs = diff;
                    scheduledReason = `minigame lock expires (${sr.name || sr.serverName || 'unknown'})`;
                }
            }
        }
    }

    if (minWaitMs < Infinity) {
        const waitMs = minWaitMs + 15000;
        const mins = Math.max(waitMs / 60000, 0.25);
        bgAutoJobLog(`🔄 Auto Finish All: next run scheduled in ${Math.floor(waitMs / 60000)}m ${Math.floor((waitMs % 60000) / 1000)}s (${scheduledReason})`);
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: mins });
    } else {
        bgAutoJobLog('🔄 Auto Finish All: no reset timer found — checking again in 5m');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 5 });
    }
}

export async function runAutoFinishAllBg() {
    const settings = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
    if (!settings.autoFinishAllJobsEnabled) return;

    const { autoJobsRunning } = await chrome.storage.local.get('autoJobsRunning');
    if (autoJobsRunning) {
        return;
    }

    const tab = await getCor3Tab();
    if (!tab) {
        bgAutoJobLog('🔄 Auto Finish All: no cor3.gg tab found — retrying in 1m', 'warn');
        await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: 1 });
        return;
    }

    // Wait for initial page load fetch to complete before refreshing markets
    let fetchWaitAttempts = 0;
    while (fetchWaitAttempts < 24) {
        const { initialFetchDoneAt } = await chrome.storage.local.get('initialFetchDoneAt');
        if (initialFetchDoneAt) break;
        fetchWaitAttempts++;
        if (fetchWaitAttempts === 1) bgAutoJobLog('🔄 Auto Finish All: waiting for initial page load to complete...');
        await new Promise(r => setTimeout(r, 5000));
    }
    if (fetchWaitAttempts >= 24) {
        bgAutoJobLog('🔄 Auto Finish All: initial page load not complete after 120s — proceeding anyway', 'warn');
    }

    const { autoJobsCompletedResults: crPre } = await chrome.storage.local.get('autoJobsCompletedResults');
    if (Array.isArray(crPre) && crPre.some(cr => cr.status === 'skipped')) {
        const cleared = crPre.filter(cr => cr.status !== 'skipped');
        await chrome.storage.local.set({ autoJobsCompletedResults: cleared });
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        const runCheck = await chrome.storage.local.get('autoJobsRunning');
        if (runCheck.autoJobsRunning) return;

        const { marketData: mdCheck, darkMarketData: dmdCheck, soyuzMarketData: smdCheck, usolMarketData: umdCheck } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData']);
        const nowCheck = Date.now();
        const expiredMarkets = [];
        if (!mdCheck || !mdCheck.nextJobsResetAt || new Date(mdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('home');
        if (!dmdCheck || !dmdCheck.nextJobsResetAt || new Date(dmdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('dark');
        if (!smdCheck || !smdCheck.nextJobsResetAt || new Date(smdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('soyuz');
        if (!umdCheck || !umdCheck.nextJobsResetAt || new Date(umdCheck.nextJobsResetAt).getTime() <= nowCheck) expiredMarkets.push('usol');

        const refreshOrder = [];
        if (expiredMarkets.includes('usol')) refreshOrder.push('usol');
        if (expiredMarkets.includes('soyuz')) refreshOrder.push('soyuz');
        if (expiredMarkets.includes('dark')) refreshOrder.push('dark');
        if (expiredMarkets.includes('home')) refreshOrder.push('home');

        bgAutoJobLog(`🔄 Auto Finish All: refreshing ${refreshOrder.length > 0 ? refreshOrder.join(', ') : 'all'} market data (attempt ${attempt}/3)...`);
        try {
            const refreshMsg = { action: "refreshAllMarketsSeq", skipLots: true };
            if (refreshOrder.length > 0) refreshMsg.order = refreshOrder;
            await chrome.tabs.sendMessage(tab.id, refreshMsg);
        } catch (e) {
            bgAutoJobLog('🔄 Auto Finish All: failed to refresh markets — ' + (e.message || e), 'error');
            cor3LogError('background.js', e, { action: 'autoFinishAll-refreshMarkets' });
            scheduleAutoFinishAllBg();
            return;
        }

        await new Promise(r => {
            let done = false;
            const listener = (changes, area) => {
                if (area === 'local' && changes._allMarketsRefreshed) {
                    done = true;
                    chrome.storage.onChanged.removeListener(listener);
                    clearTimeout(tmr);
                    r();
                }
            };
            chrome.storage.onChanged.addListener(listener);
            const tmr = setTimeout(() => {
                if (!done) {
                    chrome.storage.onChanged.removeListener(listener);
                    r();
                }
            }, 30000);
        });

        const { marketData, darkMarketData, soyuzMarketData, usolMarketData, autoJobsCompletedResults: crRun, serverMaintenanceMap } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData', 'autoJobsCompletedResults', 'serverMaintenanceMap']);
        const jobsToRun = collectJobsBg(marketData, darkMarketData, crRun || [], serverMaintenanceMap, soyuzMarketData, usolMarketData);

        if (jobsToRun.length > 0) {
            const skippedList = jobsToRun._skippedMaintenance || [];
            if (skippedList.length > 0) {
                const blockedPairs = [...new Set(skippedList.map(s =>
                    s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
                ))].join(', ');
                bgAutoJobLog(`🔄 Auto Finish All: skipped ${skippedList.length} job(s) due to maintenance: ${blockedPairs}`, 'warn');
            }
            bgAutoJobLog(`🔄 Auto Finish All: starting ${jobsToRun.length} job(s)`);
            const { autoJobsTracker: existingTracker } = await chrome.storage.local.get('autoJobsTracker');
            const newJobIds = new Set(jobsToRun.map(j => j.jobId));
            const previousJobs = (existingTracker || []).filter(j =>
                !newJobIds.has(j.jobId) && (j.status === 'done' || j.status === 'failed' || j.status === 'skipped' || j.status === 'bugged')
            );
            const mergedTracker = [...previousJobs, ...jobsToRun];
            await chrome.storage.local.set({ autoJobsRunning: true, autoJobsQueue: jobsToRun, autoJobsTracker: mergedTracker });
            try {
                await chrome.tabs.sendMessage(tab.id, { action: "startAutoJobs", jobs: jobsToRun });
            } catch (e) {
                bgAutoJobLog('🔄 Auto Finish All: failed to start — ' + (e.message || e), 'error');
                cor3LogError('background.js', e, { action: 'autoFinishAll-startJobs' });
                await chrome.storage.local.set({ autoJobsRunning: false });
            }
            return;
        }

        const allUnfiltered = [];
        const seenUnfilteredIds = new Set();
        for (const md of [marketData, darkMarketData, soyuzMarketData, usolMarketData]) {
            if (!md) continue;
            const open = (md.jobs || []).filter(j => !j.isCompleted && !j.isExpired && SUPPORTED_JOB_TYPES_BG.includes(j.name));
            const taken = (md.recentJobs || []).filter(j => j.status === 'TAKEN' && SUPPORTED_JOB_TYPES_BG.includes(j.name) && !seenUnfilteredIds.has(j.id));
            allUnfiltered.push(...open);
            for (const j of taken) { seenUnfilteredIds.add(j.id); allUnfiltered.push(j); }
        }
        if (allUnfiltered.length > 0) {
            const skipped = jobsToRun._skippedMaintenance || [];
            if (skipped.length > 0) {
                const blockedPairs = [...new Set(skipped.map(s =>
                    s.blockerName === s.serverName ? s.serverName : `${s.serverName} (blocked by ${s.blockerName})`
                ))].join(', ');
                bgAutoJobLog(`🔄 Auto Finish All: remaining jobs blocked by maintenance: ${blockedPairs} — scheduling at maintenance end or reset.`, 'warn');
            } else {
                bgAutoJobLog('🔄 Auto Finish All: only bugged/failed jobs remain — waiting for next reset.', 'warn');
            }
            scheduleAutoFinishAllBg();
            return;
        }

        if (attempt < 3) {
            const { marketData: mdTimerCheck, darkMarketData: dmdTimerCheck, soyuzMarketData: smdTimerCheck, usolMarketData: umdTimerCheck } = await chrome.storage.local.get(['marketData', 'darkMarketData', 'soyuzMarketData', 'usolMarketData']);
            const nowTimerCheck = Date.now();
            let allFuture = true;
            let earliestResetMs = Infinity;
            for (const md of [mdTimerCheck, dmdTimerCheck, smdTimerCheck, umdTimerCheck]) {
                if (!md || !md.nextJobsResetAt) { allFuture = false; break; }
                const resetMs = new Date(md.nextJobsResetAt).getTime();
                if (resetMs <= nowTimerCheck) { allFuture = false; break; }
                if (resetMs < earliestResetMs) earliestResetMs = resetMs;
            }
            if (allFuture && earliestResetMs < Infinity) {
                const waitMs = earliestResetMs - nowTimerCheck + 15000;
                const mins = Math.max(waitMs / 60000, 0.25);
                bgAutoJobLog(`🔄 Auto Finish All: all markets have future reset timers — scheduling next run in ${Math.floor(waitMs / 60000)}m ${Math.floor((waitMs % 60000) / 1000)}s`);
                await chrome.alarms.create('autoFinishAllJobs', { delayInMinutes: mins });
                return;
            }

            bgAutoJobLog(`🔄 Auto Finish All: no jobs found yet, retrying in 60s (attempt ${attempt}/3)...`, 'warn');
            await new Promise(r => setTimeout(r, 60000));
            const recheck = await chrome.storage.sync.get('autoFinishAllJobsEnabled');
            if (!recheck.autoFinishAllJobsEnabled) return;
        }
    }

    bgAutoJobLog('🔄 Auto Finish All: no jobs found after 3 attempts — scheduling next check at reset');
    scheduleAutoFinishAllBg();
}
