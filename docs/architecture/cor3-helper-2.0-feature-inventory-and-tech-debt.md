# COR3 Helper 2.0 — v1 Feature Inventory & Technical Debt Report

- **Repository:** `/mnt/x/Software/cor3-helper`
- **Scope:** v1 (git history, behavior oracle) vs v2 (`src/`, branch `v2`)
- **Method:** static source review of popup, content scripts, MAIN-world hooks, background scheduler, bridge contracts, tests, build/release config, and architecture docs
- **Status legend for v1 → v2:** `Implemented` = equivalent user capability exists; `Partial` = core exists but visible scope/behavior differs; `Missing` = no counterpart found; `Unknown` = cannot confirm without runtime QA
- **Caveat:** this is not a runtime parity sign-off. v2 is still a development build (`cor3-helper 2.0 Dev`).
- **Last verified:** 2026-11-15 against build `2.0.0-salta-dev.234`
- **Current verification:** `npm run typecheck`, `npm run lint`, `npm test` (80 files / 355 tests) and `npm run build` all pass.

## Current completion snapshot (build `2.0.0-salta-dev.234`)

| Metric | Value |
|---|---|
| TypeScript/TSX source files | 390 (including 80 test files) |
| Files under `src/` | 399 (vendored JavaScript is limited to `src/libs/`) |
| v1 parity rows with a status | 147 |
| Implemented / improved | 89 |
| Partial | 37 |
| Missing | 20 |
| Replaced by a different v2 surface | 1 |
| v2-only additions | 13 |

In percentage terms, about 61% of parity rows are implemented/improved, 25% partial and 14% missing (rounded).

Reading the numbers:

- The **automation core** (Auto Jobs/Auto Finish/Auto Jobs scheduling, loadout, Auto Expedition, Auto Drone, Auto Mail, Auto Daily, Valuable Seller) exists and is wired end to end.
- Most **Partial** rows are narrower UI scope (per-market refresh, market lot tables, debug-console filters, timers), not missing automation.
- Most **Missing** rows are v1 presentation/polish features: pop-out window, 10-theme system, pinned timers, market item INFO popup, Valuable Seller result tables, game-version notices and settings sync.
- The remaining engineering risk is concentrated in **H4** (static catalog artifact), **H10** (background/content/portal and UI tests), **M7** (unused settings) and **O-016** (settings sync). Part 6 records the loadout/decryption fixes; Part 7 records the dev.230 hardening pass; Part 8 records the dev.231 release pipeline.

---

# Part 1 — v1 User-Facing Feature Inventory

## 1. Popup Shell, Header, Localization, Theme

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Brand header (logo + COR3 Helper) | `src/html/popup.html` header row | **Implemented** | `src/ui/components/BrandHeader.tsx`; adds `SaltA Fork` subtitle |
| Pop-out window (360×700 Chrome popup) | `#popOutBtn`, `src/popup/panel-controls.js` | **Missing** | No popout button or `chrome.windows.create` in `ui/app/AppShell.tsx` / `WelcomeApp.tsx` |
| Open as side panel | `#sidePanelBtn`, `src/popup/panel-controls.js` | **Implemented** | `WelcomeApp.tsx` → `portal.openSidePanel()` |
| Refresh All (daily → markets → expeditions → inbox → mercenaries → archive → loadout) | `#refreshAllBtn`, `src/popup/refresh-all.js` | **Missing** | Only “Refresh all jobs” exists in `AutoJobsCard.tsx` |
| Per-section refresh (daily, each market, expeditions, archive, drone, inventory, loadout) | `src/popup/refresh-all.js`, feature modules | **Partial** | Expedition/drone refresh buttons in `AutoExpeditionCard.tsx`; inventory/loadout reload only on mount/action |
| Language selector (English / 简体中文) | `#langToggleBtn`, `#langDropdown`, `src/popup/i18n.js` | **Implemented** | Settings select; `src/ui/i18n.ts` + `i18n-messages.ts`. v2 auto-detects browser language once. v1 also has server-error translation maps (`ERROR_ZH`); v2 does not |
| Theme system (10 popup themes) | `#themeToggleBtn`, `#themeDropdown`, `src/popup/theme.js` | **Missing** | No theme setting or theme CSS in v2; single dark theme |
| Helper-Only Mode | `#helperModeToggle`, `src/popup/helper-mode.js` | **Implemented** | Enabled by default on fresh installs; hard-disables every automation, stops Auto Jobs/Auto Refresh market activity, and hides the Automation tab. The background snapshots the switches in `helperModeSaved` and restores them after typed consent. Adds a typed consent/warning modal |
| Version display (extension/web/system/patch) | `#versionInfoSection`, `src/popup/version-info.js` | **Partial** | v2 shows manifest version in Settings footer only; no game web/system/patch tracking |
| Check for Updates | `#checkUpdateBtn`, `#updateResult`, `version-info.js` | **Partial** | `src/infrastructure/update/update-checker.ts` checks `package.json` on GitHub; UI in `SettingsPage.tsx`. Extension only, no game version comparison |
| Website-updated notices | `#webVersionNotice`, `#systemVersionNotice`, `#patchVersionNotice` | **Missing** | No game-version keys or notices |
| Fork/upstream links | `src/popup/fork-config.js` | **Implemented** | `ui/app/fork-info.ts`; Settings footer Fork/Releases/Issues/Upstream |
| Footer status text | `#status`, `src/html/popup.html` | **Replaced** | Header chips `OK/OFFLINE`, `AUTH/NEEDS REFRESH`, `ENDPOINT` in `AppShell.tsx` |
| Last-updated timestamps | `src/popup/timestamps.js`, `.last-updated` DOM ids | **Missing** | No per-section timestamps; only market/snapshot ages |
| Popup/side-panel layout | `src/popup/panel-controls.js` | **Partial** | v2 toolbar popup is a launcher; full workspace is side-panel-only |
| Welcome launcher | v1 popup was the full UI | **Implemented (v2-only)** | `WelcomeApp.tsx` |
| Settings export/import/reset | No v1 equivalent | **Implemented (v2-only)** | `SettingsPage.tsx`; `settings.export/import/reset` in background |
| Session panel | Scattered in v1 | **Implemented (v2-only)** | Auth/endpoint/snapshot/readiness in `SettingsPage.tsx` |
| Developer mode toggle | No visible v1 toggle | **Implemented (v2-only)** | Settings; defaults on |
| Related community links | v1 only fork/upstream links | **Implemented (v2-only)** | Game, site, Discord, X, community guide |

## 2. Overview, Markets, Jobs, Auto-Job Solver

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Market panels (HOME/D4RK/SOYUZ/USOL: credits, reputation, reset, items, jobs) | `#marketsPanelSection`, `src/popup/markets.js` | **Partial** | Four job markets + reputation UI; market lots are mapped but not rendered |
| Collapsible market panels | `market-toggles.js` | **Implemented** | Market tabs + collapsible lists via `JobMarketList.tsx` |
| Market items list + INFO popup | `renderMarketInto`, `showMarketInfoPopup` | **Missing** | No lot list or item-detail modal |
| Market jobs list (status/server/reward/penalty) | `markets.js` | **Partial** | `JobMarketList.tsx` shows status/server/reward/reputation. v2 sorts by status then name; v1 sorted by server. Normal rows omit deposit/penalty |
| Market reputation/credits | `markets.js` | **Partial** | Progress page shows all four reputations; Overview shows home credits only |
| Market availability warnings (blocker server/maintenance) | `render*Market` in `markets.js` | **Partial** | Error text + maintenance list; no per-market blocker banner |
| Per-market refresh | `#refresh*MarketBtn` | **Partial** | Only global “Refresh all jobs” |
| Per-market failed-job cleanup | `#cleanup*MarketBtn` | **Partial** | Only global auto-submit, no per-market manual cleanup |
| Submit failed/expired jobs | v1 manual per-market cleanup | **Partial / improved** | `autoDismissFailedJobsEnabled`, toggle + background cleanup; v2 submits game-reported failed/expired jobs automatically |
| Auto Update Markets | `#autoUpdateMarketsToggle`, `src/content/auto-update-markets.js` | **Partial** | No setting; Auto Jobs scheduler refreshes at interval/reset |
| Auto-refresh jobs at reset | `#autoRefresh*`, `src/content/auto-refresh.js`, pinned timers | **Partial** | Global scheduler only; no per-market Auto checkbox |
| Pinned timers (daily/markets/expedition/drone) | `#pinnedTimersSection`, `pinned-timers.js` | **Missing** | Overview has unpinnable timers; no `pinnedTimers` setting |
| Auto Job Solver UI toggle | `#autoJobSolverToggle` | **Implemented with difference** | Auto Jobs card always rendered; Helper Mode hides the tab |
| Job market tabs | `#autoJobsTabHome` etc. | **Implemented** | `JobMarketList.tsx` |
| Job type filters (9 types, per-market, select all) | `autoJobsSelectedTypes`, `auto-job-solver-ui.js` | **Partial** | Global `autoCompleteJobTypes` checkboxes + per-job manual selection; no per-market type matrix |
| Start/stop selected jobs, progress, cancellation | `#autoJobsStartBtn` | **Implemented** | `AutoJobsCard.tsx`, `application/auto-job/queue.ts` |
| Auto Finish All Jobs (reset scheduling, retries, maintenance-aware) | `#autoFinishAllJobsToggle`, `src/background/auto-finish-jobs.js` | **Implemented** | `runAutoFinish`, `scheduleNextAutoJobsRefresh`, retry/deferred logic |
| Debug console (Jobs + Logs tabs, copy all) | `#autoJobsDebugConsole`, `#copyAllLogsBtn` | **Partial** | Merged “Status and report” + debug console; no separate job table |
| Job history / locks | `autoJobsTracker`, `autoJobsLockedJobs` | **Implemented** | Persisted history store + locks; history is shown under Extension Status on the Overview page |
| 9 supported job types | `src/auto-job-solver/solvers.js` | **Implemented** | `domains/jobs/model.ts`, `execution-service.ts` |
| Path-through/maintenance/auto loadout | `steps.js`, `helpers.js`, `shared/loadout-resolver.js` | **Implemented with caveat** | Dynamic routing + capability preflight. File Decryption applies a targeted DECRYPT plan before `take`; a known file type never falls back to unrelated DECRYPT software. Job ordering differs (live route length vs v1 furthest-first table) |
| Overview activity/credits/market summary/timers | No single v1 panel | **Implemented (v2-only)** | `OverviewPage.tsx` |
| Progress page (network + market reputation) | No v1 page | **Implemented (v2-only)** | `ProgressPage.tsx` |

