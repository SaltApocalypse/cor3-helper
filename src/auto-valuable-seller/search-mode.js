// Search mode for auto-valuable-seller.
// Scans all reachable servers for valuable files/logs,
// then scans downloads folder.

import {
    log, delay, sendCmd, waitForEvent, humanDelay,
    running,
    setCachedMapData,
    _lastServersData, setLastServersData,
    ALL_SERVERS, SERVER_PATH_MAP,
    updateServersUI, updateDownloadsUI, signalDone
} from './state.js';

import { ensureServerAccess } from './server-access.js';
import { getServerFiles, getServerLogs, filterValuableFiles, filterValuableLogs, getDownloadsFolder, getFileAnalysis } from './operations.js';
import { fetchMaintenanceData } from './maintenance.js';

export async function runSearch() {
    log('=== Valuable Search Started ===', 'info');
    setCachedMapData(null);

    var serversData = { servers: [] };
    setLastServersData(serversData);
    var downloadsData = { files: [] };

    // Step 1: Get network map to discover all hackable servers
    log('Fetching network map...');
    sendCmd('get.map', {});
    var mapServers = [];
    try {
        var mapData = await waitForEvent('COR3_WS_NETWORK_MAP', 10000);
        setCachedMapData(mapData);
        if (mapData && mapData.servers) {
            for (var sid in mapData.servers) {
                var sInfo = mapData.servers[sid];
                var sName = ALL_SERVERS[sid];
                if (sName && !sInfo.isInMaintenance) {
                    mapServers.push({ id: sid, name: sName, isAccessible: sInfo.isAccessible || false });
                }
            }
        }
    } catch (e) {
        log('Network map timeout \u2014 using hardcoded server list', 'warn');
        for (var sId in ALL_SERVERS) {
            mapServers.push({ id: sId, name: ALL_SERVERS[sId], isAccessible: false });
        }
    }

    // Sort servers furthest-first (longer path = further) to reduce maintenance risk on closer servers
    mapServers.sort(function (a, b) {
        var pathA = SERVER_PATH_MAP[a.name] || [];
        var pathB = SERVER_PATH_MAP[b.name] || [];
        return pathB.length - pathA.length;
    });

    log('Found ' + mapServers.length + ' reachable servers to scan (furthest first)');

    // Step 2: Scan each server for valuable files/logs
    for (var i = 0; i < mapServers.length; i++) {
        if (!running) { log('Search stopped by user.', 'warn'); break; }

        var server = mapServers[i];
        log('Scanning server ' + (i + 1) + '/' + mapServers.length + ': ' + server.name);

        var serverEntry = {
            id: server.id,
            name: server.name,
            status: 'OPEN',
            files: [],
            logs: [],
            selected: false
        };

        // Ensure access
        if (!await ensureServerAccess(server.id)) {
            log(server.name + ': skipping (no access)', 'warn');
            serverEntry.status = 'SKIPPED';
            serversData.servers.push(serverEntry);
            updateServersUI(serversData);
            continue;
        }

        await delay(humanDelay());

        // Get files
        var files = await getServerFiles(server.id);
        var valuableFiles = filterValuableFiles(files);
        for (var fi = 0; fi < valuableFiles.length; fi++) {
            var f = valuableFiles[fi];
            var tags = (f.tags || []).map(function (t) {
                return typeof t === 'string' ? { key: t, label: t } : t;
            });
            serverEntry.files.push({
                fileId: f.fileId,
                name: f.name,
                basePrice: f.basePrice,
                detectRate: f.detectRate,
                tags: tags
            });
        }

        await delay(humanDelay());

        // Get logs
        var logs = await getServerLogs(server.id);
        var valuableLogs = filterValuableLogs(logs);
        for (var li = 0; li < valuableLogs.length; li++) {
            var l = valuableLogs[li];
            var ltags = (l.tags || []).map(function (t) {
                return typeof t === 'string' ? { key: t, label: t } : t;
            });
            serverEntry.logs.push({
                seq: l.seq,
                message: l.message,
                basePrice: l.basePrice,
                detectRate: l.detectRate,
                tags: ltags
            });
        }

        var total = serverEntry.files.length + serverEntry.logs.length;
        if (total > 0) {
            serverEntry.status = 'OPEN';
            log(server.name + ': found ' + serverEntry.files.length + ' valuable file(s), ' + serverEntry.logs.length + ' valuable log(s)', 'success');
        } else {
            serverEntry.status = 'DONE';
            log(server.name + ': no valuables found');
            serverEntry.selected = false;
        }

        serversData.servers.push(serverEntry);
        updateServersUI(serversData);
        await delay(humanDelay());
    }

    // Step 3: Scan downloads folder for valuable files
    if (running) {
        log('Scanning downloads folder...');
        var dlFiles = await getDownloadsFolder();
        var valuableDlFiles = dlFiles.filter(function (f) { return f.isValuable; });

        for (var di = 0; di < valuableDlFiles.length; di++) {
            if (!running) break;
            var dlFile = valuableDlFiles[di];
            log('Analyzing download: ' + dlFile.name);

            var analysis = await getFileAnalysis(dlFile.id);
            var dlTags = [];
            var dlSource = '\u2014';
            if (analysis) {
                dlTags = (analysis.tags || []).map(function (t) {
                    return typeof t === 'string' ? { key: t, label: t } : t;
                });
                dlSource = analysis.source || '\u2014';
            }

            if (dlTags.length === 0) {
                continue;
            }

            downloadsData.files.push({
                id: dlFile.id,
                name: dlFile.name,
                source: dlSource,
                tags: dlTags,
                status: 'OPEN',
                selected: false
            });

            updateDownloadsUI(downloadsData);
            await delay(humanDelay());
        }

        log('Downloads folder: found ' + downloadsData.files.length + ' valuable file(s)', 'success');
    }

    await fetchMaintenanceData();
    log('=== Valuable Search Complete ===', 'success');
    signalDone();
}
