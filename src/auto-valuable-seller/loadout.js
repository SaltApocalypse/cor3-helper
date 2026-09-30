// Loadout orchestration for auto-valuable-seller.
// Uses shared pure-computation from loadout-resolver.js,
// combined with async WS interactions from state.js wired utilities.

import {
    sendCmd, delay, waitForEvent, log, humanDelay,
    _cachedLoadout, _cachedLoadoutAt, _lastLoadoutFetchAt,
    LOADOUT_COOLDOWN_MS,
    setCachedLoadout, setLastLoadoutFetchAt, invalidateLoadoutCache,
    getServerName
} from './state.js';

import {
    calculateAnalysis, findBestHardware,
    findHackSoftwareForServerType, findSearchSoftwareForServerType,
    getServerTypeName
} from '../shared/loadout-resolver.js';

// ---- Loadout data fetching ----

export async function getLoadoutData(forceRefresh) {
    if (!forceRefresh && _cachedLoadout && (Date.now() - _cachedLoadoutAt < 60000)) {
        return _cachedLoadout;
    }
    var sinceLastFetch = Date.now() - _lastLoadoutFetchAt;
    if (sinceLastFetch < LOADOUT_COOLDOWN_MS && _cachedLoadout) {
        return _cachedLoadout;
    }
    log('Loadout: requesting fresh data via WS...');
    setLastLoadoutFetchAt(Date.now());
    sendCmd('loadout.get', {});
    try {
        var resp = await waitForEvent('COR3_AUTOJOB_LOADOUT', 15000);
        if (resp.data) {
            setCachedLoadout(resp.data);
            return resp.data;
        }
    } catch (e) {
        log('Loadout: fetch timeout', 'warn');
    }
    return _cachedLoadout || null;
}

// ---- Apply loadout change (unequip/equip hardware+software) ----