## 3. Expeditions / Mercenaries

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Mercenaries / Drone mode tabs | `#expModeTabs` | **Implemented** | `AutoExpeditionCard.tsx` |
| Active expedition cards (location/status/merc/cost/risk/insurance/timer/pin/reward container) | `#expeditionInfoContainer`, `expeditions.js` | **Partial** | Location/merc/status/ETA/cost/risk; missing insurance, elite badge, reward-container preview, pin |
| Archived expeditions (outcome/faction/loot images/time) | `archived-expeditions.js` | **Partial** | Ready/archived merged into active list; no dedicated archive or loot detail |
| Mercenary Auto Expedition (select/launch/pay/claim) | `#autoSendMercenaryToggle`, `content/auto-send.js`, `ws-relay.js` | **Implemented** | `AutoExpeditionCard.tsx`, `runAutoExpedition`, `ExpeditionService` |
| Auto-select mercenary | `ws-relay.js` | **Implemented with differences** | Configurable mode/order; default `core, usol, usol-elite` vs v1 elite→USOL→CORE |
| Insurance | `#mercInsuranceToggle` | **Implemented** | `mercInsuranceEnabled` |
| Maximum mercenary price | No v1 UI | **Implemented (v2-only)** | `mercMaxPriceEnabled/mercMaxPrice` |
| Minimum credits / stop below | No v1 UI | **Implemented (v2-only)** | `mercMinCreditsEnabled/mercMinCredits` |
| Mercenary market order | Fixed v1 policy | **Implemented (v2-only configurable)** | `mercMarketOrder` |
| In-mission decisions | v1 always aggressive | **Implemented with difference** | Policy select, default **off** |
| Preparation flow | v1 ~10 s wait | **Implemented with difference** | Explicit 30 s preparation + cancel |
| Payout / open reward container | `open.container` | **Implemented** | `ExpeditionService.payout` |
| Rewards to mailbox | `mail.js` | **Implemented** | Payout → `runAutoMail()`; see mailbox scope caveat |
| Mercenary warnings/pause reasons | `#mercWarning` | **Partial** | Last-run/error text; no full pause taxonomy banner |
| Expedition location/goal | v1 hardcoded names | **Implemented with difference** | Static ID profiles in `domains/expeditions/profiles.ts`, read-only UI |

## 4. Personal Drone

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Drone status card (durability/battery/repair/destroyed/ETA) | `#personalDroneContainer`, `drone.js` | **Implemented** | `AutoExpeditionCard.tsx` bars/countdowns |
| Active drone mission | `#droneActiveContainer` | **Partial** | Location/mission/risk/battery/duration; no pin |
| Archived drone missions + loot | `#droneArchivedContainer` | **Partial** | Archived IDs mapped; not rendered |
| Auto drone expedition | `#autoDroneToggle`, `content/drone.js` | **Implemented** | `application/drone/auto.ts`, `runAutoDrone`; fixed target |
| Auto repair | v1 fixed threshold | **Implemented with config** | `droneRepairEnabled`, threshold, repair-on-charge |
| Repair while charging | v1 implicit | **Implemented (v2-only setting)** | `droneRepairOnCharge` |
| Drone decision policy | v1 always aggressive | **Implemented with difference** | Policy select, default **off** |
| Rewards to mailbox | `COR3_CHECK_MAIL` source `DRONE_MISSION` | **Partial** | Auto-mail runs on completion, but `droneAutoSendEnabled` is displayed and not consumed |
| Rate-limit/busy retry | v1 20/40/60 s + 3-strike disable | **Partial** | One 60 s retry; no 3-strike policy |
| Pin drone mission timer | `.pin-exp-btn` | **Missing** | No pinning |

## 5. Daily Ops / Daily Rewards / Auto Daily

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Daily Ops panel (next task/claimed/streak/difficulty/bonus/refresh/pin) | `#dailyOpsAutomationPanel`, `daily-ops.js` | **Partial** | Claimed/streak/bonus/next task; no difficulty, refresh, or pin |
| Auto Daily Hacking (open/start/solve/close/retry/lock) | `#autoDailyHackToggle`, `daily-hack-solver.js` | **Implemented** | `main-world/daily-solver.ts`, background `runAutoDailyHack` |
| Daily scheduling / next check / retry | `dailyHackNextCheckAt` | **Implemented** | `AutoDailyCard.tsx`, `application/daily-ops/schedule.ts` |
| Daily diagnostics log (copy/clear) | `#dailyHackDiagDetails`, `#copyDailyHackDiagBtn` | **Partial** | Merged debug logs; no daily-specific clear/copy |
| Daily rewards / streak bonus | `dailyRewardsData` | **Implemented** | Mapped + shown |
| Run daily hack once | No v1 UI | **Implemented (v2-only)** | “Run once” |

## 6. Inventory

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Inventory view (grouped/rarity/images/tags/quantity) | `#inventoryPanelSection`, `inventory.js` | **Implemented** | `InventoryPage.tsx` |
| Duplicate merging / ×N | `inventory.js` | **Implemented** | `groupItems()` |
| Capacity / total value | `#spaceInfo`, `#totalValue` | **Implemented** | Summary row |
| Text filter | No v1 filter | **Implemented (v2-only)** | Filter input |
| Batch sell (rarity/tag/count/value/confirm) | `#invBatch*`, `inventory-batch.js` | **Implemented with restrictions** | v2 only exposes COMMON/RARE and protects >RARE/craftable |
| Tier/tag safety rules | v1 allowed selected tier | **Partial / safer** | v2 always protects >RARE and craftable single sell |
| Single-item sell | `.sell-btn` | **Implemented with restrictions** | Overlay sell; no second-click confirmation; protection rules |
| Item INFO popup | `.inv-info-btn` | **Missing** | No item-detail modal |
| Smart/Compact warehouse sort | `#invSort*`, `src/content/stash-sort.js` | **Implemented** | `application/inventory/sorter.ts`; two-click confirmation, progress and final summary |
| Sorting-table handling | `stashSorting`, `stashSortProgress` | **Implemented** | Warn/disable + auto-mail pause |
| Stash expansion timer/grace/extend | `#specialistTimerInfo`, `purchaseSpecialist` | **Implemented** | Inventory expansion panel shows active remaining time, expiry/grace and purchase/extend offers |
| Mailbox auto-collect control | No v1 popup control | **Implemented (v2-only UI)** | `InventoryPage.tsx` switch |
| Last updated | `#inventoryLastUpdated` | **Missing** | No timestamp |

