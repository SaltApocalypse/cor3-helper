# H8 — Background / Side Panel Decomposition Design

- **Status:** Implemented (Phase 0–7) in `2.0.0-salta-dev.222`
- **Date:** 2026-11-15
- **Build reference:** `2.0.0-salta-dev.222`
- **Still current:** `2.0.5-salta.272` retains the 54-line composition root and 103 bridge commands across 17 handler modules; the suite is now 93 files / 448 tests.
- **Scope:** H8 (background god module + oversized side-panel component)
- **Related:** H9 (persistence), H10 (test coverage), M2 (domain logic in UI), M10 (polling), M18 (boundary enforcement)

## 1. Problem statement

`src/contexts/background/index.ts` is 4,666 lines with 103 `BridgeServer.register` calls. It currently owns, in one module:

- infrastructure construction (20+ adapters/stores),
- mutable automation state (`let` / `Map` at module scope),
- automation engines (Auto Jobs, Auto Finish, Auto Expedition, Auto Drone, Auto Mail, Auto Daily, Auto Refresh),
- job preflight/execution/history/lock policy,
- 103 bridge handlers,
- Chrome event listeners (`onMessage`, `onAlarm`, `onRemoved`, `onInstalled`),
- MV3 startup restore and alarm scheduling.

`src/ui/app/SidePanelApp.tsx` is 1,916 lines with ~90 `useState` hooks, polling intervals, event subscription and every page action in one component.

The failure mode is not “too many lines” by itself. It is:

1. A change to one automation can regress another through shared module-level state.
2. Nothing can be tested without a Chrome runtime: handlers, scheduling and state transitions are interleaved.
3. Merge conflicts concentrate in two files.
4. Ownership is invisible: there is no single place that states “Auto Finish owns `autoFinishLive`”.

## 2. Goals / non-goals

### Goals

1. `contexts/background/index.ts` becomes a side-effect-only composition root of **≤ 150 lines**.
2. Every bridge handler lives in a per-domain handler module of **≤ 250 lines**.
3. Every mutable automation state item has an explicit owner; no cross-module `let` mutation.
4. Automation engines become Chrome-free, port-driven application services that can be tested with a fake clock, fake scheduler and fake tab transport.
5. Alarm names, alarm routing, Helper Mode clearing and bootstrap restore are declared once, not hand-copied.
6. `SidePanelApp.tsx` drops below ~300 lines by extracting per-domain hooks/view models.

### Non-goals

- No behavior change. Bridge type strings, payload schemas, result shapes, log messages and event names stay identical.
- No redesign of the bridge protocol (H2 is already done).
- No new features or UI changes.
- No persistence/migration redesign (H9).
- No forced move of handler payload schemas into `contracts/` (that is M3).

## 3. Target architecture

```
src/contexts/background/
  index.ts                     composition root, side effects only (~120 lines)
  composition/
    core.ts                    logger, settings, events, bridge, stores, session log
    game.ts                    tab adapters, network, market, loadout, jobs, inventory...
    automation.ts              coordinators + scheduler + restore/start ordering
  alarms.ts                    alarm ids + declarative route table
  messaging.ts                 runtime.onMessage / tabs.onRemoved / onInstalled
  bootstrap.ts                 restore persisted state, apply Helper Mode, start alarms
  handlers/
    types.ts                   shared handler deps types
    system.ts                  system.*, activity.state, overview.state, diagnostics
    devtools.ts                devtools.*
    settings.ts                settings.get/update/export/import/reset
    auth.ts                    auth.*
    network.ts                 network.*, discovery, market path/sync
    market.ts                  market.options, market.cached
    loadout.ts                 loadout.*
    jobs.ts                    job.*, job.queue*, job.history
    auto-jobs.ts               auto-jobs.*
    auto-finish.ts             auto-finish.*
    expeditions.ts             expeditions.*
    drone.ts                   drone.*
    daily.ts                   daily.*
    mail.ts                    mail.*
    inventory.ts               inventory.*
    specialists.ts             specialists.*
    valuable.ts                valuable.*

src/application/
  automation/
    ports.ts                   SchedulerPort, EventPublisher, SettingsReader, Clock (reuse kernel)
  auto-job/
    preflight.ts               checkJobTarget/capability/preflight
    locks.ts                   JobLockRegistry (locks, retry attempts, persistence)
    coordinator.ts             Auto Jobs cycle, snapshot, scheduling policy
    finish-coordinator.ts      Auto Finish run state machine
  expeditions/auto-coordinator.ts
  drone/auto-coordinator.ts
  mail/auto-coordinator.ts
  daily-ops/auto-coordinator.ts
  network/auto-refresh.ts
  valuable/coordinator.ts      run registry, cancellation, stats
```