export async function applyLoadoutChange(loadout, targetHw, targetSwIds) {
    log('Loadout: applying change — target sw count: ' + targetSwIds.length);
    var currentHw = loadout.equippedHardware || {};
    var currentSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var changed = false;

    // 1. Unequip software that is NOT in targetSwIds
    for (var ui = 0; ui < currentSwIds.length; ui++) {
        if (targetSwIds.indexOf(currentSwIds[ui]) >= 0) continue;
        var unequipName = currentSwIds[ui];
        var eqSw = loadout.equippedSoftware || [];
        for (var un = 0; un < eqSw.length; un++) {
            if (eqSw[un].id === currentSwIds[ui]) { unequipName = eqSw[un].name + ' (' + currentSwIds[ui] + ')'; break; }
        }
        log('Loadout: unequipping software ' + unequipName);
        sendCmd('loadout.unequip.software', { moduleConfigId: currentSwIds[ui] });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    // 2. Equip hardware if changed — smart order to avoid PSU rejection
    var hwChanges = [];
    var hwSlots = ['cpu', 'gpu', 'ram', 'psu'];
    for (var hci = 0; hci < hwSlots.length; hci++) {
        var hSlot = hwSlots[hci];
        var hCurId = currentHw[hSlot] ? currentHw[hSlot].id : null;
        var hTgtId = targetHw[hSlot] ? targetHw[hSlot].id : null;
        if (hTgtId && hTgtId !== hCurId) {
            var curConsume = 0, tgtConsume = 0;
            if (hSlot === 'cpu') { curConsume = currentHw.cpu ? (currentHw.cpu.specs.cpuConsuming || 0) : 0; tgtConsume = targetHw.cpu.specs.cpuConsuming || 0; }
            if (hSlot === 'gpu') { curConsume = currentHw.gpu ? (currentHw.gpu.specs.gpuConsuming || 0) : 0; tgtConsume = targetHw.gpu.specs.gpuConsuming || 0; }
            hwChanges.push({ slot: hSlot, id: hTgtId, name: targetHw[hSlot].name || hTgtId, delta: tgtConsume - curConsume, isPsu: hSlot === 'psu' });
        }
    }
    var psuUpgrade = hwChanges.find(function (c) { return c.isPsu && targetHw.psu && currentHw.psu && (targetHw.psu.specs.psuPower || 0) > (currentHw.psu.specs.psuPower || 0); });
    var orderedHwChanges = [];
    if (psuUpgrade) orderedHwChanges.push(psuUpgrade);
    hwChanges.sort(function (a, b) { return a.delta - b.delta; });
    for (var hoi = 0; hoi < hwChanges.length; hoi++) {
        if (hwChanges[hoi] !== psuUpgrade) orderedHwChanges.push(hwChanges[hoi]);
    }
    for (var hi = 0; hi < orderedHwChanges.length; hi++) {
        var hc = orderedHwChanges[hi];
        log('Loadout: equipping ' + hc.slot.toUpperCase() + ' \u2192 ' + hc.name);
        sendCmd('loadout.equip.hardware', { moduleConfigId: hc.id });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    // 3. Equip target software
    for (var ei = 0; ei < targetSwIds.length; ei++) {
        var swName = '';
        var allSw = loadout.ownedSoftware || [];
        for (var k = 0; k < allSw.length; k++) {
            if (allSw[k].id === targetSwIds[ei]) { swName = allSw[k].name; break; }
        }
        log('Loadout: equipping software ' + swName + ' (' + targetSwIds[ei] + ')');
        sendCmd('loadout.equip.software', { moduleConfigId: targetSwIds[ei] });
        await waitForEvent('COR3_AUTOJOB_LOADOUT', 8000);
        await delay(500);
        changed = true;
    }

    if (changed) {
        return await getLoadoutData(true);
    }
    return loadout;
}

// ---- Ensure hack-only loadout for a server ----

export async function ensureHackOnlyLoadout(serverId, getLoginStatusFn) {
    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' \u2014 skipping hack loadout');
        return { ok: false, reason: 'unknown-server-type' };
    }

    var serverDefenceRate = 0;
    try {
        var preLoginData = await getLoginStatusFn(serverId);
        if (preLoginData && preLoginData.serverDefenceRate) {
            serverDefenceRate = preLoginData.serverDefenceRate;
        }
    } catch (e) { }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data \u2014 proceeding without hack loadout', 'warn');
        return { ok: false, reason: 'no-loadout-data' };
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
    log('Loadout: found ' + hackCandidates.length + ' hack candidate(s) for ' + serverTypeName + (hackCandidates.length > 0 ? ' \u2014 best: ' + hackCandidates[0].sw.name + ' (power ' + (hackCandidates[0].spec.power || []).join('-') + ')' : ''));

    if (hackCandidates.length === 0) {
        log('Loadout: no HACK software available for ' + serverTypeName, 'warn');
        return { ok: false, reason: 'no-hack-software' };
    }

    var bestHack = hackCandidates[0];
    var targetSwIds = [bestHack.sw.id];
    var currentHw = loadout.equippedHardware || {};
    var analysis = calculateAnalysis(loadout, targetSwIds);
    var targetHw = currentHw;
    var alreadyBest = equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id;

    if (alreadyBest) {
        log('Loadout: best HACK software "' + bestHack.sw.name + '" already equipped alone');
    }

    if (!analysis.canBoot) {
        log('Loadout: current hardware cannot boot hack software \u2014 finding compatible hardware');
        var betterHw = findBestHardware(loadout, targetSwIds);
        if (betterHw) {
            targetHw = betterHw;
        } else {
            log('Loadout: cannot boot hack software \u2014 skipping loadout change', 'warn');
            return { ok: false, reason: 'cannot-boot' };
        }
    }

    var checkLoadout = JSON.parse(JSON.stringify(loadout));
    checkLoadout.equippedHardware = targetHw;
    var checkAnalysis = calculateAnalysis(checkLoadout, targetSwIds);
    var computedHackPower = 0;
    var hackSa = checkAnalysis.swAnalysis[bestHack.sw.id];
    if (hackSa) {
        for (var ai = 0; ai < hackSa.abilities.length; ai++) {
            if (hackSa.abilities[ai].type === 'HACK') {
                computedHackPower = hackSa.abilities[ai].computedPower;
                break;
            }
        }
    }
    if (serverDefenceRate > 0) {
        log('Loadout: hack power comparison \u2014 hackPower: ' + computedHackPower + ' vs serverDefenceRate: ' + serverDefenceRate + (computedHackPower >= serverDefenceRate ? ' \u2713' : ' \u2717 INSUFFICIENT'));
    } else {
        log('Loadout: computed hack power: ' + computedHackPower + ' (serverDefenceRate unknown)');
    }

    if (serverDefenceRate > 0 && computedHackPower < serverDefenceRate) {
        log('Loadout: hack power insufficient \u2014 trying hardware upgrade to boost power');
        var hwUpgrade = findBestHardware(loadout, targetSwIds);
        if (hwUpgrade) {
            var upgradeLoadout = JSON.parse(JSON.stringify(loadout));
            upgradeLoadout.equippedHardware = hwUpgrade;
            var upgradeAnalysis = calculateAnalysis(upgradeLoadout, targetSwIds);
            var upgradedPower = 0;
            var upgradeSa = upgradeAnalysis.swAnalysis[bestHack.sw.id];
            if (upgradeSa) {
                for (var uai = 0; uai < upgradeSa.abilities.length; uai++) {
                    if (upgradeSa.abilities[uai].type === 'HACK') {
                        upgradedPower = upgradeSa.abilities[uai].computedPower;
                        break;
                    }
                }
            }
            if (upgradedPower > computedHackPower) {
                targetHw = hwUpgrade;
                computedHackPower = upgradedPower;
                log('Loadout: hardware upgrade found \u2014 hack power: ' + upgradedPower + ' vs serverDefenceRate: ' + serverDefenceRate + (upgradedPower >= serverDefenceRate ? ' \u2713' : ' \u2717 still insufficient'));
                if (upgradedPower < serverDefenceRate) {
                    log('Loadout: cannot reach required hack power (' + serverDefenceRate + ') \u2014 best achievable: ' + upgradedPower, 'error');
                    return { ok: false, reason: 'insufficient-power', hackPower: upgradedPower, defenceRate: serverDefenceRate };
                }
            } else {
                log('Loadout: no better hardware available \u2014 best hack power: ' + computedHackPower, 'warn');
                return { ok: false, reason: 'insufficient-power', hackPower: computedHackPower, defenceRate: serverDefenceRate };
            }
        } else {
            log('Loadout: no hardware upgrade available', 'warn');
            return { ok: false, reason: 'insufficient-power', hackPower: computedHackPower, defenceRate: serverDefenceRate };
        }
    }

    if (!alreadyBest || targetHw !== currentHw) {
        log('Loadout: equipping HACK software "' + bestHack.sw.name + '" (power ' + (bestHack.spec.power || []).join('-') + ') for ' + serverTypeName);
        await applyLoadoutChange(loadout, targetHw, targetSwIds);
    }
    return { ok: true, hackPower: computedHackPower, defenceRate: serverDefenceRate };
}

