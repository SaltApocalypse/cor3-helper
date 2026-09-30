import { HOME_SERVER_ID, MARKET_SERVER_IDS } from './server-constants.js';

function ServerMap() {
    this._servers = {};
    this._adjacency = {};
    this._homeId = null;
    this._ready = false;
    this._pathCache = {};
    this._serverPriority = null;
}

ServerMap.prototype.update = function (mapData) {
    if (!mapData || !mapData.servers || !mapData.connections) return;

    this._servers = {};
    this._adjacency = {};
    this._pathCache = {};
    this._serverPriority = null;
    this._homeId = null;

    var servers = Array.isArray(mapData.servers) ? mapData.servers : [];
    var connections = Array.isArray(mapData.connections) ? mapData.connections : [];

    for (var i = 0; i < servers.length; i++) {
        var s = servers[i];
        this._servers[s.id] = {
            id: s.id,
            name: s.serverName,
            ip: s.serverIp,
            typeName: s.serverTypeName || null,
            cluster: s.serverCluster || null,
            faction: s.faction || null,
            defenceRate: s.serverDefenceRate || 0,
            isInMaintenance: !!s.isInMaintenance,
            maintenanceEndsAt: s.maintenanceEndsAt || null,
            timeUntilMaintenance: s.timeUntilMaintenance || null,
            isDiscovered: s.isDiscovered !== false,
            isAccessible: !!s.isAccessible,
            isReachable: !!s.isReachable,
            accessType: s.accessType || 'none',
            hasAdminAccess: !!s.hasAdminAccess,
            isEndpoint: !!s.isEndpoint,
            canSetEndpoint: s.canSetEndpoint !== false,
            marketId: s.marketId || null,
            transitType: s.transitType || null
        };
        this._adjacency[s.id] = [];

        if (s.serverTypeName === 'Home' || s.serverName === 'Home Server' || s.id === HOME_SERVER_ID) {
            this._homeId = s.id;
        }
    }

    for (var j = 0; j < connections.length; j++) {
        var c = connections[j];
        if (this._adjacency[c.serverA] && this._adjacency[c.serverB]) {
            this._adjacency[c.serverA].push({ targetId: c.serverB, connectionId: c.id, isHidden: !!c.isHidden });
            this._adjacency[c.serverB].push({ targetId: c.serverA, connectionId: c.id, isHidden: !!c.isHidden });
        }
    }

    this._ready = true;
};

ServerMap.prototype.isReady = function () {
    return this._ready;
};

ServerMap.prototype.getServer = function (serverId) {
    return this._servers[serverId] || null;
};

ServerMap.prototype.getServerByName = function (name) {
    for (var id in this._servers) {
        if (this._servers[id].name === name) return this._servers[id];
    }
    return null;
};

ServerMap.prototype.getServerIdByName = function (name) {
    var s = this.getServerByName(name);
    return s ? s.id : null;
};

ServerMap.prototype.getAllServers = function () {
    return this._servers;
};

ServerMap.prototype.getHomeId = function () {
    return this._homeId;
};

ServerMap.prototype.findAllPaths = function (targetId, opts) {
    if (!this._ready || !this._homeId) return [];
    if (targetId === this._homeId) return [[]];

    var skipMaintenance = !opts || opts.skipMaintenance !== false;
    var maintFp = skipMaintenance ? this.getMaintenanceFingerprint() : '';
    var cacheKey = targetId + '|' + (skipMaintenance ? 'sm:' + maintFp : 'all');
    if (this._pathCache[cacheKey]) return this._pathCache[cacheKey];

    var allPaths = [];
    var visited = {};
    var self = this;

    function dfs(currentId, path) {
        if (currentId === targetId) {
            allPaths.push(path.slice());
            return;
        }
        var neighbors = self._adjacency[currentId];
        if (!neighbors) return;
        for (var i = 0; i < neighbors.length; i++) {
            var nb = neighbors[i];
            if (!visited[nb.targetId]) {
                // Skip intermediate servers that are in maintenance (target is allowed)
                if (skipMaintenance && nb.targetId !== targetId) {
                    var srv = self._servers[nb.targetId];
                    if (srv && srv.isInMaintenance) {
                        var remaining = srv.maintenanceEndsAt ? new Date(srv.maintenanceEndsAt).getTime() - Date.now() : 0;
                        if (remaining > 0) continue;
                    }
                }
                visited[nb.targetId] = true;
                path.push({ id: nb.targetId, name: (self._servers[nb.targetId] || {}).name || nb.targetId, isHidden: nb.isHidden });
                dfs(nb.targetId, path);
                path.pop();
                visited[nb.targetId] = false;
            }
        }
    }

    visited[this._homeId] = true;
    dfs(this._homeId, []);

    allPaths.sort(function (a, b) { return a.length - b.length; });

    this._pathCache[cacheKey] = allPaths;
    return allPaths;
};