## 7. Loadout

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Hardware viewer (CPU/GPU/RAM/PSU specs) | `#loadoutHwContainer`, `loadout.js` | **Implemented** | `LoadoutPage.tsx` |
| Hardware replacement search + equip | `loadout.js` | **Implemented** | Change modal |
| Software list (installed/owned/power/consumption/targets) | `#loadoutSwContainer` | **Implemented** | `LoadoutPage.tsx` |
| Software filters (All/Hack/Decrypt/Search/View/Load + search) | `#loadoutSwSort`, `#loadoutSwSearch` | **Partial** | No View/Load filters |
| Install/uninstall software | `.loadout-sw-install-btn` | **Implemented** | INSTALL/UNINSTALL |
| System overview (supply/demand, bootable) | `#loadoutOverviewContainer` | **Implemented** | System Summary |
| Recommended/weakest loadout | No v1 popup UI | **Implemented (v2-only)** | Apply optimized/weakest |
| Power/target selectors | No v1 popup UI | **Implemented (v2-only)** | Ability/target/power |
| Copy loadout | No v1 UI | **Implemented (v2-only)** | Copy button |
| Loadout error/refresh/last updated | `#loadoutError`, `#refreshLoadoutBtn`, `#loadoutLastUpdated` | **Partial** | Feedback line; no explicit refresh/last-updated |

## 8. Mailbox

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Auto-claim expedition/drone mail (serial `claim.all`, retries, `claim.item` fallback, stash-full queue) | `src/content/mail.js` | **Implemented with important difference** | `MailService` + placement fallback. **v2 `claimPending()` claims every pending message, not only `EXPEDITION`/`DRONE_MISSION`** |
| Source tracking | `_sourceById`, `_watched`, `_seenSources` | **Partial** | `ChromeStorageMailSourceTracker` exists and is used by `claimForSource`; auto-collect does not filter sources |
| `claim.all` → `claim.item` fallback | `tryItemFallback`, `planAttachmentPlacements` | **Implemented** | `MailService.tryFallback`, `placement.ts` |
| Stash-full handling | `isCapacityError`, `handleClaimFailure` | **Implemented / improved UI** | Capacity detection + retry alarm + “stash full” status |
| Pause auto-claim while sorting | `stashSorting`, gameplay check | **Implemented** | Background `inventorySorting` check |
| Manual mailbox claim | No v1 UI | **Implemented (v2-only)** | Inventory exposes “Claim mailbox now”; portal calls `claimPendingMail` |
| Mail warning/status | `mailWarning` (not rendered in v1 popup) | **Implemented (v2-only UI)** | Result/error/stash-full line |

## 9. Valuable Seller

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Enable/show Valuable Seller UI | `#autoValuableSellerToggle` | **Missing** | Card always visible |
| Search all servers (furthest-first, strongest SEARCH loadout, download) | `#valuableSearchBtn`, `auto-valuable-seller/*` | **Implemented** | `ValuableSellerCard.tsx`, `application/valuable/seller.ts` |
| Download only valuable files/logs | `filterValuableFiles/Logs` | **Implemented** | `domains/valuable/model.ts` |
| Sell to markets (USOL → SOYUZ → D4RK → HOME) | `MARKET_SELL_ORDER` | **Implemented** | `valuableMarkets()` reversed market list |
| Select servers/downloads before selling | `#valuableTabServers`, `#valuableTabDownloads` | **Missing** | Sells all downloaded valuables |
| Server results table | `renderValuableServers` | **Missing** | No table |
| Download results table | `renderValuableDownloads` | **Missing** | No table |
| Maintenance tab + “Force selected” | `#valuableTabMaintenance` | **Missing** | No maintenance/force UI |
| Search/sell start-stop/progress | `#valuableSellerBtn` | **Implemented with difference** | Status/report only, no detailed tables |
| Valuable debug console | `#valuableDebugConsole` | **Partial** | Merged automation debug; no per-feature toggle |

## 10. Specialists, Pinned Timers, Notifications, QoL

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Specialist / stash expansion timer (expiry/grace/loss/extend) | `#specialistTimerInfo`, `inventory.js` | **Implemented** | Inventory expansion panel shows active rental remaining time, expiry/grace and extend offers |
| Purchase/extend specialist | `#stashExtendBtn` | **Implemented** | Inventory expansion panel shows active remaining time and purchase/extend offers |
| Pinned timers panel | `#pinnedTimersSection` | **Missing** | No pin state/component |
| Auto-refresh next to pinned timer | `.pinned-auto-refresh` | **Partial** | Global scheduler; no per-market toggle |
| Move in-game notifications left | `#moveNotificationsToggle` | **Implemented** | `moveNotificationsLeft` setting applied by `src/contexts/content/qol.ts` |
| Disable desktop glitch/wave background | `#disableBackgroundToggle` | **Implemented** | `disableBackground` setting applied by `src/contexts/content/qol.ts` |
| Disable network fog videos | `#disableNetworkFogToggle` | **Implemented** | `disableNetworkFog` setting applied by `src/contexts/content/qol.ts` |
| Info panel visibility toggle | `#marketsPanelToggle` | **Missing** | Per-card open state only |
| Anti-AFK clicker | `ensureAntiAfkEnabled`, `content-early/message-listener.js` | **Implemented** | `antiAfkEnabled` setting; content QoL clicks the desktop every three minutes |
| Secret Link/Server Finder | `#secretFinderToggle`, `content-early/network-discovery.js` | **Partial** | Manual Discover 4 IPs in Developer page; no auto toggle/log |
| Startup/background market updates | `content-early/initial-fetch.js` | **Implemented** | Snapshot/market sync + Auto Jobs alarms |

## 11. Logging, Debug, DevTools, Standalone Tools

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Per-feature debug consoles (Auto Jobs, Valuable) | `#autoJobsDebugConsole`, `#valuableDebugConsole` | **Partial** | Merged `AutomationDebugCard` / `DebugConsole` |
| Error log store (source/message/stack, max 200) | `src/libs/errors.js`, `cor3_errors` | **Implemented** | Structured logger + run log store |
| Page/extension console capture | `src/libs/console-logger.js`, DevTools categories | **Partial** | Merged DevTools logs; no separate categories |
| DevTools WS Inspector (filters/tree/search/pagination/resizable) | `src/html/devtools-panel.html`, `src/devtools-panel/*` | **Partial** | Basic diagnostics/logs/bridge/WS/storage; missing advanced inspector |
| DevTools export JSON/MD | `#btnExportJson`, `#btnExportMd` | **Implemented** | `DevToolsPanel.tsx` exports JSON and Markdown |
| DevTools clear per category | `#btnClear` | **Implemented** | Per-category clear for logs, bridge requests and WS frames |
| DevTools send WS message | `#sendInput`, `#btnSend` | **Implemented** | Frame input + `Send WS` action |
| Offline log viewer | `src/html/devtools-log-viewer.html` | **Implemented** | `src/contexts/devtools/log-viewer.tsx` renders saved logs without a live page |
| IndexedDB retention / 24 h cleanup | `src/libs/ws-messages.js` | **Partial** | In-memory/session logs; no 24 h purge |
| Standalone minigame solvers (ConfigHack/Simple/ICE Wall/Daily) | `src/standalone/*` | **Implemented** | `main-world/minigame-solver.ts`, `ice-wall-solver.ts`, `daily-solver.ts` |
| Solver status lines | `#iceWallSolverStatusLine`, `#simpleDecryptSolverStatusLine` | **Partial** | Switches only |
| WS interceptor | `src/content-early/ws-proxy.js` | **Implemented** | `game-socket-hub.ts`, MAIN-world script |
| Hidden Dev TCs section | `src/popup/dev-tcs.js` (unreachable) | **Missing / non-visible** | No counterpart |
| Developer page diagnostics | v1 console helpers/DevTools | **Implemented (v2-only)** | `DeveloperPage.tsx`, DevTools panel |

## 12. Version, Updates, Settings Persistence

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Settings persistence | `chrome.storage.sync` + local data | **Implemented** | `SettingsRepository` + `chrome.storage.local` |
| Settings sync across profiles | `chrome.storage.sync` | **Missing** | local only; export/import is the migration path |
| Settings backup/reset | No v1 UI | **Implemented (v2-only)** | Settings page |
| Extension update check | `#checkUpdateBtn`, `version-info.js` | **Partial** | GitHub `package.json`, extension only |
| Game version tracking (web/system/patch) | `webVersion`, `systemVersion`, `patchVersion` | **Missing** | No keys/UI |
| Bearer token handling | v1 persisted `bearerToken` in local | **Improved / different** | In-memory session; no persistence |
| Cache + real-time updates | v1 storage + WS listeners | **Implemented** | v2 caches + storage/event subscriptions |
| Version/update footer links | `version-info.js`, `fork-config.js` | **Implemented** | Settings footer |

## 13. v2-Only Additions