Dependency direction:

```
contexts/background/index.ts
  ├─ composition/*        wiring only
  ├─ handlers/*           bridge adapter: parse already done, call one service
  ├─ messaging.ts/alarms.ts/bootstrap.ts
  └──────────────▶ application/* coordinators and services
                          ├──────────────▶ domain/*
                          └── ports ◀──── infrastructure/chrome adapters
```

Rules:

- `handlers/*` never call `chrome.*` directly. They receive a typed deps object.
- `application/*` coordinators never import `chrome`, `window`, `document`, or concrete adapters.
- `contexts/background/index.ts` does not contain handler bodies or automation logic.
- No DI container and no mutable module registry (hard rule 8). Composition returns explicit readonly slices passed as arguments.

## 4. Composition slices

`index.ts` becomes:

```ts
const core = createCoreRuntime();
const game = createGameRuntime(core);
const automation = createAutomationRuntime(core, game);

registerSystemHandlers(core.server, { core, automation });
registerDevtoolsHandlers(core.server, { core });
registerSettingsHandlers(core.server, { core, automation });
registerAuthHandlers(core.server, { auth: game.auth });
registerNetworkHandlers(core.server, { network: game.network });
registerMarketHandlers(core.server, { market: game.market });
registerLoadoutHandlers(core.server, { loadout: game.loadout });
registerJobHandlers(core.server, { jobs: game.jobs, automation });
registerAutoJobsHandlers(core.server, { autoJobs: automation.autoJobs });
registerAutoFinishHandlers(core.server, { autoFinish: automation.autoFinish });
registerExpeditionHandlers(core.server, { expeditions: automation.expeditions });
registerDroneHandlers(core.server, { drone: automation.drone });
registerDailyHandlers(core.server, { daily: automation.daily });
registerMailHandlers(core.server, { mail: automation.mail });
registerInventoryHandlers(core.server, { inventory: game.inventory });
registerSpecialistHandlers(core.server, { specialists: game.specialists });
registerValuableHandlers(core.server, { valuable: automation.valuable });

registerAlarmRoutes(automation);
registerMessaging(core, game, automation);
registerLifecycle(core, game, automation);
void startBackground(core, game, automation);
```

No global state object is exported. Each factory returns only what its consumers need. A handler module receives an explicit dependency interface, e.g.:

```ts
export interface JobHandlerDeps {
    readonly jobs: JobCoordinator;
    readonly history: JobHistoryPort;
    readonly locks: JobLockRegistry;
}
export function registerJobHandlers(server: BridgeServer, deps: JobHandlerDeps): void;
```

## 5. State ownership

Every current module-level `let`/`Map` moves into exactly one owner. The table is the review checklist: a grep for the symbol after the move must hit only the owner.