// ---- Ensure search-only loadout for a server ----

export async function ensureSearchOnlyLoadout(serverId) {
    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId) + ' \u2014 skipping search loadout');
        return;
    }

    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: could not fetch loadout data \u2014 proceeding without search loadout', 'warn');
        return;
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var searchCandidates = findSearchSoftwareForServerType(allSw, serverTypeName);
    if (searchCandidates.length === 0) {
        log('Loadout: no SEARCH software available for ' + serverTypeName);
        return;
    }

    var bestSearch = searchCandidates[0];
    var targetSwIds = [bestSearch.sw.id];
    var bestHw = findBestHardware(loadout, targetSwIds);
    var targetHw = bestHw || loadout.equippedHardware || {};
    var finalAnalysis = calculateAnalysis(
        Object.assign({}, loadout, { equippedHardware: targetHw }),
        targetSwIds
    );
    if (!finalAnalysis.canBoot) {
        log('Loadout: cannot boot search software \u2014 skipping loadout change', 'warn');
        return;
    }
    var searchPower = 0;
    for (var swId in finalAnalysis.swAnalysis) {
        var ab = finalAnalysis.swAnalysis[swId].abilities;
        for (var ai = 0; ai < ab.length; ai++) {
            if (ab[ai].type === 'SEARCH') searchPower = ab[ai].computedPower;
        }
    }
    var swAlreadyOk = equippedSwIds.length === 1 && equippedSwIds[0] === bestSearch.sw.id;
    var curHw = loadout.equippedHardware || {};
    var hwAlreadyOk = (!bestHw) ||
        ((curHw.cpu && curHw.cpu.id) === (targetHw.cpu && targetHw.cpu.id) &&
         (curHw.gpu && curHw.gpu.id) === (targetHw.gpu && targetHw.gpu.id) &&
         (curHw.ram && curHw.ram.id) === (targetHw.ram && targetHw.ram.id) &&
         (curHw.psu && curHw.psu.id) === (targetHw.psu && targetHw.psu.id));
    if (swAlreadyOk && hwAlreadyOk) {
        log('Loadout: best SEARCH software "' + bestSearch.sw.name + '" already equipped with optimal hardware (power: ' + searchPower + '/' + bestSearch.spec.power[1] + ')');
        return searchPower;
    }

    log('Loadout: equipping SEARCH software "' + bestSearch.sw.name + '" (computed power: ' + searchPower + '/' + bestSearch.spec.power[1] + ') for ' + serverTypeName);
    await applyLoadoutChange(loadout, targetHw, targetSwIds);
    return searchPower;
}