| Feature | v2 evidence | Notes |
|---|---|---|
| Extension activity/credits panel | `OverviewPage.tsx` | Activity, progress, home credits |
| Overview market summary + next refresh | `OverviewPage.tsx` | Per-market jobs/skipped/failed |
| Network overview / reputation page | `ProgressPage.tsx` | Server/connection counts, four reputations |
| Recommended/weakest loadout + copy | `LoadoutPage.tsx` | v1 only manual equip |
| Settings export/import/reset | `SettingsPage.tsx` | v1 had no backup path |
| Helper Mode consent modal | `SettingsPage.tsx`, `WelcomeApp.tsx` | Typed localized phrase |
| Developer tab | `DeveloperPage.tsx` | Runtime/network/diagnostics/debug |
| DevTools bridge/WS/storage inspection | `ui/devtools/DevToolsPanel.tsx` | New diagnostics surface |
| Related community links | `fork-info.ts` | Game/site/Discord/X/guide |
| Configurable mercenary price/min credits/order/selection | `AutoExpeditionCard.tsx` | v1 fixed policy |
| Configurable drone repair/decision policy | `AutoExpeditionCard.tsx` | v1 fixed thresholds/aggressive |
| Per-job manual selection + cancellation progress | `JobMarketList.tsx`, `AutoJobsCard.tsx` | v1 used market/type checkboxes |
| Auto submit failed/expired jobs | `AutoJobsCard.tsx`, `dismiss.ts` | v1 only manual per-market cleanup |

## 14. Major Parity Gaps and Behavioral Differences

### Missing v1 user features

1. Global Refresh All and most per-section refresh buttons.
2. Theme system (10 themes).
3. Pop-out window and multi-column popup layout.
4. Pinned timers and per-market auto-refresh-on-zero.
5. Market items list and item INFO popup.
6. Per-market failed-job cleanup and per-market job-type filters.
7. Valuable Seller server/download selection tables and Maintenance / Force selected.
8. Game version tracking / website-updated notices.
9. Settings sync across Chrome profiles.
10. DevTools advanced tree/search/pagination inspector (export, clear, send-WS and offline viewer are implemented).
11. Per-solver status lines and daily-hack diagnostic copy/clear.
12. Hidden Dev TCs / reachability tool (already unreachable in v1 source).

### Behavioral differences to review

1. **Helper Mode:** both restore previous automation values; v2 requires typed consent and uses a `helperModeSaved` snapshot.
2. **Decision policies:** v1 always aggressive; v2 defaults merc/drone decisions to off.
3. **Mailbox scope:** v1 claims only `EXPEDITION`/`DRONE_MISSION` mail and only when the matching automation is enabled; v2 `claimPending()` claims all pending messages.
4. **Batch selling:** v1 allows COMMON/RARE/SUPERRARE/EPIC; v2 exposes COMMON/RARE and protects >RARE/craftable.
5. **Inventory sorting:** both require confirmation; v2 reports a final summary and pauses mailbox auto-claim.
6. **Mercenary order:** v1 elite→USOL→CORE; v2 default `core, usol, usol-elite`.
7. **Settings storage:** v1 sync; v2 local only.
8. **Drone reward toggle:** `droneAutoSendEnabled` is displayed/persisted but not consumed by `DroneAutoService`.
9. **Drone retries:** v2 has one 60 s retry; v1 had 20/40/60 s and 3-strike disable.
10. **Market labels/credits:** v1 dynamic names and per-market credits; v2 static labels and home credits.
11. **Job ordering:** v2 uses live route length; v1 used a hardcoded furthest-first priority table.

### Uncertain / needs runtime QA

- Whether v2’s “claim all pending mail” is intentional.
- Whether `droneAutoSendEnabled` should gate mailbox claims.
- Whether route-length-based job ordering is an intended replacement for v1’s priority table.
- DevTools/log retention/parity.

## Appendix A — Settings/Storage Keys

**v1 `chrome.storage.sync`:** `selectedTheme`, `uiLang`, `helperMode`, `oldValues`, `pinnedTimers`, `autoRefresh`, `autoJobSolverEnabled`, `autoJobsSelectedTypes`, `autoJobsDebugConsoleEnabled`, `autoFinishAllJobsEnabled`, `autoValuableSellerEnabled`, `valuableDebugConsoleEnabled`, `autoDecryptEnabled`, `autoIceWallEnabled`, `autoSimpleDecryptEnabled`, `autoDailyHackEnabled`, `disableBackground`, `disableNetworkFog`, `moveNotificationsLeft`, `autoUpdateMarkets`, `secretFinderEnabled`, `autoSendMerc`, `autoDrone`, `marketsPanelEnabled`.

**v1 `chrome.storage.local` (main):** market caches (`marketData`, `darkMarketData`, `soyuzMarketData`, `usolMarketData`), provider availability/maintenance keys, `expeditionsData`, `expeditionDecisions`, `archivedExpeditionsData`, mercenary/config caches, `droneData`, `droneMissionData`, `droneArchivedData`, `droneCompleted`, `droneWarning`, `stashData`, `stashSorting`, `stashSortProgress`, `stashSortNotice`, `gameplayData`, `loadoutData`, `loadoutError`, `specialistsData`, `mailData`, `mailWarning`, `autoJobs*`, `valuable*`, `webVersion`, `systemVersion`, `patchVersion`, `serverMaintenanceMap`, `networkMapData`, `automationQueueStatus`, `cor3_errors`, `bearerToken`.

**v2:** all user settings under `v2.settings` in `chrome.storage.local`; data stores include `v2.market.cache`, `v2.network.snapshot`, `v2.job.history`, `v2.mail.sources`, `v2.auto-finish.state`, `v2.auto-jobs.snapshot`, `v2.dailyOpsCache`, `v2.expeditionConfigCache`, `v2.droneDataCache`, `v2.automationState`, `v2.discovery.progress`, `v2.featureAvailability`.

## Appendix B — v1 WS/API Surface

- `network-map`: `get.map`, `set.endpoint`, `maintenance`, `connect.ip`
- `sai`: `get.login.status`, `login.with-access`, `hack.start`, `get.files`, `file.download`, `get.logs`, `log.delete`, `log.download`, `get.transit`, `transit.add`, `transit.remove`, `file.delete`, `file.upload`, `file.search-valuable`, `log.search-valuable`
- `market`: `get.options`, `get.lots`, `get.jobs`, `job.take`, `job.complete`, `job.can-complete`, `get.sellable-items`, `sell.items`
- `stash`: `get.state`, `update.state`, `move.item`, `sell.item`
- `mail`: `get.state`, `update.state`, `claim.all`, `claim.item`
- `expeditions`: `get.mercenaries`, `get.config`, `configure`, `launch`, `open.container`, `insert.archive`, `update`, `get.archived`
- `drone-missions`: `get.options`, `launch`, `resolve.event`, `repair`, `claim`, `update`, `completed`, `get.archived`
- `desktop`: `open.folder`, `update.file`, `open.file`, `decrypt.file`, `get.file.analysis`, `get.options`
- `minigames`: `start.minigame`
- `profile`: `receive.progress`, `receive.credits`
- `specialists`, `loadout`, `gameplay update.state`, `updater get.patches`

---

# Part 2 — v2 Technical Debt Audit

> **Historical audit snapshot (baseline 2026-11-08).** This part records the debt found before the v2 remediation work. It is retained as evidence, not as current status. Parts 3–6 track what was fixed and what is still open; use them for planning.

## Severity model

- **High:** can break releases, security, automation correctness, or core parity.
- **Medium:** architectural drift, real but contained correctness/operability risk.
- **Low:** maintainability, consistency, polish.

## Top 10 priorities

1. **Release pipeline is broken for 2.0** — workflow builds `dist` then zips the ignored/stale v1 `dist`.
2. **Two parallel cross-context protocols** — typed bridge plus ~50 unversioned `V2_*` raw messages; docs claim every message uses the envelope.
3. **Endpoint mutations race outside the queue/lease** — UI polling and market-options paths call `set.endpoint` directly.
4. **Static item catalog is not wired** — runtime builds a “catalog” from owned items only; catalog CLI/artifacts are effectively dead.
5. **Loadout capability cache is time-only (15 s), no inventory invalidation** — exactly the class of bug ADR 11.7 warns about.
6. **Redaction misses camelCase keys and session IDs** — plus `RunLogStore` is unredacted and exposed to DevTools.
7. **Job type is inferred from the display name** — localization/rename silently disables all jobs.
8. **Background is a ~4,575-line composition root with ~98 bridge handlers** — scheduling, routing, business logic, and adapters in one file.
9. **Unversioned persisted stores and no migrations** — caches/automation state silently reset or go stale.
10. **No CI typecheck/test/lint; no integration tests for background/content/UI** — unit tests pass, but critical orchestration is untested.

## High severity

