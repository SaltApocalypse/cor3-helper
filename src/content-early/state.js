// content-early shared mutable state
// All cross-module mutable variables live here so every module can read/write them.

export const OrigWebSocket = window.WebSocket;

export const trackedSockets = [];
export const socketLastActivity = new Map(); // Track last message time per socket

// activeSocket must be accessed via getter/setter because multiple modules mutate it
let _activeSocket = null;
export function getActiveSocket() { return _activeSocket; }
export function setActiveSocket(ws) { _activeSocket = ws; }

// Captured bearer token from outgoing fetch/XHR
let _capturedBearerToken = null;
export function getCapturedBearerToken() { return _capturedBearerToken; }
export function setCapturedBearerToken(token) { _capturedBearerToken = token; }

// Token-expired handling
export let pendingRetryOps = [];
export let tokenExpiredFlag = false;
export function setTokenExpiredFlag(val) { tokenExpiredFlag = val; }
export function setPendingRetryOps(val) { pendingRetryOps = val; }

// Market refresh abort mechanism
let _marketRefreshAbortId = 0;
export function getMarketRefreshAbortId() { return _marketRefreshAbortId; }
export function bumpMarketRefreshAbortId() { return ++_marketRefreshAbortId; }

// Market IDs and server IDs
export const HOME_MARKET_ID = '019d3ea4-85bd-7389-904d-8f7c85841134';
export const DARK_MARKET_ID = '019d3ea4-85bd-7389-904d-908ba9194aa0';
export const DARK_SERVER_ID = '019d29c5-4b37-79bf-b23e-304d8ea03c15';
export const SOYUZ_MARKET_ID = '019da731-2db5-7d76-9447-1ea3b9b78001';
export const SOYUZ_SERVER_ID = '019da6f1-16f7-75a6-b6d3-0b1d5f92a108';
export const USOL_MARKET_ID = '019e4065-6ae8-760d-8724-58ab4f2cf7d7';
export const USOL_SERVER_ID = '019e4052-c317-7388-9d71-883ffb1560cd';

// Static path-through server lists removed — replaced by dynamic DFS pathfinding
// in market-requests.js (__cor3FindPathsToServer) using live network map data.

// Shared unreachable-market cache: keyed by market type ('usol', 'soyuz', 'dark').
// Each entry: { blockerName, maintenanceEndsAt (ISO string or null), detectedAt (ms timestamp) }
// Other sections check this before starting a path-through to avoid redundant hacking.
window.__cor3UnreachableMarkets = {};

// Check if a market is still known-unreachable (maintenance not yet expired)
window.__cor3IsMarketUnreachable = function (marketType) {
    var entry = window.__cor3UnreachableMarkets[marketType];
    if (!entry) return null;
    if (entry.maintenanceEndsAt) {
        var endsAt = new Date(entry.maintenanceEndsAt).getTime();
        if (Date.now() >= endsAt) {
            delete window.__cor3UnreachableMarkets[marketType];
            return null;
        }
    }
    return entry;
};

// Flag: initial data fetch is currently in progress (markets + mercs + stash + loadout)
window.__cor3InitialFetchInProgress = false;
