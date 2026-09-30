// Server operations for auto-valuable-seller.
// File/log fetching, downloading, search-valuable, selling, filtering, analysis.

import {
    sendCmd, delay, waitForEvent, log, humanDelay,
    running,
    _fileAnalysisCache, _desktopToServerMap
} from './state.js';

// ---- Get files from current endpoint server ----

export async function getServerFiles(serverId) {
    sendCmd('get.files', { serverId: serverId });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_SAI_FILES', 15000);
        if (resp.error) {
            var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
            if (errMsg.indexOf('sai-files-not-available') >= 0) {
                log('Files not available on this server (sai-files-not-available)', 'warn');
                return [];
            }
            log('Get files error: ' + errMsg, 'error');
            return [];
        }
        return (resp.data && resp.data.files) || [];
    } catch (e) {
        log('Get files timeout', 'warn');
        return [];
    }
}

// ---- Get logs from current endpoint server ----

export async function getServerLogs(serverId) {
    sendCmd('get.logs', { serverId: serverId });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOGS', 15000);
        if (resp.error) {
            var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
            if (errMsg.indexOf('sai-logs-not-available') >= 0) {
                return [];
            }
            log('Get logs error: ' + errMsg, 'error');
            return [];
        }
        return (resp.data && resp.data.logs) || [];
    } catch (e) {
        log('Get logs timeout', 'warn');
        return [];
    }
}

// ---- Filter valuable files/logs (basePrice > 0 with tags) ----

export function filterValuableFiles(files) {
    return files.filter(function (f) { return f.basePrice > 0 && f.tags && f.tags.length > 0; });
}

export function filterValuableLogs(logs) {
    return logs.filter(function (l) { return l.basePrice > 0 && l.tags && l.tags.length > 0; });
}

// ---- Get downloads folder contents ----

export async function getDownloadsFolder() {
    var folderId = window.__cor3DownloadFolderId;
    if (!folderId) {
        log('Downloads folder ID not cached \u2014 requesting desktop options');
        sendCmd('desktop.get.options', {});
        try {
            var optResp = await waitForEvent('COR3_AUTOJOB_DESKTOP_OPTIONS', 10000);
            if (optResp.data && optResp.data.folders) {
                var dlf = optResp.data.folders.find(function (f) { return f.name === 'Downloads'; });
                if (dlf) {
                    folderId = dlf.id;
                    window.__cor3DownloadFolderId = folderId;
                }
            }
        } catch (e) {}
    }
    if (!folderId) {
        log('Could not find Downloads folder ID', 'error');
        return [];
    }

    sendCmd('open.folder', { folderId: folderId, source: 'desktop' });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_DESKTOP_FOLDER', 15000);
        if (resp.error) {
            log('Open folder error: ' + JSON.stringify(resp.error), 'error');
            return [];
        }
        return (resp.data && resp.data.files) || [];
    } catch (e) {
        log('Open folder timeout', 'warn');
        return [];
    }
}

// ---- Get file analysis for a downloaded file (cached) ----

export async function getFileAnalysis(fileId) {
    if (_fileAnalysisCache[fileId]) {
        return _fileAnalysisCache[fileId];
    }
    sendCmd('get.file.analysis', { fileId: fileId });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_FILE_ANALYSIS', 10000);
        if (resp.error) return null;
        var result = resp.data || null;
        if (result) _fileAnalysisCache[fileId] = result;
        return result;
    } catch (e) {
        return null;
    }
}

// ---- Trigger file.search-valuable on a server ----

export async function searchValuableFiles(serverId) {
    sendCmd('file.search-valuable', { serverId: serverId });
    try {
        var resp = await waitForEvent('COR3_VALUABLE_FILE_SEARCH', 30000);
        if (resp.error) {
            log('File search-valuable error: ' + JSON.stringify(resp.error), 'error');
            return null;
        }
        return resp.data || null;
    } catch (e) {
        log('File search-valuable timeout', 'warn');
        return null;
    }
}

// ---- Trigger log.search-valuable on a server ----