// ---- Try hack loadout swap after sai-hack-impossible ----

export async function tryHackLoadoutSwap(serverId, getLoginStatusFn) {
    invalidateLoadoutCache();
    var loadout = await getLoadoutData(true);
    if (!loadout) {
        log('Loadout: cannot retry \u2014 no loadout data available', 'warn');
        return false;
    }

    var serverTypeName = getServerTypeName(serverId);
    if (!serverTypeName) {
        log('Loadout: cannot determine server type for ' + getServerName(serverId), 'warn');
        return false;
    }

    var allSw = loadout.ownedSoftware || [];
    var equippedSwIds = (loadout.equippedSoftware || []).map(function (s) { return s.id; });
    var hackCandidates = findHackSoftwareForServerType(allSw, serverTypeName);
    if (hackCandidates.length === 0) {
        log('Loadout: no hack software available for ' + serverTypeName, 'warn');
        return false;
    }

    var bestHack = hackCandidates[0];
    var targetSwIds = [bestHack.sw.id];

    var serverDefenceRate = 0;
    try {
        var loginStatus = await getLoginStatusFn(serverId, true);
        if (loginStatus && loginStatus.serverDefenceRate) {
            serverDefenceRate = loginStatus.serverDefenceRate;
        }
    } catch (e) { }

    if (equippedSwIds.length === 1 && equippedSwIds[0] === bestHack.sw.id) {
        log('Loadout: best hack software "' + bestHack.sw.name + '" already equipped alone \u2014 trying hardware upgrade');
        var currentAnalysis = calculateAnalysis(loadout, targetSwIds);
        var currentHackPower = 0;
        var curSa = currentAnalysis.swAnalysis[bestHack.sw.id];
        if (curSa) {
            for (var chi = 0; chi < curSa.abilities.length; chi++) {
                if (curSa.abilities[chi].type === 'HACK') { currentHackPower = curSa.abilities[chi].computedPower; break; }
            }
        }
        if (serverDefenceRate > 0) {
            log('Loadout: current hack power: ' + currentHackPower + ' vs serverDefenceRate: ' + serverDefenceRate);
        }
        var betterHw = findBestHardware(loadout, targetSwIds);
        if (!betterHw) {
            log('Loadout: no hardware upgrade available \u2014 cannot improve hack power' + (serverDefenceRate > 0 ? ' (need ' + serverDefenceRate + ', have ' + currentHackPower + ')' : ''), 'error');
            return false;
        }
        var testLoadout = JSON.parse(JSON.stringify(loadout));
        testLoadout.equippedHardware = betterHw;
        var hwAnalysis = calculateAnalysis(testLoadout, targetSwIds);
        if (!hwAnalysis.canBoot) {
            log('Loadout: cannot boot with better hardware \u2014 giving up', 'error');
            return false;
        }
        var upgradedHackPower = 0;
        var hwSa = hwAnalysis.swAnalysis[bestHack.sw.id];
        if (hwSa) {
            for (var uhi = 0; uhi < hwSa.abilities.length; uhi++) {
                if (hwSa.abilities[uhi].type === 'HACK') { upgradedHackPower = hwSa.abilities[uhi].computedPower; break; }
            }
        }
        log('Loadout: with hardware upgrade, hack power: ' + upgradedHackPower + (serverDefenceRate > 0 ? ' vs serverDefenceRate: ' + serverDefenceRate : ''));
        if (upgradedHackPower <= currentHackPower) {
            log('Loadout: hardware upgrade does not improve hack power \u2014 giving up', 'error');
            return false;
        }
        if (serverDefenceRate > 0 && upgradedHackPower < serverDefenceRate) {
            log('Loadout: hardware upgrade still insufficient \u2014 need ' + serverDefenceRate + ', best achievable: ' + upgradedHackPower, 'error');
            return false;
        }
        log('Loadout: swapping hardware to boost hack power for ' + serverTypeName);
        await applyLoadoutChange(loadout, betterHw, targetSwIds);
        return true;
    }

    var currentHw = loadout.equippedHardware || {};
    var analysis = calculateAnalysis(loadout, targetSwIds);
    var targetHw = currentHw;
    if (!analysis.canBoot) {
        var betterHw2 = findBestHardware(loadout, targetSwIds);
        if (betterHw2) {
            targetHw = betterHw2;
        } else {
            log('Loadout: cannot boot hack-only software \u2014 giving up', 'warn');
            return false;
        }
    }

    var preCheckLoadout = JSON.parse(JSON.stringify(loadout));
    preCheckLoadout.equippedHardware = targetHw;
    var preCheck = calculateAnalysis(preCheckLoadout, targetSwIds);
    var projectedPower = 0;
    var preSa = preCheck.swAnalysis[bestHack.sw.id];
    if (preSa) {
        for (var phi = 0; phi < preSa.abilities.length; phi++) {
            if (preSa.abilities[phi].type === 'HACK') { projectedPower = preSa.abilities[phi].computedPower; break; }
        }
    }
    log('Loadout: projected hack power with new loadout: ' + projectedPower + (serverDefenceRate > 0 ? ' vs serverDefenceRate: ' + serverDefenceRate : ''));
    if (serverDefenceRate > 0 && projectedPower < serverDefenceRate) {
        var hwRetry = findBestHardware(loadout, targetSwIds);
        if (hwRetry) {
            var testLoadout2 = JSON.parse(JSON.stringify(loadout));
            testLoadout2.equippedHardware = hwRetry;
            var hwCheck = calculateAnalysis(testLoadout2, targetSwIds);
            var retryPower = 0;
            var retrySa = hwCheck.swAnalysis[bestHack.sw.id];
            if (retrySa) {
                for (var rhi = 0; rhi < retrySa.abilities.length; rhi++) {
                    if (retrySa.abilities[rhi].type === 'HACK') { retryPower = retrySa.abilities[rhi].computedPower; break; }
                }
            }
            if (retryPower >= serverDefenceRate) {
                targetHw = hwRetry;
                log('Loadout: found better hardware \u2014 hack power: ' + retryPower);
            } else {
                log('Loadout: best achievable hack power: ' + retryPower + ' \u2014 still below serverDefenceRate (' + serverDefenceRate + ')', 'error');
                return false;
            }
        } else {
            log('Loadout: no hardware upgrade available \u2014 cannot reach serverDefenceRate (' + serverDefenceRate + ')', 'error');
            return false;
        }
    }

    log('Loadout: equipping HACK-only "' + bestHack.sw.name + '" for retry');
    await applyLoadoutChange(loadout, targetHw, targetSwIds);
    return true;
}
