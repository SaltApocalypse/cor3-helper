// WebSocket command wrappers: stash, specialists, loadout, auto-job, valuable seller, updater
import { wsSend, enterRooms } from './ws-send.js';

// Send stash request: leave if in room, delay, then re-join
window.__cor3RequestStash = function () {
    console.log('[COR3 Helper] Requesting stash data');
    enterRooms(['stash']);
    return true;
};

// Sell an item from stash
window.__cor3SellItem = function (itemId, quantity, skipStashRefresh) {
    quantity = quantity || 1;
    console.log('[COR3 Helper] Selling item:', itemId, 'qty:', quantity);
    var msg = '42["event",{"event":{"name":"stash","action":"sell.item"},"data":{"itemId":"' + itemId + '","quantity":' + quantity + '}}]';
    wsSend(msg);
    if (!skipStashRefresh) {
        setTimeout(function () {
            window.__cor3RequestStash();
        }, 1500);
    }
    return true;
};

// --- Specialists WS send functions ---
window.__cor3RequestSpecialists = function () {
    console.log('[COR3 Helper] Requesting specialists data');
    var msg = '42["event",{"event":{"name":"specialists","action":"get.state"},"data":{}}]';
    wsSend(msg);
    return true;
};
window.__cor3PurchaseSpecialist = function (specialistType, kind, level, priceId) {
    console.log('[COR3 Helper] Purchasing specialist service:', specialistType, kind, level, priceId);
    var msg = '42["event",{"event":{"name":"specialists","action":"purchase"},"data":{"specialistType":"' + specialistType + '","kind":"' + kind + '","level":' + level + ',"priceId":"' + priceId + '"}}]';
    wsSend(msg);
    return true;
};