export async function searchValuableLogs(serverId) {
    sendCmd('log.search-valuable', { serverId: serverId });
    try {
        var resp = await waitForEvent('COR3_VALUABLE_LOG_SEARCH', 30000);
        if (resp.error) {
            var errMsg = resp.error.message || resp.error.kind || JSON.stringify(resp.error);
            if (errMsg.indexOf('sai-logs-not-available') >= 0) {
                return null;
            }
            log('Log search-valuable error: ' + errMsg, 'error');
            return null;
        }
        return resp.data || null;
    } catch (e) {
        log('Log search-valuable timeout', 'warn');
        return null;
    }
}

// ---- Download a file from a server ----

export async function downloadFile(serverId, fileId) {
    var desktopFileId = null;
    function onUpdateFile(evt) {
        if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE' && evt.data.data && evt.data.data.file) {
            desktopFileId = evt.data.data.file.id;
        }
    }
    window.addEventListener('message', onUpdateFile);
    sendCmd('file.download', { serverId: serverId, fileId: fileId });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_SAI_FILE_DOWNLOAD', 30000);
        window.removeEventListener('message', onUpdateFile);
        if (resp.error) {
            log('File download error: ' + JSON.stringify(resp.error), 'error');
            return false;
        }
        if (desktopFileId) {
            _desktopToServerMap[desktopFileId] = { serverId: serverId, type: 'file', originalId: fileId };
        }
        return true;
    } catch (e) {
        window.removeEventListener('message', onUpdateFile);
        log('File download timeout', 'warn');
        return false;
    }
}

// ---- Download a log from a server ----

export async function downloadLog(serverId, logSeq) {
    var desktopFileId = null;
    function onUpdateFile(evt) {
        if (evt.data && evt.data.type === 'COR3_AUTOJOB_DESKTOP_UPDATE_FILE' && evt.data.data && evt.data.data.file) {
            desktopFileId = evt.data.data.file.id;
        }
    }
    window.addEventListener('message', onUpdateFile);
    sendCmd('log.download', { serverId: serverId, seq: logSeq });
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_SAI_LOG_DOWNLOAD', 30000);
        window.removeEventListener('message', onUpdateFile);
        if (resp.error) {
            log('Log download error: ' + JSON.stringify(resp.error), 'error');
            return false;
        }
        if (desktopFileId) {
            _desktopToServerMap[desktopFileId] = { serverId: serverId, type: 'log', originalId: logSeq };
        }
        return true;
    } catch (e) {
        window.removeEventListener('message', onUpdateFile);
        log('Log download timeout', 'warn');
        return false;
    }
}

// ---- Get sellable items from a market ----

export async function getSellableItems(marketId) {
    sendCmd('get.sellable-items', { marketId: marketId });
    try {
        var resp = await waitForEvent('COR3_VALUABLE_SELLABLE_ITEMS', 15000);
        if (resp.error) {
            log('Get sellable items error: ' + JSON.stringify(resp.error), 'error');
            return { items: [], totalPrice: 0, totalRepGain: 0 };
        }
        var d = resp.data || {};
        return {
            items: d.items || [],
            totalPrice: d.totalPrice || 0,
            totalRepGain: d.totalRepGain || 0
        };
    } catch (e) {
        log('Get sellable items timeout', 'warn');
        return { items: [], totalPrice: 0, totalRepGain: 0 };
    }
}

// ---- Sell items to a market (one at a time) ----

export async function sellItems(marketId, items, onSold) {
    var sold = 0;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        sendCmd('sell.items', { marketId: marketId, items: [{ itemType: item.itemType, itemId: item.itemId }] });
        try {
            var resp = await waitForEvent('COR3_VALUABLE_SELL_RESULT', 15000);
            if (resp.error) {
                log('Sell item error (' + item.itemId + '): ' + JSON.stringify(resp.error), 'error');
                continue;
            }
            sold++;
            if (onSold) onSold(item);
        } catch (e) {
            log('Sell item timeout (' + item.itemId + ')', 'warn');
            continue;
        }
        if (i < items.length - 1) await delay(humanDelay());
    }
    return sold;
}
