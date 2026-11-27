# COR3 Helper 2.0 — Valuable Seller Maintenance Panel and Force Operation

- **Status:** Implemented on `v2-dev` (build `2.0.10-salta.324`); force loop restored to v1 parity at build `2.0.12-salta.335`
- **Scope:** `Automation → Valuable Search & Sale`
- **Purpose:** surface per-server maintenance state and let the user force selected upcoming servers into maintenance, matching the v1 Maintenance tab and batch force behavior.

## 1. Background

v1's valuable seller exposed three surfaces:

1. **Search** — scan reachable servers for valuable files/logs.
2. **Seller** — run `file.search-valuable` / `log.search-valuable`, download detected items, then sell at USOL → SOYUZ → D4RK → HOME.
3. **Maintenance** — list servers with `timeUntilMaintenance` or `maintenanceEndsAt`; select upcoming servers and run `Force selected!`.

v1's force loop is the behavioral reference:

- Sort selected servers by path length, furthest first.
- Equip SEARCH software for each server.
- Send `file.search-valuable` up to 50 times, with a 15 s response window per attempt.
- Stop when the game emits `network-map` / `maintenance` (`COR3_WS_MAINTENANCE_STARTED`), or when a map refresh shows the server in maintenance.
- On `sai-access-denied`, refresh the map and retry endpoint/login.
- `ensureSearchOnlyLoadout` failure (no SEARCH power) skips the server.

The v1 implementation confirms the background claim at the mechanism level: repeated non-job SAI actions (`file.search-valuable`, plus non-task downloads in the seller) push the server toward maintenance; the exact counter/weight is server-side and not exposed to the client. The client only receives `timeUntilMaintenance`, `maintenanceEndsAt`, and the maintenance event.

## 2. v2 gaps before this change

- `MaintenanceState` already carried `active`, `endsAt`, `timeUntil`, but the UI only received `maintenanceActive`.
- The hub handled `network-map get.map` but ignored `maintenance` events.
- No force-maintenance use case, progress, cancellation or report.
- No maintenance list/selection in the Valuable card.
- No automatic force after a sale.

## 3. Implementation

### 3.1 Data and events

- `network-map` / `sai` `maintenance` events are normalized by `GameSocketHub` into a `V2_MAINTENANCE_STARTED` content notice.
- Background `messaging` records the server in `MaintenanceMonitor` and logs it.
- `valuable.maintenance` returns active/upcoming servers from the current snapshot (`force: true` on manual refresh).

### 3.2 UI

Inside `Valuable Search & Sale`, below **Status and report**:

- A **Server status & maintenance** subsection.
- A persisted **Force maintenance** switch (`valuableForceMaintenanceEnabled`).
- The subsection is only expandable when the switch is on.
- Rows show active/upcoming status and a live countdown.
- Upcoming servers can be checked; active servers are disabled.
- `Select all upcoming`, `Refresh maintenance`, `Force selected (N)` and cancel controls.
- Starting a sale passes the checked upcoming servers to the background; after the sale completes, the background starts the force run automatically.

### 3.3 Force use case (v1 parity)

`ValuableSellerService.forceMaintenance` is a deliberate special case that follows
v1's loop instead of v2's shared network-refresh pipeline:

- **50 attempts / 15 s** request window per server, **1000-1500 ms human pacing**
  (v1's `humanDelay` range, raised to reduce burst traffic).
- SEARCH loadout via a strict `beforeForce` hook; no SEARCH power skips the server.
- Dynamic route length sorting (furthest first) instead of the v1 static path table.
- `file.search-valuable` remains the primary trigger.
- **No downloads.** v2's "one file per attempt + one log per five attempts" was
  removed; the force loop only pushes the server toward maintenance.
- **No periodic map refresh.** The loop starts from the cached snapshot and only
  forces `get.map` for `sai-access-denied` recovery, exactly like v1. The old
  refresh every three attempts was the main source of `get.map` traffic and
  "too many requests" responses.
- **Rate-limit special case.** Force searches carry
  `bypassRateLimitCooldown`, so the main-world hub keeps sending them (still at
  the 250 ms send throttle) while ordinary commands wait out the game's
  escalating 5-60 s cooldown. Rate-limit responses to these searches do not
  escalate the global cooldown used by other features.
- Reached endpoints are reused between targets so consecutive servers on the
  same path skip a redundant `set.endpoint`.
- Stop on `MaintenanceMonitor`, a refreshed map showing active maintenance
  (access recovery only), cancellation, or the attempt cap.
- Diagnostics: debug traces per attempt (duration, result, rate-limit flag) plus
  per-server/run summaries in the visible run log.

### 3.4 Coordinator and async behavior

- `valuable.forceMaintenance` starts a run and returns immediately; the UI follows `valuable.progress`/`valuable.report`.
- The force loop runs inside the existing `networkOps` queue, so it cannot race market/job endpoint changes.
- `valuable.sell` accepts optional `forceMaintenance` options and starts the force run after a successful sale.
- Stats persist `forcedServers`, `lastForceAt`, and force-download counts.

### 3.5 Safety

- Only servers with an upcoming maintenance countdown are selectable.
- Active-maintenance servers are displayed but disabled.
- The switch is disabled while any valuable run is active.
- The UI warns that forcing makes servers unavailable for jobs and markets.
- v1-compatible behavior: market servers may be forced if listed; the user is explicitly warned.

## 4. Tests

- `application/valuable/seller.test.ts`: furthest-first order, maintenance event stop, download acceleration, 50-attempt cap, cancellation.
- `application/valuable/maintenance-monitor.test.ts`: event wait, timeout, independent servers, clear.
- `application/valuable/maintenance.test.ts`: list active/upcoming, empty `timeUntil` handling.
- Background contract test includes `valuable.forceMaintenance` and `valuable.maintenance`.

Verification: typecheck, lint, build and Vitest (124 files / 1032 tests) pass at build `2.0.10-salta.324`.