// --- Loadout WS send functions ---
window.__cor3RequestLoadout = function () {
    console.log('[COR3 Helper] Requesting loadout data');
    var msg = '42["event",{"event":{"name":"loadout","action":"get.options"}}]';
    wsSend(msg);
    return true;
};
window.__cor3EquipHardware = function (moduleConfigId) {
    console.log('[COR3 Helper] Equipping hardware:', moduleConfigId);
    var msg = '42["event",{"event":{"name":"loadout","action":"equip.hardware"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};
window.__cor3EquipSoftware = function (moduleConfigId) {
    console.log('[COR3 Helper] Equipping software:', moduleConfigId);
    var msg = '42["event",{"event":{"name":"loadout","action":"equip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};
window.__cor3UnequipSoftware = function (moduleConfigId) {
    console.log('[COR3 Helper] Unequipping software:', moduleConfigId);
    var msg = '42["event",{"event":{"name":"loadout","action":"unequip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};

// --- Auto Job Solver WS send functions ---
window.__cor3AutoJobTake = function (marketId, jobId) {
    var msg = '42["event",{"event":{"name":"market","action":"job.take"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobComplete = function (marketId, jobId) {
    var msg = '42["event",{"event":{"name":"market","action":"job.complete"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobDismiss = function (marketId, jobId) {
    var msg = '42["event",{"event":{"name":"market","action":"job.dismiss"},"data":{"marketId":"' + marketId + '","jobId":"' + jobId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetMarketOptions = function (marketId) {
    // Update current market fetch tracker so the response handler routes jobs to the correct market cache
    window.__cor3CurrentMarketFetch = marketId;
    var msg = '42["event",{"event":{"name":"market","action":"get.jobs"},"data":{"marketId":"' + marketId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobSetEndpoint = function (serverId) {
    var msg = '42["event",{"event":{"name":"network-map","action":"set.endpoint"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetLoginStatus = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"get.login.status"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobLoginWithAccess = function (serverId, accessGrantId) {
    var msg = '42["event",{"event":{"name":"sai","action":"login.with-access"},"data":{"serverId":"' + serverId + '","accessGrantId":"' + accessGrantId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobHackStart = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"hack.start"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetFiles = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"get.files"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobFileDownload = function (serverId, fileId) {
    var msg = '42["event",{"event":{"name":"sai","action":"file.download"},"data":{"serverId":"' + serverId + '","fileId":"' + fileId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetLogs = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"get.logs"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobLogDelete = function (serverId, seq) {
    var msg = '42["event",{"event":{"name":"sai","action":"log.delete"},"data":{"serverId":"' + serverId + '","seq":' + seq + '}}]';
    wsSend(msg);
};
window.__cor3AutoJobLogDownload = function (serverId, seq) {
    var msg = '42["event",{"event":{"name":"sai","action":"log.download"},"data":{"serverId":"' + serverId + '","seq":' + seq + '}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetTransit = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"get.transit"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobTransitAdd = function (serverId, ip, description) {
    description = description || '';
    var msg = '42["event",{"event":{"name":"sai","action":"transit.add"},"data":{"serverId":"' + serverId + '","ip":"' + ip + '","description":"' + description + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobOpenFolder = function (folderId) {
    var msg = '42["event",{"event":{"name":"desktop","action":"open.folder"},"data":{"folderId":"' + folderId + '","source":"desktop"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetDesktopOptions = function () {
    var msg = '42["event",{"event":{"name":"desktop","action":"get.options"},"data":{}}]';
    wsSend(msg);
};
window.__cor3AutoJobDecryptFile = function (fileId) {
    var msg = '42["event",{"event":{"name":"desktop","action":"decrypt.file"},"data":{"fileId":"' + fileId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobGetNetworkMap = function () {
    var msg = '42["event",{"event":{"name":"network-map","action":"get.map"},"data":{}}]';
    wsSend(msg);
};
window.__cor3AutoJobFileDelete = function (serverId, fileId) {
    var msg = '42["event",{"event":{"name":"sai","action":"file.delete"},"data":{"serverId":"' + serverId + '","fileId":"' + fileId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobFileUpload = function (serverId, name, sizeMb) {
    var msg = '42["event",{"event":{"name":"sai","action":"file.upload"},"data":{"serverId":"' + serverId + '","name":"' + name + '","sizeMb":' + (sizeMb || 0) + '}}]';
    wsSend(msg);
};
window.__cor3AutoJobTransitRemove = function (serverId, ip) {
    var msg = '42["event",{"event":{"name":"sai","action":"transit.remove"},"data":{"serverId":"' + serverId + '","ip":"' + ip + '"}}]';
    wsSend(msg);
};
// --- Auto Job Solver: file analysis + loadout commands ---
window.__cor3AutoJobGetFileAnalysis = function (fileId) {
    var msg = '42["event",{"event":{"name":"desktop","action":"get.file.analysis"},"data":{"fileId":"' + fileId + '","source":"desktop"}}]';
    wsSend(msg);
};
window.__cor3AutoJobRequestLoadout = function () {
    var msg = '42["event",{"event":{"name":"loadout","action":"get.options"}}]';
    wsSend(msg);
};
window.__cor3AutoJobEquipHardware = function (moduleConfigId) {
    var msg = '42["event",{"event":{"name":"loadout","action":"equip.hardware"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobEquipSoftware = function (moduleConfigId) {
    var msg = '42["event",{"event":{"name":"loadout","action":"equip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};
window.__cor3AutoJobUnequipSoftware = function (moduleConfigId) {
    var msg = '42["event",{"event":{"name":"loadout","action":"unequip.software"},"data":{"moduleConfigId":"' + moduleConfigId + '"}}]';
    wsSend(msg);
};
// --- Auto Valuable Seller WS send functions ---
window.__cor3ValuableFileSearch = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"file.search-valuable"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3ValuableLogSearch = function (serverId) {
    var msg = '42["event",{"event":{"name":"sai","action":"log.search-valuable"},"data":{"serverId":"' + serverId + '"}}]';
    wsSend(msg);
};
window.__cor3ValuableGetSellableItems = function (marketId) {
    var msg = '42["event",{"event":{"name":"market","action":"get.sellable-items"},"data":{"marketId":"' + marketId + '"}}]';
    wsSend(msg);
};
window.__cor3ValuableSellItems = function (marketId, items) {
    var msg = '42["event",{"event":{"name":"market","action":"sell.items"},"data":{"marketId":"' + marketId + '","items":' + JSON.stringify(items) + '}}]';
    wsSend(msg);
};

window.__cor3RequestUpdater = function () {
    console.log('[COR3 Helper] Requesting updater data');
    var msg = '42["event",{"event":{"name":"updater","action":"get.patches"},"data":{}}]';
    wsSend(msg);
};