| # | Area | Evidence | Risk | Recommended fix |
|---|---|---|---|---|
| H1 | Build / release | `.github/workflows/release.yml:36-39` runs `npm run build` (→ `build.js` → `dist`), then zips `dist` (v1). `dist` is gitignored. | Tagged releases ship nothing or stale v1 code; 2.0 cannot be released. | Add a v2 release job that zips `dist`; add CI typecheck/test/lint; verify manifest identity/version. |
| H2 | Cross-context architecture | `src/contexts/content/index.ts` implements ~50 raw `V2_*` handlers; `infrastructure/auth/chrome-tabs-message-port.ts` sends raw `chrome.tabs.sendMessage`. `ARCHITECTURE.md` claims all messages use a typed/versioned envelope. | Protocol drift, no request IDs/timeouts/versioning, duplicate maintenance; docs are false. | Move tab commands onto `BridgeClient`/`BridgeServer` (or a typed command contract with version + correlation) and delete the raw channel. |
| H3 | Endpoint races | `contexts/background/index.ts` `fetchMarketOptionsView` and `routeToServer` call `endpointCommands.setEndpoint` before/without `networkOps`/lease. UI polls four markets every 60 s. `RouteExecutor` never checks current endpoint. | Opening Progress can change the endpoint every minute, racing Auto Jobs; no single owner. | Route endpoint mutations through `NetworkOperationQueue` + `EndpointLease`; skip hops already at target; make progress reads cache-first. |
| H4 | Static catalog | `infrastructure/game-ws/loadout-mapper.ts` builds `catalogVersion: 'runtime'`, `gameVersion: 'unknown'` from owned items. Catalog builder/CLI exists; no artifact is committed. The loader now merges the artifact with the runtime catalog (dev.230). | The split is implemented, but without an artifact the catalog still only contains player-owned items, so the optimizer cannot reason about unowned definitions. | Generate and commit a real module-dump artifact; keep the merge behavior (O-014). |
| H5 | Loadout cache correctness | `application/loadout/service.ts`: capability cache key is ability/target/power/fallback with 15 s TTL; runtime cached separately and never invalidated on equip/inventory change. | Stale feasible/infeasible decisions, wrong preflight, historical “0 equipped software” class. | Key by inventory fingerprint + catalog version + policy version; invalidate on loadout/inventory events; explicit hook. |
| H6 | Secrets / logging | `infrastructure/logging/logger.ts` redacts exact `jwt`/`token`/hyphenated keys; `jwtToken`, `accessToken`, `refreshToken`, `sessionId`, `apiKey` pass. `run-log-store.ts` stores raw message/data and is served to DevTools. | Token/session leakage into DevTools/exported diagnostics. | Broaden key matching (camel/snake variants, `session*`, `*api*key*`), redact at ingestion, add tests. |
| H7 | Job schema assumption | `application/auto-job/market-mapper.ts` validates `raw.name` against `JOB_TYPES` and sets `type: raw.name`; ignores `raw.jobType`. | Localization/rename silently marks every job unsupported. | Map from machine `jobType`; keep display names separate; fixtures for localized rows. |
| H8 | Background god module | `contexts/background/index.ts` ~4,575 lines, ~98 handlers plus alarms/routing/business logic. `SidePanelApp.tsx` ~1,860 lines. | High merge/regression risk; hard to test. | Split into context composition + per-automation application services; small handler modules. |
| H9 | Persistence/versioning | Unversioned stores: `daily-ops-cache-store`, `drone-data-cache-store`, `expedition-config-cache-store`, `feature-availability-store`, `automation-state-store`. `versioned-repository` discards incompatible data with no migration. `contracts/storage.ts` makes settings enums depend on `JOB_TYPES`. | Caches/settings silently reset; removing a job type invalidates all settings. | Version every persisted value; idempotent migrations; decouple settings from domain enums. |
| H10 | Untested critical paths | 80 test files vs 390 TypeScript/TSX source files (399 files under `src/`). The dev.230 pass added a decrypt-pipeline integration test, store-migration tests and an architecture-boundary test, but background/content/portal orchestration and UI rendering still lack integration tests. Vitest uses node env; no coverage thresholds/fake timers. | Orchestration/races/migrations regress invisibly; UI mostly untestable. | Integration tests with fake tab transport/clock; migration/redaction tests; jsdom component tests. |

## Medium severity

| # | Area | Evidence | Risk | Recommended fix |
|---|---|---|---|---|
| M1 | UI calls infrastructure/browser APIs | `ui/devtools/DevToolsPanel.tsx` imports `BridgeClient`; uses `indexedDB`/`localStorage`/`chrome.devtools.inspectedWindow.eval`. | DevTools UI untestable; bypasses portal/contracts. | DevTools portal in application; inject from context; move eval to adapter. |
| M2 | Domain logic in UI | `SidePanelApp.tsx` imports jobs/drone/expedition domain code; `AutoExpeditionCard` computes domain state; `LoadoutPage` imports calculator. | Presentation owns rules; duplication; parity drift. | Move calculations into view models; components consume view models/callbacks. |
| M3 | Boundary schemas in application | `application/game/readiness.ts`, `application/network/summary.ts`, `application/drone/map.ts` import Zod. | Zod leaks out of contracts; boundary ownership unclear. | Move schemas to `contracts/`; keep application/domain Zod-free. |
| M4 | Contract layering inversion | `contracts/storage.ts`, `contracts/jobs.ts`, `contracts/catalog.ts`, `contracts/auto-jobs.ts` import domains. | Contracts depend on domain constants/types; cycles and persisted-schema coupling. | Move shared enums/DTO types into contracts/kernel. |
| M5 | Infrastructure imports application behavior | `infrastructure/game-ws/game-socket-hub.ts` imports `isGameReady` from application. | Layering inversion. | Move readiness policy to domain/contracts or type-only import. |
| M6 | Unwired portal API / dead surface | `application/popup/portal.ts`: `jobHistory`, `autoRespondExpeditions`, `autoLaunchExpedition`, `autoSendExpeditions`, `claimExpeditionRewards`, `configureExpedition`, `autoExpeditionRun`, `droneLaunch`, `droneRepair`, `mailView`, `claimMail`, `claimPendingMail`, `purchaseSpecialist` never called by UI. | Either missing UI or dead code. | Verify parity checklist; wire or delete each method/handler. |
| M7 | Unused/dead settings | `mercLocationId`, `mercGoalId` have zero non-schema references; `mailAutoClaimIntervalMinutes` is ignored (hardcoded 45); `droneLocationId`/`droneGoalId` overridden by fixed target config. | Settings that do nothing; migration confusion. | Remove or implement; honor interval argument. |
| M8 | Event subscription does not survive SW restart | `chrome-popup-portal.ts` opens a port once; `SidePanelApp.tsx` subscribes once with no reconnect when MV3 worker suspends. | UI gets no events after restart; status looks frozen; relies on polling. | Reconnect with backoff on disconnect, or durable event log + poll cursor. |
| M9 | In-memory queue/lease on MV3 | `operation-queue.ts` and `endpoint-lease.ts` hold state only in memory; `automation-state-store` lease acquisition is read-modify-write without serialization and treats same owner as reentrant. | Worker suspension drops queued work/lease; duplicate runs possible. | Persist queue/lease or make operations resumable/idempotent; serialize leases; distinct owner IDs. |
| M10 | Redundant/staggered polling | `SidePanelApp.tsx`: 1 s activity/job/expedition-prep, 2 s activity, 5 s auto-finish/valuable/snapshot, 15 s readiness/expeditions/daily, 30 s credits, 60 s market progress; DebugConsole 2 s; DevTools 3 s × 4 requests. | Command storms/rate limits; overlapping intervals. | Visibility-aware scheduler; cache-first polls; pause when hidden. |
| M11 | Permissive boundary schemas | `contracts/market.ts` uses `z.unknown` for options/lots/jobs; mail/expedition/drone/loadout schemas tolerant; `mapMarketView` defaults credits to 0. | Shape changes silently become empty/zero data. | Keep tolerance but add “unrecognized shape” diagnostics/typed errors; validate automation-critical fields. |
| M12 | Home server detection by name | `infrastructure/game-ws/network-map-mapper.ts` matches `serverTypeName === 'Home'` / `serverName === 'Home Server'` and throws if absent. | Localization/rename breaks entire map. | Use stable config/type id or endpoint flag; return `HOME_NOT_FOUND` and degrade. |
| M13 | Loadout fragility | `application/loadout/raw-mapper.ts` throws on unknown hardware category; `contracts/loadout.ts` rejects whole payload if one software spec is malformed. | One bad item disables all loadout/automation. | Map unknown items to unsupported; skip bad records; never invalidate the snapshot. |
| M14 | Non-null assertion in job execution | `application/auto-job/execution-service.ts` uses `job.serverId!` after only checking the file name. | Unexpected throw for upload jobs missing server. | Add explicit `NO_SERVER` guard. |
| M15 | Docs drift | ADR status/progress, `MODULES.md`, `CONTRIBUTING.md`, `SECURITY.md` and the feature inventory drifted from the implementation. | Contributors/agents follow stale guidance. | Refresh the docs and make docs part of DoD. **Addressed on the `v2` branch.** |
| M16 | i18n architecture | `ui/i18n.ts` + `ui/i18n-messages.ts` use exact-English-source dictionary alongside semantic keys; ADR requires key-based catalog. DevTools hardcoded English; some labels hardcoded. | Renames silently fall back to English; no coverage metric. | Consolidate on semantic keys; move DevTools/hardcoded labels; add completeness test. |
| M17 | Release/version debt | `package.json` still needs a manual `cor3Fork.build` bump; update checker now targets the `v2` branch root package; `raw.githubusercontent.com/*` host permission; unused `scripting`/`activeTab` permissions. | Build numbers can drift; broad permissions remain. | Automate build number; derive update URL from release metadata; scope host permission; remove unused permissions. |
| M18 | No architecture enforcement | No CI except release; `.oxlintrc.json` ignores v1 but has no boundary rules; no dependency-cruiser; single tsconfig mixes DOM/chrome/node. | Layering violations recur; domain could import chrome and typecheck. | Add dependency-cruiser/ESLint boundary rules + per-context tsconfigs; run in CI. |