ServerMap.prototype.getShortestPath = function (targetId) {
    var paths = this.findAllPaths(targetId);
    return paths.length > 0 ? paths[0] : null;
};

ServerMap.prototype.getShortestPathByName = function (serverName) {
    var id = this.getServerIdByName(serverName);
    if (!id) return null;
    return this.getShortestPath(id);
};

ServerMap.prototype.findAllPathsByName = function (serverName) {
    var id = this.getServerIdByName(serverName);
    if (!id) return [];
    return this.findAllPaths(id);
};

ServerMap.prototype.checkPathMaintenance = function (targetServerNameOrId) {
    if (!this._ready) return { blocked: false };

    var targetId = this._servers[targetServerNameOrId] ? targetServerNameOrId : this.getServerIdByName(targetServerNameOrId);
    if (!targetId) return { blocked: false };

    // Use maintenance-filtered paths first — if any exist, the target is reachable
    var reachablePaths = this.findAllPaths(targetId);
    if (reachablePaths.length > 0) return { blocked: false, usedPath: reachablePaths[0] };

    // No maintenance-free paths — get unfiltered paths to find the blocker
    var allPaths = this.findAllPaths(targetId, { skipMaintenance: false });
    if (allPaths.length === 0) return { blocked: true, blockerName: 'no-path', endsAt: null, remainingMs: 0 };

    // Find the first maintenance blocker on the shortest unfiltered path
    var firstBlocker = null;
    var firstPath = allPaths[0];
    for (var bi = 0; bi < firstPath.length; bi++) {
        var bsrv = this._servers[firstPath[bi].id];
        if (bsrv && bsrv.isInMaintenance) {
            var bRemaining = bsrv.maintenanceEndsAt ? new Date(bsrv.maintenanceEndsAt).getTime() - Date.now() : 0;
            if (bRemaining > 0) {
                firstBlocker = { blocked: true, blockerName: bsrv.name, endsAt: bsrv.maintenanceEndsAt, remainingMs: bRemaining };
                break;
            }
        }
    }

    return firstBlocker || { blocked: true, blockerName: 'unknown', endsAt: null, remainingMs: 0 };
};

ServerMap.prototype.findBestReachablePath = function (targetServerNameOrId) {
    if (!this._ready) return null;

    var targetId = this._servers[targetServerNameOrId] ? targetServerNameOrId : this.getServerIdByName(targetServerNameOrId);
    if (!targetId) return null;

    // findAllPaths already excludes maintenance intermediates by default
    var allPaths = this.findAllPaths(targetId);
    return allPaths.length > 0 ? allPaths[0] : null;
};

ServerMap.prototype.getMaintenanceFingerprint = function () {
    var parts = [];
    for (var id in this._servers) {
        var s = this._servers[id];
        if (s.isInMaintenance) {
            parts.push(id + ':M:' + (s.maintenanceEndsAt || ''));
        } else if (s.timeUntilMaintenance) {
            parts.push(id + ':U:' + s.timeUntilMaintenance);
        }
    }
    parts.sort();
    return parts.join('|');
};

ServerMap.prototype.getServerPriority = function () {
    if (this._serverPriority) return this._serverPriority;
    if (!this._ready || !this._homeId) return [];

    var result = [];
    for (var id in this._servers) {
        if (id === this._homeId) continue;
        var s = this._servers[id];
        var path = this.getShortestPath(id);
        if (path) {
            result.push({ id: id, name: s.name, pathLength: path.length });
        }
    }
    result.sort(function (a, b) { return b.pathLength - a.pathLength; });
    this._serverPriority = result.map(function (r) { return r.name; });
    return this._serverPriority;
};

ServerMap.prototype.getServerPriorityIndex = function (serverName) {
    if (!serverName || serverName === 'None') return -1;
    var priority = this.getServerPriority();
    var idx = priority.indexOf(serverName);
    return idx >= 0 ? idx : priority.length;
};

ServerMap.prototype.getMaintenanceInfo = function () {
    var info = {};
    for (var id in this._servers) {
        var s = this._servers[id];
        info[id] = {
            serverName: s.name,
            isInMaintenance: s.isInMaintenance,
            maintenanceEndsAt: s.maintenanceEndsAt,
            timeUntilMaintenance: s.timeUntilMaintenance
        };
    }
    return info;
};