| Current state | New owner |
|---|---|
| `autoJobsSnapshot`, `autoJobsCycleRunning`, `autoJobsCancelRequested`, `autoJobsStage`, `autoJobsNextRefreshAt`, `autoJobsRefreshReason`, `autoJobsLastError`, `autoJobsLastSkipReason`, `autoJobsBootstrapAt`, `autoJobsLastAttemptAt` | `AutoJobsCoordinator` |
| `autoFinishRunning`, `autoFinishLast`, `autoFinishLive`, `autoFinishProgress`, `autoFinishCancelRequested`, `autoFinishNextRetryAt`, `autoFinishRetryReason`, `autoFinishCompletedResets` | `AutoFinishCoordinator` |
| `jobLocks`, `retryAttempts` | `JobLockRegistry` |
| `valuableRuns`, `valuableCancelled`, `valuableActiveRunId`, `valuableStats` | `ValuableCoordinator` |
| `jobQueueRuns`, `jobQueueCancelled` | `JobQueueCoordinator` (application layer) |
| `autoExpeditionRunning/Last/Preparation/Cancelled`, `lastExpeditionViewAt` | `AutoExpeditionCoordinator` |
| `autoDroneRunning`, `autoDroneLast`, `lastDroneViewAt` | `AutoDroneCoordinator` |
| `autoMailRunning`, `autoMailLast` | `AutoMailCoordinator` |
| `dailyHackRunning`, `dailyHackLast`, `dailyHackState`, `dailyNextRunAt`, `dailyNextRunReason` | `AutoDailyCoordinator` |
| `autoRefreshRunning`, `autoRefreshLast` | `AutoRefreshCoordinator` |
| `readinessByTab`, `autoReadyKeys` | `ReadinessRegistry` |
| `readinessSummary`, `handleGameReadiness`, `refreshGameReadinessFromTab` | `ReadinessRegistry` + messaging adapter |
| `marketCache`, `dailyCacheMemory`, `dailyCacheLoaded` | existing cache stores (already owned); in-memory daily cache moves to `DailyOpsCacheService` |
| `inventorySorting`, `autoMailRunning` (UI flags) | `InventoryCoordinator` / `AutoMailCoordinator` |
| `sessionLogTimer`, `sessionLogArea` | `SessionLogSink` in `composition/core.ts` |
| `bridgeAudits`, `runLogs`, `eventPorts` | `DiagnosticsRuntime` in `composition/core.ts` |

Anything that must survive an MV3 suspension is persisted through an existing store; in-memory coordinators are recreated from storage in `bootstrap.ts`.

## 6. Automation coordinators

Example shape (no Chrome imports):

```ts
export interface AutoJobsCoordinatorDeps {
    readonly runner: AutoJobsCycleRunner;      // existing application services
    readonly snapshots: AutoJobsSnapshotStorePort;
    readonly readiness: ReadinessRegistry;
    readonly settings: SettingsReader;
    readonly scheduler: SchedulerPort;
    readonly events: EventPublisher;
    readonly clock: Clock;
    readonly logger: Logger;
}

export class AutoJobsCoordinator {
    snapshot(): AutoJobsSnapshot | null;
    status(): Promise<AutoJobsStatus>;
    enable(): Promise<Result<SettingsV1, BridgeError>>;
    disable(): Promise<Result<SettingsV1, BridgeError>>;
    runCycle(reason: AutoJobsRefreshReason, force?: boolean): Promise<void>;
    restore(): Promise<void>;
    start(): Promise<void>;
}
```

`SchedulerPort` is implemented once over `chrome.alarms`:

```ts
export interface SchedulerPort {
    schedule(job: AutomationJobId, periodMs: number): Promise<void>;
    clear(job: AutomationJobId): Promise<void>;
    clearAll(): Promise<void>;
}
```

`EventPublisher` is implemented once over `chrome.runtime.Ports` + `broadcastEvent`. Coordinators emit domain events by name; the adapter decides who receives them.

`SettingsReader` exposes `get()` and `update(patch)` so Helper Mode checks stay identical without importing `SettingsRepository`.

This is the step that makes H8 testable: a coordinator test can inject `FakeClock`, `FakeScheduler`, `FakeTabTransport`, in-memory stores and assert the same state transitions the UI shows.

## 7. Handler modules

Mechanical rules for every moved handler:

1. Keep the bridge type string byte-for-byte.
2. Keep the Zod schema byte-for-byte; if it is module-local, move the schema next to the handler.
3. Keep the result shape and error codes.
4. Keep side effects in the same order.
5. A handler body should be ≤ 15 lines: validate is already done by `BridgeServer`, then one coordinator/service call plus formatting.
6. Shared helpers move to their natural owner, not to `utils.ts`:
   - `checkJobTarget`, `checkJobCapability`, `preflightJob` → `application/auto-job/preflight.ts`
   - `readWithRetry`, `pause`, `humanDelay` → existing kernel/application helpers (reuse `kernel/sleep.ts`)
   - `applyMarketCacheSnapshot` → `application/markets/cache.ts`
   - `recordJobHistory`, `failureOf`, `outcomeReasonText`, `codeForOutcome` → `application/auto-job/outcome.ts` (already partially exists)
   - diagnostics builders → `application/diagnostics/*` or `handlers/system.ts` view builders
7. Handler modules may import `contracts/*`, `application/*` and `kernel/*`. They should not import `infrastructure/*` once the composition slices exist; the exception is a type-only import.