## Low severity

| # | Area | Evidence | Risk | Recommended fix |
|---|---|---|---|---|
| L1 | Duplicate brand types | `kernel/ids.ts` duplicates `domains/network/model.ts`. | Divergence. | Export from kernel. |
| L2 | Duplicate contract/view types | AutoFinish/AutoJobsSnapshot/DailyHackResult/InventorySortResult/JobHistoryEntry/MailClaimResult/Valuable* declared in contracts and `application/popup/portal.ts`. | Wire schema/view drift. | Define once in contracts; derive portal types. |
| L3 | Duplicated adapters | Four copies of `unwrap(response)`; 25 `findCor3Tab()` call sites; 10 `candidate.ok === true` copies. | Inconsistent errors/maintenance. | Extract shared `ChromeTabCommandClient`. |
| L4 | Dead code | `AUTO_FINISH_ALARM` declared/cleared but never created; Phase-1 `game-ws-adapter.ts`; `network/shadow.ts` test-only; unused `isExpiredJobFailure`, `outcomeLabel`. | Confuses agents; bundle bloat. | Delete or wire. |
| L5 | Direct `setTimeout` in application | `execution-service.ts`, `expeditions/service.ts`, `inventory/batch.ts`, `inventory/sorter.ts`, `loadout/service.ts`, `mail/service.ts`. | Tests use real time; violates clock-port direction. | Inject `Clock`/sleep port; use FakeClock. |
| L6 | Legacy build dependency | `build.js` copies `src/libs/notepack.min.js`/`msgpack-codec.js`; hub reads `window.__cor3MsgpackCodec`. | v2 cannot be promoted until moved. | Move codec into v2 or typed adapter. |
| L7 | Window bridge trust | `infrastructure/bridge/window-transport.ts` accepts any same-origin `postMessage` with `target: 'main-world'`; token lives in `GameSocketHub`. | Any page script/XSS can invoke game commands. | Per-page handshake/nonce or content-owned MessageChannel. |
| L8 | Accessibility | Modal listens on `window`, no focus trap/restore/`aria-labelledby`; nav lacks `aria-current`; progress bars lack `role="progressbar"`; two switch implementations. | Keyboard/screen-reader gaps. | Use `<dialog>`/focus trap, ARIA roles, shared ToggleSwitch. |
| L9 | Ignored timeout parameter | `chrome-tab-mail-adapter.ts` accepts `timeoutMs` then `void timeoutMs`; auth retry hardcoded 2 s. | Hung tab messages rely on downstream timeouts. | Implement timeout at tab-port boundary; injectable retry policy. |
| L10 | Ad-hoc default migrations | `settings-repository.ts` special-cases `autoJobsIntervalMinutes === 30`; no migration registry. | Future default changes need one-off code. | Versioned settings migration chain. |
| L11 | Cached market read-modify-write | `market-cache-store.ts`, `mail-source-store.ts` read-modify-write without write queue. | Concurrent updates clobber entries. | Serialize writes per key/repository. |
| L12 | `application/catalog` platform globals | `application/catalog/catalog.ts` uses `crypto.subtle`/`TextEncoder`. | Application depends on platform APIs (CLI only today). | Inject hashing port or move checksum to tool/infrastructure. |

## Testing gaps (updated for dev.230)

- 80 test files / 355 tests. Added a decrypt-pipeline integration test, store-migration tests and an architecture-boundary test. No tests for `contexts/background/index.ts`, `contexts/content/index.ts`, sidepanel/UI roots or `chrome-popup-portal.ts`.
- No integration/e2e against a fake tab/main-world transport; bridge tests are in-process only.
- No coverage thresholds; several tests still use real `Date.now()`/`setTimeout` instead of a fake clock.
- Redaction, i18n completeness and storage-migration tests now exist (H6/M16/H9).
- No release artifact test (would catch a wrong `dist` payload).

## Quick wins

1. Fix `release.yml`: zip `dist`, add typecheck/test/lint before build.
2. Broaden redaction and redact run-log ingestion; add two tests.
3. Remove unused settings/permissions: `mercLocationId`, `mercGoalId`, `mailAutoClaimIntervalMinutes` (or honor it), `scripting`, `activeTab`.
4. Delete dead code: `AUTO_FINISH_ALARM`, Phase-1 adapter, unused expiry/outcome helpers.
5. Fix stale comments and ADR/MODULES status.
6. Guard `job.serverId!` with a typed error.
7. Add a write queue to market/mail-source caches.
8. Make credits/progress market reads cache-first; force only on user action.
9. Add reconnection with backoff for the `v2-events` port.
10. Add `aria-current` and focus return to nav/modal; reuse `ToggleSwitch`.

## What is already healthy

- Domain layer is clean: no `chrome`/`window`/`document`/`fetch`/`WebSocket`/IndexedDB imports; no domain→application/infrastructure imports.
- Application layer does not import concrete infrastructure.
- Bridge envelope is strict/versioned, validates request/response, correlates `replyTo`, and has timeout tests.
- No persisted bearer token found; token stays in memory in the MAIN-world hub.
- Bearer/JWT redaction works for covered patterns.
- No v1 static network path table in v2; routing is graph-derived.
- `tsc --noEmit` passes.

## Suggested sequencing

1. **Week 1:** release fix + CI gates + redaction + dead-code removal.
2. **Week 2:** unify cross-context protocol and endpoint ownership.
3. **Week 3–4:** catalog wiring, loadout cache keys, versioned stores/migrations.
4. **Ongoing:** split background, add integration tests, enforce boundaries in CI.

---

# Part 3 — Remediation Status (2.0.0-salta-dev.217)

This section records what was addressed after the audit. H1 and H8 were completed later on `v2`; H9 was completed in dev.230; H10 is partially addressed.

| Item | Status | Change |
|---|---|---|
| H1 | **Done (v2 branch)** | Release workflow now runs typecheck/lint/test, builds `dist/`, zips `dist/` and uses generated GitHub release notes. |
| H2 | **Done** | Added `contracts/tab.ts` + `contracts/tab-commands.ts`: versioned `v2-tab` request/response envelopes, request IDs, per-command Zod payload schemas, and content-notice schemas. Content/background reject invalid envelopes/payloads; window notifications carry `version: 2`. Legacy raw tab messages are no longer accepted by the content listener. |
| H3 | **Done** | Added `InMemoryEndpointMutex` shared by direct endpoint commands and `RouteExecutor`; route hop setting is serialized, current endpoint is skipped, and all route calls receive `currentEndpoint`. Progress market data is cache-first and no longer force-refreshes four markets every 60 s. |
| H4 | **Partial** | Added optional static catalog loading (`item-catalog.json`) with validation and build copy support; runtime catalog remains the fallback until the artifact is generated and committed. |
| H5 | **Done** | Capability cache is keyed by a runtime fingerprint (catalog IDs + inventory + equipped IDs); `invalidate()` is called after apply and manual equip/unequip. |
| H6 | **Done** | Redaction now covers camelCase/snake-case token/session/API keys; `RunLogStore` redacts at ingestion; regression tests added. |
| H7 | **Done** | Job type resolves from the machine `jobType` (including enum spellings) before using the display name; localized fixtures added. |
| H8 | **Done (v2 branch)** | Background split into a 54-line composition root, 17 handler modules and port-driven automation coordinators; side panel split into hooks/view models. See the H8 section below. |
| H10 | Deferred | Integration/background/UI test coverage is still the next major quality task. |

---

# Part 4 — Medium-Risk Remediation (2.0.0-salta-dev.220)

M7 (intentional reserved settings), M17 and M18 (release/CI design) were excluded by request. M15 was completed later on the `v2` branch.

