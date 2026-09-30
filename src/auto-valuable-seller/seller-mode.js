// Seller mode for auto-valuable-seller.
// Downloads valuable files/logs from selected servers,
// then sells at markets in priority order.

import {
    log, delay, humanDelay,
    running,
    setCachedMapData, clearDesktopToServerMap,
    _lastServersData, _fileAnalysisCache, _desktopToServerMap,
    MARKET_SELL_ORDER, SERVER_PATH_MAP,
    getServerName,
    updateServersUI, updateDownloadsUI, signalDone
} from './state.js';

import { ensureServerAccess, _sendSetEndpoint } from './server-access.js';
import { ensureSearchOnlyLoadout } from './loadout.js';
import {
    getServerFiles, getServerLogs,
    filterValuableFiles, filterValuableLogs,
    searchValuableFiles, searchValuableLogs,
    downloadFile, downloadLog,
    getDownloadsFolder, getFileAnalysis,
    getSellableItems, sellItems
} from './operations.js';
import { fetchMaintenanceData } from './maintenance.js';

export async function runSeller(selectedServers, selectedDownloads) {
    log('=== Valuable Seller Started ===', 'info');
    setCachedMapData(null);
    clearDesktopToServerMap();

    // Sort selected servers furthest-first (longer path = further) to reduce maintenance risk
    selectedServers = selectedServers.slice().sort(function (a, b) {
        var nameA = getServerName(a);
        var nameB = getServerName(b);
        var pathA = SERVER_PATH_MAP[nameA] || [];
        var pathB = SERVER_PATH_MAP[nameB] || [];
        return pathB.length - pathA.length;
    });

    log('Selected: ' + selectedServers.length + ' server(s), ' + selectedDownloads.length + ' download(s) (processing furthest first)');
    var _sellerDownloadsData = { files: [] };

    // Step 1: For selected servers, access + search-valuable + download
    for (var si = 0; si < selectedServers.length; si++) {
        if (!running) { log('Seller stopped by user.', 'warn'); break; }

        var serverId = selectedServers[si];
        var serverName = getServerName(serverId);
        log('Processing server ' + (si + 1) + '/' + selectedServers.length + ': ' + serverName);

        // Ensure access (hack loadout equipped internally if needed)
        if (!await ensureServerAccess(serverId)) {
            log(serverName + ': skipping (no access)', 'warn');
            continue;
        }

        await delay(humanDelay());

        // Check what the search phase found for this server to skip unnecessary calls
        var searchPhaseEntry = _lastServersData ? _lastServersData.servers.find(function (s) { return s.id === serverId; }) : null;
        var hasSearchFiles = !searchPhaseEntry || (searchPhaseEntry.files && searchPhaseEntry.files.length > 0);
        var hasSearchLogs = !searchPhaseEntry || (searchPhaseEntry.logs && searchPhaseEntry.logs.length > 0);

        // Only equip search loadout and search if there's something to find
        if (hasSearchFiles || hasSearchLogs) {
            await ensureSearchOnlyLoadout(serverId);
            await delay(humanDelay());
        }

        // Search for valuable files (skip if search phase found no files on this server)
        var detectedFileIds = {};
        if (hasSearchFiles) {
            log(serverName + ': searching for valuable files...');
            var fileSearchResult = await searchValuableFiles(serverId);
            if (fileSearchResult && fileSearchResult.found) {
                var valuableFound = fileSearchResult.found.filter(function (f) { return f.basePrice > 0; });
                for (var dfi = 0; dfi < valuableFound.length; dfi++) {
                    detectedFileIds[valuableFound[dfi].id] = true;
                }
                log(serverName + ': file search-valuable completed \u2014 detected ' + valuableFound.length + ' file(s)' + (valuableFound.length < fileSearchResult.found.length ? ' (' + (fileSearchResult.found.length - valuableFound.length) + ' skipped, basePrice=0)' : '') + ', searchPower used: ' + (fileSearchResult.searchPowerUsed || '?'), 'success');
            }
            await delay(humanDelay());
        } else {
            log(serverName + ': skipping file search-valuable (no valuable files found during scan)');
        }

        // Search for valuable logs (skip if search phase found no logs on this server)
        var detectedLogIds = {};
        if (hasSearchLogs) {
            log(serverName + ': searching for valuable logs...');
            var logSearchResult = await searchValuableLogs(serverId);
            if (logSearchResult && logSearchResult.found) {
                var valuableLogsFound = logSearchResult.found.filter(function (l) { return l.basePrice > 0; });
                for (var dli = 0; dli < valuableLogsFound.length; dli++) {
                    detectedLogIds[valuableLogsFound[dli].id] = true;
                }
                log(serverName + ': log search-valuable completed \u2014 detected ' + valuableLogsFound.length + ' log(s)' + (valuableLogsFound.length < logSearchResult.found.length ? ' (' + (logSearchResult.found.length - valuableLogsFound.length) + ' skipped, basePrice=0)' : ''), 'success');
            }
            await delay(humanDelay());
        } else {
            log(serverName + ': skipping log search-valuable (no valuable logs found during scan)');
        }

        // Re-fetch files from server
        var files = await getServerFiles(serverId);
        var valuableFiles = filterValuableFiles(files);

        // Filter to only files that were detected by search-valuable
        var hasFileFilter = Object.keys(detectedFileIds).length > 0;
        if (hasFileFilter) {
            var beforeCount = valuableFiles.length;
            valuableFiles = valuableFiles.filter(function (f) { return detectedFileIds[f.fileId || f.id]; });
            if (beforeCount !== valuableFiles.length) {
                log(serverName + ': filtered files: ' + valuableFiles.length + ' detected of ' + beforeCount + ' total valuable');
            }
        }

        // Update UI
        if (_lastServersData) {
            var srvEntry = _lastServersData.servers.find(function (s) { return s.id === serverId; });
            if (srvEntry) {
                srvEntry.files = valuableFiles.map(function (f) {
                    return { fileId: f.fileId || f.id, name: f.name, tags: f.tags || [], basePrice: f.basePrice || 0 };
                });
                updateServersUI(_lastServersData);
            }
        }

        // Download detected files only
        for (var fi = 0; fi < valuableFiles.length; fi++) {
            if (!running) break;
            var vf = valuableFiles[fi];
            var tagLabels = (vf.tags || []).map(function (t) { return typeof t === 'string' ? t : (t.label || t.key); }).join(', ');
            log(serverName + ': downloading file "' + vf.name + '" (tags: ' + tagLabels + ', price: ' + vf.basePrice + ')');
            var dlOk = await downloadFile(serverId, vf.fileId);
            if (dlOk) {
                log(serverName + ': file downloaded \u2713', 'success');
            } else {
                log(serverName + ': file download failed', 'error');
            }
            await delay(humanDelay());
        }

        // Re-fetch logs from server
        var logs = await getServerLogs(serverId);
        var valuableLogs = filterValuableLogs(logs);

        // Filter to only logs that were detected by search-valuable
        var hasLogFilter = Object.keys(detectedLogIds).length > 0;
        if (hasLogFilter) {
            var beforeLogCount = valuableLogs.length;
            valuableLogs = valuableLogs.filter(function (l) { return detectedLogIds[String(l.seq)]; });
            if (beforeLogCount !== valuableLogs.length) {
                log(serverName + ': filtered logs: ' + valuableLogs.length + ' detected of ' + beforeLogCount + ' total valuable');
            }
        }

        // Update UI
        if (_lastServersData) {
            var srvEntryLogs = _lastServersData.servers.find(function (s) { return s.id === serverId; });
            if (srvEntryLogs) {
                srvEntryLogs.logs = valuableLogs.map(function (l) {
                    return { seq: l.seq, message: l.message, tags: l.tags || [], basePrice: l.basePrice || 0 };
                });
                updateServersUI(_lastServersData);
            }
        }

        // Download detected logs only
        for (var li = 0; li < valuableLogs.length; li++) {
            if (!running) break;
            var vl = valuableLogs[li];
            var ltagLabels = (vl.tags || []).map(function (t) { return typeof t === 'string' ? t : (t.label || t.key); }).join(', ');
            log(serverName + ': downloading log "' + vl.message + '" (tags: ' + ltagLabels + ', price: ' + vl.basePrice + ')');
            var dlLogOk = await downloadLog(serverId, vl.seq);
            if (dlLogOk) {
                log(serverName + ': log downloaded \u2713', 'success');
            } else {
                log(serverName + ': log download failed', 'error');
            }
            await delay(humanDelay());
        }

        // Mark server as DOWNLOADED in UI
        if (_lastServersData) {
            var srvDone = _lastServersData.servers.find(function (s) { return s.id === serverId; });
            if (srvDone) {
                srvDone.status = 'DOWNLOADED';
                updateServersUI(_lastServersData);
            }
        }

        // Refresh downloads folder and update Downloads tab
        log(serverName + ': refreshing downloads folder...');
        await delay(500);
        var dlFiles = await getDownloadsFolder();
        var valuableDlFiles = dlFiles.filter(function (f) { return f.isValuable; });
        _sellerDownloadsData = { files: [] };
        for (var di = 0; di < valuableDlFiles.length; di++) {
            var dlFile = valuableDlFiles[di];
            var isCached = !!_fileAnalysisCache[dlFile.id];
            if (!isCached) await delay(300);
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
            _sellerDownloadsData.files.push({
                id: dlFile.id,
                name: dlFile.name,
                source: dlSource,
                tags: dlTags,
                status: 'OPEN',
                selected: false
            });
        }
        updateDownloadsUI(_sellerDownloadsData);
        log(serverName + ': downloads folder has ' + _sellerDownloadsData.files.length + ' valuable file(s)');

        log(serverName + ': done processing');
    }

    // Step 2: Sell items at markets in priority order
    var grandTotalCredits = 0;
    var grandTotalRep = 0;
    var grandTotalSold = 0;

    if (running) {
        log('--- Selling valuables at markets ---');

        for (var mi = 0; mi < MARKET_SELL_ORDER.length; mi++) {
            if (!running) break;

            var market = MARKET_SELL_ORDER[mi];
            log('Checking ' + market.name + ' market for sellable items...');

            // Set endpoint to market server before requesting sellable items (HOME is default, skip)
            if (market.serverId) {
                log(market.name + ': setting endpoint to market server...');
                var epOk = await _sendSetEndpoint(market.serverId);
                if (!epOk) {
                    log(market.name + ': failed to set endpoint \u2014 skipping', 'warn');
                    continue;
                }
                await delay(humanDelay());
            }

            var sellableResult = await getSellableItems(market.id);
            var sellableItems = sellableResult.items || [];
            if (sellableItems.length === 0) {
                log(market.name + ': no sellable items');
                await delay(humanDelay());
                continue;
            }

            var items = sellableItems.map(function (item) {
                var id = item.itemId || item.id || item.fileId;
                var type = item.itemType || 'file';
                return id ? { itemType: type, itemId: id } : null;
            }).filter(Boolean);
            var marketCredits = sellableResult.totalPrice;
            var marketRep = sellableResult.totalRepGain;
            log(market.name + ': found ' + items.length + ' sellable item(s) (\ud83d\udcb0' + marketCredits + ' \u2b50' + marketRep + ')');

            if (items.length > 0) {
                await delay(humanDelay());
                log(market.name + ': selling ' + items.length + ' item(s)...');
                var sold = await sellItems(market.id, items, function (soldItem) {
                    var sid = soldItem.itemId;
                    _sellerDownloadsData.files = _sellerDownloadsData.files.filter(function (f) { return f.id !== sid; });
                    updateDownloadsUI(_sellerDownloadsData);
                    if (_lastServersData) {
                        var mapping = _desktopToServerMap[sid];
                        if (mapping) {
                            var targetSrv = _lastServersData.servers.find(function (s) { return s.id === mapping.serverId; });
                            if (targetSrv) {
                                if (mapping.type === 'file') {
                                    targetSrv.files = (targetSrv.files || []).filter(function (f) { return (f.fileId || f.id) !== mapping.originalId; });
                                } else if (mapping.type === 'log') {
                                    targetSrv.logs = (targetSrv.logs || []).filter(function (l) { return l.seq !== mapping.originalId; });
                                }
                                var remaining = (targetSrv.files || []).length + (targetSrv.logs || []).length;
                                if (remaining === 0 && targetSrv.status === 'DOWNLOADED') {
                                    targetSrv.status = 'DONE';
                                }
                            }
                            delete _desktopToServerMap[sid];
                        }
                        updateServersUI(_lastServersData);
                    }
                });
                if (sold > 0) {
                    log(market.name + ': sold ' + sold + '/' + items.length + ' item(s) \u2713', 'success');
                    grandTotalCredits += marketCredits;
                    grandTotalRep += marketRep;
                    grandTotalSold += sold;
                } else {
                    log(market.name + ': sell failed', 'error');
                }
                await delay(humanDelay());
            }
        }
    }

    if (grandTotalSold > 0) {
        log('=== Total: ' + grandTotalSold + ' item(s) sold \u2014 \ud83d\udcb0' + grandTotalCredits + ' credits, \u2b50' + grandTotalRep + ' reputation ===', 'success');
    }
    await fetchMaintenanceData();
    log('=== Valuable Seller Complete ===', 'success');
    signalDone();
}