## 8. Alarms, messaging, bootstrap

`alarms.ts` replaces the 100-line `if (alarm.name === ...)` chain with a table:

```ts
interface AlarmRoute {
    readonly id: AutomationJobId;
    readonly alarm: string;
    readonly scope: string;
    readonly run: () => Promise<void>;
}

export function alarmRoutes(automation: AutomationRuntime): readonly AlarmRoute[];
export function registerAlarmRouter(routes: readonly AlarmRoute[]): void;
```

Benefits:

- Helper Mode’s “clear every automation alarm” list is derived from `routes.map(r => r.alarm)`. Today the list is hand-maintained and has already drifted once (`AUTO_FINISH_ALARM` was removed only in L4).
- Adding an automation cannot forget its retry alarm or its Helper Mode suppression.
- Startup scheduling and shutdown share the same ids.

`messaging.ts` owns:

- `chrome.runtime.onMessage` content notices (`V2_GAME_READY`, `V2_MARKET_CACHE`, `V2_WS_NOTICE`),
- `chrome.tabs.onRemoved`,
- `chrome.runtime.onInstalled`.

`bootstrap.ts` owns the startup IIFE, split into explicit phases:

```ts
await restorePersistedState({ autoJobs, autoFinish, drone, expedition, mail, daily });
await applyHelperMode(settings, scheduler, automation);
await startSchedulers(settings, scheduler, automation);
await primeReadiness();
```

Each phase is a named function with a test seam. Startup ordering is documented here instead of being implicit in a 200-line async IIFE.

## 9. Bridge contract safety net

The split touches 103 registrations. Add two guards:

1. `BridgeServer.listTypes(): readonly string[]` (read-only accessor, no behavior change).
2. `src/contexts/background/handlers/contract.test.ts` composes all handler modules with fakes and asserts:
   - the registered set equals a checked-in snapshot of 103 types;
   - every type is handled (no `BRIDGE_UNKNOWN_TYPE` for known portal calls);
   - no handler resolves to `undefined` for an empty payload when its schema expects `{}`.

The portal interface in `application/popup/portal.ts` remains the source of truth for the UI; a follow-up test (H10) can assert portal method → bridge type coverage.

## 10. SidePanelApp decomposition

Target layout:

```
src/ui/app/
  SidePanelApp.tsx              ~250 lines: layout + page switch + hook composition
  hooks/
    usePortalConnection.ts      ping, version, reconnection/backoff, events
    useSettings.ts
    useNetwork.ts               map, diagnostics, queue, discovery
    useJobs.ts                  jobs, selection, queue, history
    useAutoJobs.ts
    useAutoFinish.ts
    useInventory.ts
    useLoadout.ts
    useExpeditions.ts
    useDrone.ts
    useMail.ts
    useDaily.ts
    useValuable.ts
    usePolling.ts               visibility-aware scheduler (also resolves M10)
  view-models/
    job-report.ts               autoFinishMarketsToJobReport, status mapping
    automation-status.ts
```

Rules:

- Hooks own state and portal calls; they do **not** own domain rules (M2). Pure calculations move to `ui/app/view-models/*` and are unit-tested.
- Every polling loop goes through `usePolling`, which pauses when `document.hidden` and resumes on visibility. This removes the current staggered 1 s/2 s/5 s/15 s/30 s/60 s timers spread across the component.
- The portal event subscription is owned by `usePortalConnection`; reconnection is a separate concern (M8) and can be added without touching feature hooks.
- Page components keep receiving props/handlers; no page needs to know about `BridgeClient`.

## 11. Migration plan

Move-only commits. Each phase keeps the extension working, typechecks, tests, builds, bumps the build number, and is manually smoke-tested for the touched domain.

### Phase 0 — Safety net (no production refactor)

- Add `BridgeServer.listTypes()`.
- Add `src/testing/` fakes: `FakeClock`, `FakeScheduler`, `FakeEventPublisher`, `FakeSettings`, `FakeTabTransport`.
- Add the handler-type snapshot test.
- Acceptance: 103 types captured; tests pass.

### Phase 1 — Low-coupling handlers (~450 lines out)

Move: `system`, `devtools`, `settings`, `auth`.
These depend mostly on stores/diagnostics and are the least entangled with automation.