| Item | Status | Change |
|---|---|---|
| M1 | **Done** | Added `application/devtools/portal.ts` + `ChromeDevToolsPortal`. DevTools UI no longer imports `BridgeClient`, `chrome.*`, `indexedDB` or `localStorage`; storage inspection/export/download live in the infrastructure adapter. |
| M2 | **Done** | Moved loadout consumption parsing to `application/loadout/consumption.ts`, expedition/drone card state to `application/expeditions/view.ts`, and presentation constants to `application/popup/catalog.ts`. UI no longer imports domain functions for these calculations. |
| M3 | **Done** | Moved game readiness, network summary and drone event schemas into `contracts/`; `application/` has no Zod imports. |
| M4 | **Done** | Moved shared `JOB_TYPES` to `kernel/job-types.ts`; moved `JobOffer`/`JobCondition` into `contracts/jobs.ts`; contracts no longer import domain modules. |
| M5 | **Done** | `isGameReady`/`GameReadiness` live in `contracts/game-readiness.ts`; game socket infrastructure imports contracts instead of application policy. |
| M6 | **Done** | Wired `jobHistory` into Progress, wired `claimPendingMail` into Inventory as “Claim mailbox now”, removed unused expedition/drone/mail/daily portal methods, and removed the now-unused portal plumbing. |
| M8 | **Done** | `subscribeEvents()` reconnects the `v2-events` port with capped exponential backoff and cleans listeners on unsubscribe. |
| M9 | **Done** | `AutomationStateStore` now serializes all writes/lease operations with a write queue; each automation run uses a unique owner ID, so the same “background” string can no longer re-enter a lease. Queue persistence remains a separate runtime-state concern; persisted stores now have schema versions and migrations. |
| M10 | **Done** | Added `devtools.snapshot` (one background call for diagnostics + logs + bridge), DevTools polling reduced to 5 s and pauses when hidden; SidePanel polling is visibility-aware and credits refresh moved from 30 s to 60 s. |
| M11 | **Done** | Tightened market snapshot shape and reject payloads without a market identifier; mail already has shape diagnostics. |
| M12 | **Done** | Home detection is case-insensitive and no longer relies on the localized “Home Server” name; missing home raises a coded `HOME_NOT_FOUND` error. |
| M13 | **Done** | Unknown hardware categories are skipped instead of throwing; malformed software specs/items are filtered rather than invalidating the whole loadout. |
| M14 | **Done** | Upload jobs without a target server return `NO_SERVER` instead of using `serverId!`. |
| M16 | **Done** | Added an i18n completeness test that fails if any literal `tr()`/`tt()` source is missing a Chinese entry; DevTools panel and offline viewer now load the saved language and use the translation catalog. |
| M15 | **Done (v2 branch)** | Refreshed the ADR status/progress, module map, contributor/security docs, README and feature inventory; removed stale transitional path references and documented the audit as a historical snapshot. |

---

# Part 5 — Low-Risk Remediation (2.0.0-salta-dev.221)

L6 (legacy codec dependency) and L8 (accessibility) were excluded by request.

| Item | Status | Change |
|---|---|---|
| L1 | **Done** | `domains/network/model.ts` now imports and re-exports `ServerId`/`EdgeId` from `kernel/ids.ts`; duplicate brands removed. |
| L2 | **Done** | Auto Finish and Auto Jobs view types now come from `contracts/auto-finish.ts` / `contracts/auto-jobs.ts`; portal re-exports them instead of redeclaring. Other listed view types had no canonical contract duplicate. |
| L3 | **Done** | Added `infrastructure/browser/tab-response.ts` and migrated the largest duplicated `unwrap` implementations (inventory, loadout, job action, server access, valuable). All adapters use the shared `findCor3Tab()` port. Small remaining candidate checks are mechanical, not separate transports. |
| L4 | **Done** | Removed unused `AUTO_FINISH_ALARM`, `game-ws-adapter`, network `shadow`, `isExpiredJobFailure`, and `outcomeLabel`. |
| L5 | **Done** | Added `kernel/sleep.ts`; application services now inject/default to the kernel sleep instead of declaring local `setTimeout` helpers. |
| L7 | **Done (residual risk documented)** | Content generates a per-page capability token; main-world only accepts bridge envelopes after `V2_BRIDGE_HELLO` and validates the token on requests/responses. A malicious same-origin script can observe page-world messages, so this raises the bar but does not replace a privileged execution world. |
| L9 | **Done** | Mail tab commands now enforce their timeout with `Promise.race`; auth retry delay is constructor-injectable instead of hardcoded 2000 ms. |
| L10 | **Done** | Settings defaults now flow through an idempotent `SETTINGS_MIGRATIONS` chain instead of a single ad-hoc interval special case. |
| L11 | **Done** | `MarketCacheStore` and `ChromeStorageMailSourceTracker` serialize writes with per-instance queues. |
| L12 | **Done** | `catalogChecksum`/`buildCatalogManifest` moved to `tools/catalog/manifest.ts`; application catalog code has no `crypto.subtle`/`TextEncoder` dependency. |

---

# H8 — Background Decomposition (Implemented, 2.0.0-salta-dev.222)

Design and implementation record:

`docs/architecture/cor3-helper-2.0-h8-background-decomposition-design.md`

| Area | Before | After |
|---|---|---|
| `contexts/background/index.ts` | 4,666 lines | 54-line composition root |
| Bridge registrations | 103 in one file | 103 across 17 handler modules |
| Largest background source file | 4,666 lines | 398 lines |
| `ui/app/SidePanelApp.tsx` | 1,916 lines | 271 lines |
| Automation state | module-level `let`/`Map`/`Set` | owned by coordinators |

Changes:

- Handlers split by domain (`handlers/system`, `settings`, `network`, `jobs`, `inventory`, `valuable`, …).
- Automation engines and mutable state moved to `contexts/background/automation/`; they are chrome-free and receive ports (`SchedulerPort`, `EventPublisher`, `SettingsPort`, `Clock`, stores, services).
- Alarm ids/routes are declarative; the Helper Mode clear list is derived from the route table.
- Startup restore, Helper Mode application and scheduler start live in `bootstrap.ts`.
- Bridge contract snapshot test keeps all 103 types.
- Side panel split into 18 hooks, pure view models and 6 page panels; all polling goes through a visibility-aware `usePolling`.

Intentional normalization: Helper Mode now never re-creates automation alarms at startup. Residual risk: live-game smoke for Auto Finish/Auto Expedition/Auto Jobs/Helper Mode and component-level UI rendering tests (H10).

---

# Part 6 — Automation & Loadout Correctness (2.0.0-salta-dev.223–229)

This section records runtime fixes made after the audit/H8 work. They are behavior changes, not only refactors.

## Helper Mode and Auto Jobs gating

- Helper Mode defaults to `true` on fresh installs; existing profiles keep their stored value.
- Auto Jobs `ensureInfo`, `runCycle` and `scheduleNextRefresh` treat Helper Mode or a disabled switch as “clear the alarm, do not fetch”.
- Auto Refresh only runs when at least one automation is enabled; stale alarms are guarded at runtime.
- A fresh install or a disabled Auto Jobs switch therefore produces no market/network automation activity.

## Job execution and outcome classification

- Completion retries refresh the job row and wait before retrying instead of reusing a stale row.
- `market-not-reachable` and condition lag are retryable, not terminal failures.
- Auto-dismiss skips jobs the extension marked `skipped` (capability/selection); those remain manually completable.
- Upload jobs without a target server return `NO_SERVER` instead of throwing.

## Loadout and auto-decryption

The Loadout page and automatic File Decryption now share one path:

```text
current owned hardware/software
  -> optimizeLoadout({ ability, target, requiredPower, strategy })
  -> LoadoutService.ensure()
  -> apply (adaptive hardware order) + verify
```

| Change | Effect |
|---|---|
| `strategy: 'best'` forces the strongest bootable owned PSU (`maximizePsu`) | Removes the “tied power keeps a weaker PSU” case behind `not-enough-resources`. |
| Adaptive hardware order (`hardwareOrder`) | Installs the PSU first only when it can power the currently installed CPU/GPU; otherwise replaces the lower-draw component first. |
| File Decryption applies the decrypt plan before `take` | Avoids changing hardware while a job is active. |
| Known decrypt targets use exact-target planning | No unrelated DECRYPT fallback; an `.xvct` file only matches software that lists `.xvct`. |
| Failures propagate by kind | `NO_PLAN`/`INFEASIBLE` → `DECRYPT_POWER_INSUFFICIENT` (skipped); `APPLY_FAILED`/`VERIFY_FAILED` → `ACTION_FAILED` (retry). |
| Preflight uses the same capability check | A job is not taken when no owned DECRYPT/HACK module matches the known target; decrypt power is rechecked after the plan is applied. |
| Diagnostics (`Loadout plan selected`, `Loadout step failed`) | Logs the chosen software/hardware and the exact failing equip step. |