ServerMap.prototype.getServerTypeMap = function () {
    var map = {};
    for (var id in this._servers) {
        var s = this._servers[id];
        map[id] = {
            serverName: s.name,
            serverTypeName: s.typeName,
            serverDefenceRate: s.defenceRate
        };
    }
    return map;
};

ServerMap.prototype.toJSON = function () {
    return {
        servers: this._servers,
        adjacency: this._adjacency,
        homeId: this._homeId,
        ready: this._ready
    };
};

ServerMap.prototype.fromJSON = function (json) {
    if (!json) return;
    this._servers = json.servers || {};
    this._adjacency = json.adjacency || {};
    this._homeId = json.homeId || null;
    this._ready = !!json.ready;
    this._pathCache = {};
    this._serverPriority = null;
};

ServerMap.prototype.getPathForServer = function (serverName) {
    if (this._ready) {
        var id = this.getServerIdByName(serverName);
        if (id) {
            var path = this.getShortestPath(id);
            if (path) return path;
        }
    }
    return FALLBACK_PATH_MAP[serverName] || null;
};

ServerMap.prototype.getServerNameById = function (serverId) {
    if (this._ready) {
        var s = this._servers[serverId];
        if (s) return s.name;
    }
    for (var name in FALLBACK_PATH_MAP) {
        var path = FALLBACK_PATH_MAP[name];
        for (var i = 0; i < path.length; i++) {
            if (path[i].id === serverId) return path[i].name;
        }
    }
    return null;
};

ServerMap.prototype.getPathForServerId = function (serverId) {
    if (this._ready) {
        var path = this.getShortestPath(serverId);
        if (path) return path;
    }
    for (var name in FALLBACK_PATH_MAP) {
        var path = FALLBACK_PATH_MAP[name];
        if (path.length > 0 && path[path.length - 1].id === serverId) {
            return path;
        }
    }
    return null;
};

ServerMap.prototype.getServerIdByNameOrFallback = function (serverName) {
    if (this._ready) {
        var id = this.getServerIdByName(serverName);
        if (id) return id;
    }
    var fb = FALLBACK_PATH_MAP[serverName];
    if (fb && fb.length > 0) return fb[fb.length - 1].id;
    return null;
};

ServerMap.prototype.getAllServerIds = function () {
    if (this._ready) {
        var result = {};
        for (var id in this._servers) {
            result[id] = this._servers[id].name;
        }
        return result;
    }
    var result = {};
    for (var name in FALLBACK_PATH_MAP) {
        var path = FALLBACK_PATH_MAP[name];
        var last = path[path.length - 1];
        result[last.id] = name;
    }
    return result;
};

ServerMap.prototype.getPathLength = function (serverId) {
    if (this._ready) {
        var path = this.getShortestPath(serverId);
        if (path) return path.length;
    }
    for (var name in FALLBACK_PATH_MAP) {
        var p = FALLBACK_PATH_MAP[name];
        var last = p[p.length - 1];
        if (last.id === serverId) return p.length;
    }
    return 0;
};

export var FALLBACK_SERVER_PRIORITY = [
    'URM7-H', 'URM7-M', 'URM7-S5L2', 'B43274N', 'B43272N', 'B43271N',
    'D4RK RM7EG', 'SRM7-N3L2', 'SRM7-M', 'SRM7-N4L2', 'SRM7-N3L1',
    'RM7-N1L1', 'RM7-W3NCP', 'RM7-N2L3', 'RM7-N2L2', 'RM7-N2ECP',
    'D4RK RM7CE', 'RM7-S4WCP', 'RM7-S4L3', 'RM7-S4L1', 'RM7-S4L4',
    'RM7-S4L2', 'RM7-E1SCP', 'RM7-E1L2CT', 'RM7-E1L5', 'RM7-E1L3'
];