### Phase 2 — Game data handlers (~500 lines out)

Move: `network`, `market`, `loadout`, `jobs` (including queue).
Extract `fetchMarketOptionsView`, `refreshCachedMarketOptions`, job preflight and history helpers to application modules.

### Phase 3 — Valuable pilot (~250 lines out)

Move the valuable run registry and handlers. This is the smallest state machine with cancellation and progress, so it proves the coordinator + handler pattern before the large automations.

### Phase 4 — Remaining feature handlers (~500 lines out)

Move: `expeditions`, `drone`, `daily`, `mail`, `inventory`, `specialists`.
At the end of this phase `index.ts` contains only composition + listeners + automation engines.

### Phase 5 — Automation engines (~2,000 lines out)

Order by risk, smallest first:

1. `auto-refresh`
2. `auto-mail`
3. `auto-daily`
4. `auto-drone`
5. `auto-expedition`
6. `auto-jobs`
7. `auto-finish`

For each: move state into a coordinator, inject ports, restore the previous alarm/broadcast behavior, and add unit tests for the state transitions that were previously untestable.

### Phase 6 — Lifecycle (~400 lines out)

Move `alarms.ts`, `messaging.ts`, `bootstrap.ts`; delete the old listener chains.
Acceptance: `contexts/background/index.ts` ≤ 150 lines; no file in `contexts/background` > 400 lines.

### Phase 7 — SidePanelApp (~1,650 lines out)

Extract hooks/view models in the same order as the pages. Start with `usePortalConnection` + `usePolling` because all other hooks depend on them.
Acceptance: `SidePanelApp.tsx` ≤ 300 lines; each hook ≤ 250 lines; polling centralized.

## 12. Test strategy

| Layer | Test type | What it proves |
|---|---|---|
| Handler modules | Bridge server test with fake deps | type string, schema, result mapping, error codes |
| Coordinators | Unit test with fake clock/scheduler/transport/stores | cycles, cancellation, retry scheduling, Helper Mode |
| Bootstrap | Unit test with fake settings/stores/scheduler | restore order and alarm creation/clearing |
| Alarm router | Unit test | every route maps to one handler; Helper Mode clears all |
| View models | Pure unit tests | UI report/status calculations |
| Contract | Snapshot test | no handler silently disappears |

The fake tab transport is the highest-value investment: the game never has to be running, and it can replay recorded responses from real sessions.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Behavior drift while moving 4,600 lines | move-only phases; no renames of bridge types/log text; contract snapshot; per-phase manual smoke |
| Circular imports between handlers and composition | handlers depend on typed slices, never on `composition/*`; application never imports contexts |
| Shared state discovered late | state ownership table + grep per symbol; a symbol may exist in only one owner after its phase |
| MV3 top-level singletons recreated on wake | coordinators remain module-level singletons in `index.ts`; state that must survive is persisted and restored explicitly |
| Helper Mode regression | alarm routes derive clear list; bootstrap test asserts all automation alarms are cleared |
| Scope creep into H9/H10/M-series | explicit non-goals; only the test harness needed for H8 is added |
| Review size | one phase per change set; each phase has its own build number and smoke checklist |

## 14. Acceptance criteria

- [x] `contexts/background/index.ts` ≤ 150 lines and contains no handler body and no automation engine. (54 lines)
- [x] 103 bridge types preserved exactly; contract snapshot test passes.
- [x] No module in `contexts/background` exceeds 400 lines. (max 398)
- [x] No `chrome.*` reference inside automation coordinators or handler modules.
- [x] All mutable automation state has a single named owner from section 5.
- [x] Alarm list for Helper Mode is generated from the route table, not hand-written.
- [x] `SidePanelApp.tsx` ≤ 300 lines; polling goes through `usePolling`. (271 lines)
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. (76 files / 321 tests, build .222)
- [ ] Manual smoke: settings update, job sync/take, auto-finish run, expedition run, mail claim, inventory sort, valuable run, DevTools logs. (still required against a live game tab)

## 15. Open questions