Residual risk: these changes have unit coverage but still need a live-game smoke run with `.xvct` and mixed file-type job sets.

## Recent jobs placement

- “Recent jobs” is rendered on the Overview page directly below “Extension Status”; it was removed from Progress.
- History loads for overview/progress and refreshes on `auto.jobs.done` and manual queue completion.

## Resolved in dev.230

| Item | Change |
|---|---|
| H9 | The six remaining unversioned stores (daily ops, drone data, expedition config, feature availability, automation state, discovery progress) now use `VersionedRepository` with schema versions and idempotent migrations; storage-migration tests added. |
| M18 | Added `.github/workflows/ci.yml` (push/PR typecheck, lint, test, build, identity check) and an architecture-boundary test covering domain/application/UI imports, browser globals, runtime Zod imports and the vendored-JS exception. |
| O-015 | PSU ranking now lives in `MaxPowerPsuPolicy`/`MinPowerPsuPolicy`; optimizer post-processing and the weakest strategy use the policy, and the `canSatisfy` cache key includes strategy, policy id and policy version. |
| M17 (partial) | Added `npm run bump:build`, a `COR3_BUILD` override in `build.js`, removed unused `scripting`/`activeTab` permissions, and scoped the GitHub host permission to `SaltApocalypse/cor3-helper`. |
| H4 (partial) | The static catalog now merges with the runtime catalog (runtime definitions win by id) instead of replacing it. |
| — | `*.log` and `dist-tools/` are ignored by git. |

## Resolved in dev.231

| Item | Change |
|---|---|
| M17 | Simplified tag-driven release pipeline: `version` + `releaseLabel` determine the tag, workflow builds `COR3 Helper v<version>-salta.zip`, and auto-publishes a GitHub Release. Node is unified on 24. |
| O-013 | The tag is now the release version; `cor3Fork.build` remains dev-only. A tag that does not match the committed version fails before building. |

## Open issues after dev.231

| ID | Severity | Issue | Next step |
|---|---|---|---|
| H4 | High (residual) | `catalog/item-catalog.json` still needs a real max-account module dump; nothing is committed yet. | Generate it with `npm run catalog -- build ...` (see `catalog/README.md`). |
| H10 | Medium (improved) | The decrypt pipeline, store migrations and architecture boundaries now have tests, but background/content/portal orchestration and UI rendering still do not. | Add fake-tab integration and jsdom component tests; add a coverage gate. |
| M7 | Medium | Unused/reserved settings remain: `mercLocationId`, `mercGoalId`, hardcoded 45-minute mail interval, and `droneAutoSendEnabled` is displayed but not consumed. | Remove or implement each setting. |
| O-016 | Medium | Settings sync is still a proposal; the current 2.0 build is local-only. | Decide whether to implement the settings-only sync design. |
| — | Verification | Latest loadout/auto-decrypt changes are unit/integration-tested but not live-game tested. | Run `.xvct` + mixed file-type jobs, Helper Mode and disabled Auto Jobs. |

## Verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 80 files / 355 tests pass
- `npm run build` — pass, `2.0.0-salta-dev.234`

---

# Part 7 — Hardening Pass (2.0.0-salta-dev.230)

This pass closed the non-runtime items from the Part 6 review.

## Catalog merge

- Added `mergeCatalogs(runtime, staticCatalog)` in `application/catalog/catalog.ts`.
- Runtime definitions win on id conflicts; static-only items are added.
- `chrome-tab-loadout-adapter` now merges instead of replacing the runtime catalog.
- Added `catalog/README.md` with the generation/validation workflow. The actual artifact still requires a real max-account module dump, so it is not committed.

## PSU policy and cache correctness

- Added `MinPowerPsuPolicy`; `best` and `weakest` now both select the PSU through `PsuSelectionPolicy`.
- Removed the direct `psuPower` prefilter and the `maximizePsu`/`minimizePsu` helpers from the optimizer.
- `LoadoutService.canSatisfy` cache keys include strategy, policy id and policy version.

## Persistence migrations

- `VersionedRepository` now parses the envelope separately from the payload and supports `migrate(data, fromVersion)` for legacy unversioned values and older envelope versions.
- Converted the six remaining unversioned stores and added `storage-migrations.test.ts`.

## Tests and CI

- Added `decrypt-pipeline.integration.test.ts`: a real `LoadoutService` applies the exact `.xvct` plan before `JobExecutionService` takes the job, and the job completes; a missing module returns `DECRYPT_POWER_INSUFFICIENT` without taking the job.
- Added `architecture-boundaries.test.ts`.
- Added `.github/workflows/ci.yml` for push/PR verification.
- Test suite: 80 files / 348 tests.

## Build and permissions

- Added `npm run bump:build` (`src/tools/release/bump.ts`).
- `build.js` accepts `COR3_BUILD` for CI/release overrides.
- Removed unused `scripting` and `activeTab` permissions.
- Restricted the GitHub host permission to `https://raw.githubusercontent.com/SaltApocalypse/cor3-helper/*`.

## Remaining

- Generate and commit `catalog/item-catalog.json` from real game data.
- Extend H10 coverage to background/content/portal orchestration and UI rendering.
- Decide the release `COR3_BUILD` policy.
- M7 unused settings and O-016 settings sync remain open.

---

# Part 8 — Simplified Release Pipeline (2.0.0-salta-dev.231)

Releases are tag-driven and use the committed version, not a CI-derived build number.

## Flow

```text
package.json version = 2.1.0
cor3Fork.releaseLabel = salta
        |
        v
git tag v2.1.0-salta
git push origin v2.1.0-salta
        |
        v
release.yml
  - verify tag == version + releaseLabel
  - typecheck / lint / test
  - build with COR3_CHANNEL=release
  - verify manifest name/version
  - zip dist as "COR3 Helper v2.1.0-salta.zip"
  - create GitHub Release automatically
```

## Build profiles

| Channel | Trigger | manifest name | version_name |
|---|---|---|---|
| dev | local build | `cor3-helper 2.0 Dev` | `2.0.0-salta-dev.<build>` |
| release | `v2.*-salta` tag | `COR3 Helper 2.0` | `<version>-salta` |

## Decisions and trade-offs

- Dev and release share the same extension key/ID. O-002 is narrowed to “single identity”; a separate release identity would need a new manifest profile and migration.
- A release tag publishes automatically. There is no draft or approval step.
- There is no checksum or artifact attestation. These can be added without changing the version model.
- `cor3Fork.build` is dev-only. Release versioning uses `package.json.version`.
- The update checker reads `version + releaseLabel` and never advertises a dev build.

## Verification

- `COR3_CHANNEL=release npm run build` produces `COR3 Helper 2.0` / `2.0.0-salta`.
- Dev build produces `cor3-helper 2.0 Dev` / `2.0.0-salta-dev.231`.
- Tag/version mismatch is rejected by the workflow before build.

---

# Part 9 — UI Polish & Specialist Diagnostics (2.0.0-salta-dev.232–234)

## UI changes

- **Recent jobs:** the Overview history list is now a fixed-height scroll area (`v2-job-history-list`) with the same thin scrollbar style as the warehouse rows.
- **Auto Daily Actions:** renamed from “Auto Daily” and the schedule reason is localized (`next-task` → “Next task” / “下一任务”); unknown reasons still fall back to the raw value.
- **Auto Jobs:** tightened vertical spacing and added a dedicated action row so the refresh icon and manual start button share the same baseline.
- **Auto Expedition:** added top spacing between the tab buttons and the card header border.
- **Selects:** compact global sizing (`min-height`, padding, font size) for selects that sit next to labels.
- **Settings:** “Check for updates” now uses an inline link-style button that matches the adjacent project links.
- **Warehouse expansion cards:** level is the primary label, capacity is the secondary explanation, status tags are localized, and purchase/extend buttons use `购买 · N CR` / `续费 · N CR` at the bottom-right of a two-row card. Both paid actions require a second click (`确认购买` / `确认续费`) with the shared warning style.

## Specialist / warehouse expansion diagnostics

The “仓库扩容服务不可用” message could appear for three different reasons:

1. the game explicitly locked the specialist room;
2. the `get.state` request failed or timed out;
3. a successful payload contained `null` optional fields and failed the strict schema.

Fixes:

- The specialist contract now accepts `null` for optional fields and normalizes numeric timestamps.
- `mapSpecialistState` tolerates null entries and returns an empty `available: true` state for `specialists: null`.
- A specialist room push without an echoed action now resolves the pending `get.state` request.
- The background handler logs only the top-level payload keys when mapping fails.
- The Inventory UI now shows the actual error with a Retry action instead of claiming the service is unavailable. Only an explicit lock still renders “Warehouse expansion service is not available.”

## Verification

- typecheck / lint pass
- 80 test files / 355 tests
- build `2.0.0-salta-dev.234`