export var FALLBACK_PATH_MAP = {
    'RM7-E1L3': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' }
    ],
    'RM7-E1L5': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' }
    ],
    'RM7-E1L2CT': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' }
    ],
    'RM7-E1SCP': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' }
    ],
    'RM7-S4L4': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' }
    ],
    'D4RK RM7CE': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' }
    ],
    'D4RK RM7MI': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
        { name: 'D4RK RM7MI', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' }
    ],
    'D4RK 2IV2': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
        { name: 'D4RK 2IV2', id: '019d29c5-4b37-7de9-b46c-022179bcb5eb' }
    ],
    'RM7-N2ECP': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' }
    ],
    'RM7-N2L2': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' }
    ],
    'RM7-N2L3': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' }
    ],
    'RM7-W3NCP': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' }
    ],
    'RM7-N1L1': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' }
    ],
    'RM7-S4L2': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' }
    ],
    'RM7-S4L3': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' }
    ],
    'RM7-S4L1': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' },
        { name: 'RM7-S4L1', id: '019e4052-c315-71df-80da-4e334b96c9e6' }
    ],
    'RM7-S4WCP': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4WCP', id: '019e4052-c316-73aa-81f6-448645a38c9e' }
    ],
    'D4RK RM7EG': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
        { name: 'D4RK RM7MI', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' },
        { name: 'D4RK RM7EG', id: '019e4052-c316-73aa-81f6-483e50247e61' }
    ],
    'B43271N': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' },
        { name: 'B43271N', id: '019e4052-c316-73aa-81f6-567c9a8f5738' }
    ],
    'B43272N': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1L2CT', id: '019d53aa-5101-7f08-b3dd-378b0ddcf7d0' },
        { name: 'B43271N', id: '019e4052-c316-73aa-81f6-567c9a8f5738' },
        { name: 'B43272N', id: '019e4052-c316-73aa-81f6-5aa82fc72bdd' }
    ],
    'B43274N': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'D4RK RM7CE', id: '019d29c5-4b37-7436-aef9-89af09560af3' },
        { name: 'D4RK RM7MI', id: '019d29c5-4b37-79bf-b23e-304d8ea03c15' },
        { name: 'D4RK RM7EG', id: '019e4052-c316-73aa-81f6-483e50247e61' },
        { name: 'B43274N', id: '019e4052-c316-73aa-81f6-60ec61b61f0a' }
    ],
    'URM7-S5L2': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
        { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' }
    ],
    'URM7-M': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L2', id: '019e4052-c316-73aa-81f6-38c323c58eb2' },
        { name: 'RM7-S4L3', id: '019e4052-c316-73aa-81f6-3dcef4d6873e' },
        { name: 'URM7-S5L2', id: '019e4052-c317-7388-9d71-85b98a02d5fb' },
        { name: 'URM7-M', id: '019e4052-c317-7388-9d71-883ffb1560cd' }
    ],
    'URM7-H': [
        { name: 'RM7-E1L5', id: '019d1b0a-13a9-77dd-b41f-374ee144bd07' },
        { name: 'RM7-E1SCP', id: '019d1b0a-13a9-77dd-b41f-3a21d490cb2d' },
        { name: 'RM7-S4L4', id: '019d1b0a-13a9-77dd-b41f-3ffb5f671742' },
        { name: 'RM7-S4L1', id: '019e4052-c315-71df-80da-4e334b96c9e6' },
        { name: 'URM7-H', id: '019e4052-c317-7388-9d71-8fed6faaaf99' }
    ],
    'SRM7-M': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
        { name: 'RM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
        { name: 'SRM7-M', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' }
    ],
    'SRM7-N3L2': [
        { name: 'RM7-E1L3', id: '019d1b0a-13a9-77dd-b41f-33f06f2df284' },
        { name: 'RM7-N2ECP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a105' },
        { name: 'RM7-N2L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a101' },
        { name: 'RM7-N2L3', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a102' },
        { name: 'RM7-W3NCP', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a106' },
        { name: 'RM7-N1L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a104' },
        { name: 'RM7-N3L1', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a107' },
        { name: 'SRM7-M', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a108' },
        { name: 'SRM7-N3L2', id: '019da6f1-16f7-75a6-b6d3-0b1d5f92a109' }
    ]
};

export function findMaintenanceBlocker(serverMaintenanceMap, marketKey) {
    var pathKey = marketKey === 'dark' ? 'D4RK RM7MI' : marketKey === 'soyuz' ? 'SRM7-M' : marketKey === 'usol' ? 'URM7-M' : null;
    if (!pathKey || !serverMaintenanceMap) return null;
    var path = FALLBACK_PATH_MAP[pathKey];
    if (!path) return null;
    var now = Date.now();
    for (var i = 0; i < path.length; i++) {
        var info = serverMaintenanceMap[path[i].id];
        if (info && info.isInMaintenance && info.maintenanceEndsAt) {
            var remaining = new Date(info.maintenanceEndsAt).getTime() - now;
            if (remaining > 0) {
                return { blockerName: info.serverName || path[i].name, maintenanceEndsAt: info.maintenanceEndsAt };
            }
        }
    }
    return null;
}

export { ServerMap };