1. **Coordinator location:** put coordinators under `application/<domain>/` (recommended, testable, enforces port boundaries) or under `contexts/background/automation/` first and promote later. The phase plan can start in the context and promote in Phase 5 without changing call sites.
2. **Handler schema ownership:** keep module-local Zod schemas for now, or move bridge payload schemas to `contracts/` as part of this work (overlaps M3).
3. **Polling unification:** `usePolling` also fixes M10; if M10 is scheduled separately, keep the hook but preserve current intervals initially.
4. **Snapshot test source:** check in a literal type list, or derive it from `portal.ts` and fail on drift. A literal list is simpler and catches accidental removals.

## 16. Recommendation

Do Phase 0 and Phase 1 first. They remove ~450 lines with almost no behavioral risk and establish the harness the remaining phases need. Do not attempt Phases 5–7 in one change set: Auto Finish, Auto Expedition and SidePanelApp are the three highest-regression areas and each deserves its own review pass.

If only a partial H8 fix is wanted, the minimum viable outcome is:

- composition root ≤ 300 lines,
- handlers in per-domain modules,
- Auto Finish / Auto Expedition / SidePanelApp left untouched,
- contract snapshot test in place.

This removes the “everything in one file” failure mode without rewriting the riskiest state machines.

---

# 17. Implementation result (2.0.0-salta-dev.222)

## Background

| Metric | Before | After |
|---|---|---|
| `contexts/background/index.ts` | 4,666 lines | **54 lines** |
| Bridge registrations | 103 in one file | 103 across 17 handler modules |
| Largest background source file | 4,666 lines | **398 lines** (`automation/auto-jobs.ts`) |
| Mutable module-level automation state | ~40 `let`/`Map`/`Set` declarations | 0 in the composition root; owned by coordinators |

Final layout (actual):

```
contexts/background/
  index.ts                 composition root
  alarms.ts                declarative alarm route table
  messaging.ts             runtime/tabs/installed listeners
  bootstrap.ts             restore, Helper Mode, scheduler start
  composition/
    core.ts                logger, settings, bridge, events, stores
    game.ts                tab adapters + game services
    automation.ts          coordinator wiring and late-bound ports
    chrome-scheduler.ts    the only automation chrome.alarms adapter
  automation/              chrome-free coordinators and helpers
  handlers/                17 per-domain bridge adapter modules
```

Ports live in `application/automation/ports.ts` (`SchedulerPort`, `EventPublisher`, `SettingsPort`, `AutomationClock`, `RunLogSink`). Coordinators receive explicit dependency objects; there is no global runtime registry. Coordinators remain physically under `contexts/background/automation/` rather than `application/<domain>/`: they are chrome-free and fully injectable, but moving them one level deeper was deferred to keep this change move-only.

## Side panel

| Metric | Before | After |
|---|---|---|
| `ui/app/SidePanelApp.tsx` | 1,916 lines | **271 lines** |
| Hooks | 0 | 18 under `ui/app/hooks/` |
| View models | inline | `ui/app/view-models/` + 24 tests |
| Polling | staggered `setInterval` calls | `usePolling` / `usePollingLoop` |

## Verification

- `npm run typecheck` — pass
- `npm run lint` — pass, 0 warnings
- `npm test` — 76 files / 321 tests pass
- `npm run build` — pass, `2.0.0-salta-dev.222`
- Bridge contract snapshot test — 103/103 types unchanged
- `wc -l contexts/background/index.ts` — 54
- No `chrome.*` in `automation/` or `handlers/`

## Intentional behavioral normalizations

1. **Helper Mode startup:** the old startup path cleared the automation alarms and then unconditionally re-created the Auto Jobs information alarm. The new bootstrap derives the clear list from the alarm route table and does not schedule any automation alarm while Helper Mode is active. This matches the Helper Mode contract (“disable all automation”) and is covered by `alarms.test.ts`.
2. **Hidden-panel polling:** polling loops now pause while the side panel is hidden and refresh once on visibility, per M10. Visible-time intervals are unchanged.

## Residual risks

- Manual smoke against a live game tab is still required for Auto Finish, Auto Expedition, Auto Jobs and Helper Mode; only typecheck/tests/build were exercised here.
- Coordinator construction order matters for the explicit `attach*` calls in `composition/automation.ts`. New coordinators must reuse the same composition root.
- `AutoJobsCoordinator.syncMarket` exposes an `unknown` value type; the wire shape is unchanged but can be tightened later.
- Side-panel hooks are behaviour-preserving by state audit, but component-level rendering tests still belong to H10.
