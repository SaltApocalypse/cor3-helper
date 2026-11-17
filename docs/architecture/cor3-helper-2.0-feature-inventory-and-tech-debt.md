# COR3 Helper 2.0 — v1 Feature Inventory & Technical Debt Report

- **Repository:** `/mnt/x/Software/cor3-helper`
- **Scope:** v1 (git history, behavior oracle) vs v2 (`src/`, branch `v2`)
- **Method:** static source review of popup, content scripts, MAIN-world hooks, background scheduler, bridge contracts, tests, build/release config, and architecture docs
- **Status legend for v1 → v2:** `Implemented` = equivalent user capability exists; `Partial` = core exists but visible scope/behavior differs; `Missing` = no counterpart found; `Unknown` = cannot confirm without runtime QA
- **Caveat:** this is not a runtime parity sign-off. The 2.0 release line is complete; local builds use `<version>-salta.<build>`. Historical sections retain their original development labels.
- **Last verified:** 2026-11-15 against build `2.0.5-salta.272`
- **Current verification:** `npm run typecheck`, `npm run lint`, `npm test` (93 files / 448 tests) and `npm run build` all pass.

## Current completion snapshot (build `2.0.5-salta.272`)

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
- Most **Missing** rows are v1 presentation/polish features: 10-theme system, pinned timers, market item INFO popup, Valuable Seller result tables, game-version notices and settings sync.
- The remaining engineering risk is concentrated in **H4** (static catalog artifact), **H10** (background/content/portal and UI tests), **M7** (unused settings) and **O-016** (settings sync). Part 6 records the loadout/decryption fixes; Part 7 records the dev.230 hardening pass; Part 8 records the dev.231 release pipeline.

---

# Part 1 — v1 User-Facing Feature Inventory

## 1. Popup Shell, Header, Localization, Theme

| Feature | v1 entry points | v2 status | v2 evidence / notes |
|---|---|---|---|
| Brand header (logo + COR3 Helper) | `src/html/popup.html` header row | **Implemented** | `src/ui/components/BrandHeader.tsx`; adds `SaltA Fork` subtitle |
| Pop-out window (v1: 360×700 Chrome popup) | `#popOutBtn`, `src/popup/panel-controls.js` | **Implemented** | `ChromePopupPortal.openWindow()` opens `sidepanel.html?mode=window` as a 430×800 popup, focuses an existing one, and is exposed in `WelcomeApp.tsx` and the side-panel header. Wide multi-column layout is still not implemented |
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
| Path-through/maintenance/auto loadout | `steps.js`, `helpers.js`, `shared/loadout-resolver.js` | **Implemented with caveat** | Dynamic routing + capability preflight. File Decryption takes the job first, routes/accesses the target, then applies a targeted DECRYPT plan before decrypting; a known file type never falls back to unrelated DECRYPT software. Job ordering differs (live route length vs v1 furthest-first table) |
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
| SAI special-file highlight and value badges | External userscript `highlighter.ts` | **Implemented** | `saiFileHighlightEnabled`; `src/contexts/content/sai-highlighter.ts` uses the original userscript palette (user blue, system red, job yellow, marked valuable teal, price/tags orange, other magenta) and shows credit value, detection rate and tags. Toggle and colour legend: Game → Assist tools |
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
3. Multi-column popup layout for wide detached windows (the pop-out window itself is implemented).
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

- 81 test files / 363 tests. Added a decrypt-pipeline integration test, store-migration tests and an architecture-boundary test. No tests for `contexts/background/index.ts`, `contexts/content/index.ts`, sidepanel/UI roots or `chrome-popup-portal.ts`.
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
| `strategy: 'best'` keeps current sufficient hardware, otherwise uses the strongest bootable owned PSU | Removes unnecessary swaps for jobs while still selecting max power/PSU when a new loadout is required. |
| Adaptive hardware order (`hardwareOrder`) | Installs the PSU first only when it can power the currently installed CPU/GPU; otherwise replaces the lower-draw component first. |
| File Decryption takes the job first, then applies the decrypt plan after routing/access | Accepts jobs even when a loadout swap fails, avoids a duplicate DECRYPT→HACK→DECRYPT swap, and keeps failed decrypt jobs retryable. |
| Known decrypt targets use exact-target planning | No unrelated DECRYPT fallback; an `.xvct` file only matches software that lists `.xvct`. |
| Failures propagate by kind | `NO_PLAN`/`INFEASIBLE` → `DECRYPT_POWER_INSUFFICIENT` (skipped); `APPLY_FAILED`/`VERIFY_FAILED` → `ACTION_FAILED` (retry). |
| Preflight blocks only definitive capability gaps | A job is refused before `take` only when no owned DECRYPT/HACK software or hardware exists. Hardware/power transitions and loadout application are attempted after the job is taken and remain retryable. |
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
- `npm test` — 93 files / 448 tests pass
- `npm run build` — pass, `2.0.5-salta.272`

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

- Added `decrypt-pipeline.integration.test.ts`: a real `LoadoutService` takes the job first, applies the exact `.xvct` plan, and completes; a missing module keeps the taken job and returns `DECRYPT_POWER_INSUFFICIENT`.
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
| local | local build | `COR3 Helper 2.0` | `<version>-salta.<build>` |
| release | `v2.*-salta` tag | `COR3 Helper 2.0` | `<version>-salta` |

## Decisions and trade-offs

- Local and release builds share the same extension key/ID and `COR3 Helper 2.0` identity. Migration from v1 remains O-002.
- A release tag publishes automatically. There is no draft or approval step.
- There is no checksum or artifact attestation. These can be added without changing the version model.
- `cor3Fork.build` is the local build counter. Release versioning uses `package.json.version` + `releaseLabel`.
- The update checker reads `version + releaseLabel` and never advertises a local build.

## Verification

- `COR3_VERSION_NAME=2.0.0-salta npm run build` produces `COR3 Helper 2.0` / `2.0.0-salta`.
- Local build produces `COR3 Helper 2.0` / `2.0.0-salta.<build>`.
- Tag/version mismatch is rejected by the workflow before build.

---

# Part 9 — UI Polish & Specialist Diagnostics (2.0.0-salta-dev.232–236)

## UI changes

- **Recent jobs:** the Overview history list is now a fixed-height scroll area (`v2-job-history-list`) with the same thin scrollbar style as the warehouse rows.
- **Market jobs panel:** hidden on the Overview while Auto Jobs is disabled, because no market-task sync runs and the panel would otherwise stay on “Waiting...” forever.
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
- build `2.0.5-salta.272`

---

# Part 10 — Direct-First Network Routing (2.0.0-salta-dev.236)

## Problem

Market refresh used `RouteExecutor` directly. The executor always walked intermediate nodes and called `ensureAccess`, which could trigger a HACK loadout before the market server was ever tried directly. A USOL refresh through URM7-M therefore failed with `LOADOUT_NO_PLAN_NO_SOFTWARE` even though the market endpoint might be directly reachable.

## Changes

- `RouteExecutor` now tries `set.endpoint(target)` before path planning. Direct success does not touch intermediates or the loadout.
- Direct routing also works when the target is missing from a stale network snapshot.
- If direct routing fails, route attempts start from the current endpoint and then fall back to home. A failed attempt records the last reached node and tries alternatives from there.
- `NetworkGraph.findRouteFrom` / `findRoutesFrom` plan from an explicit start node.
- `ChromeTabServerAccessAdapter` tries `hack.start` with the current loadout first and only equips a HACK plan after `sai-no-hack-software` / `sai-hack-impossible`.
- Market sync results/logs expose `direct` and `directError`; route failures include the direct failure reason plus per-route details.
- `JobRouting.setEndpointIfNeeded` passes `skipDirect` because it already tried the direct endpoint, avoiding duplicate commands.

## Verification

- New tests cover direct target success, snapshot-missing direct success, alternative route fallback, explicit-start graph routes, lazy HACK loadout, and loadout-swap retry.
- typecheck / lint pass
- 81 test files / 363 tests
- build `2.0.0-salta.238`

---

# Part 11 — Auto Jobs Report Polish (2.0.0-salta.237)

- Market sync failures now persist a short `errorCode` (`ROUTE_FAILED`, `MARKET_FETCH_FAILED`, `SNAPSHOT_FAILED`) instead of exposing the full route/debug message in the Status and report panel.
- The detailed failure message (direct endpoint error, route attempts, per-server access failures) remains in the automation log.
- The report panel renders localized summaries: route failed, market data fetch failed, network snapshot failed, or generic data fetch failed.
- Added translations for “No game WebSocket is available”, “All route attempts failed”, the report summaries, and the short Auto Jobs snapshot/status failures.
- `jobStatusTone` now handles both English and Chinese status text: ready/synced is green, syncing/waiting/running is amber, and failure/unavailable/timeout is red.
- Tests cover the new report codes and translated status tones.

---

# Part 12 — Overview Extension Status Aggregation (2.0.0-salta.238)

- The Overview extension status card now combines the live activity indicator with a health badge and an expandable details section.
- Collapsed by default: only the overall extension status and the current activity/progress are visible; the details section is behind an explicit toggle.
- Expanded details include session/auth, game readiness, network endpoint/server count/snapshot age, operation queue, Helper Mode, Auto Jobs next/last refresh, per-automation chips, and a simplified recent-error summary.
- `overview.state` now returns `helperMode`, `networkAgeMs`, an `autoJobs` summary, and per-automation `lastAt`.
- `useGameStatus` polls `overview.state` on Overview (10s) and exposes it to the status card; the separate `activity.state` poll remains at 3s for live progress.
- The card uses green/amber/red/gray tones for healthy, attention, error and idle states. Detailed route/loadout/socket errors remain in the automation logs; the card only shows a short error category.
- Added view-model tests for health precedence, recent-error detection, queue/snapshot warnings, and automation tone mapping.
- The initial details grid used two columns for short rows, with `Game data`, `Network` and `Auto Jobs` spanning the full row; Part 14 switches the whole grid to one column.

---

# Part 13 — Stale Automation Error Acknowledgement (2.0.0-salta.239)

- Extension Status polls `overview.state` every 10 seconds and refreshes immediately when the Overview page becomes active, so it does update after returning from another page.
- The Auto Drone row previously used `lastRun().message` as `lastError` for every status, including normal/blocked messages. It now reports an error only when the last run status is `error`.
- Auto Drone and Auto Expedition record the last successful view refresh. If the error predates that view, `overview.state` suppresses it; a new error after the view is shown again.
- This prevents a resolved drone/expedition connection from leaving a permanent red error in Extension Status.

---

# Part 14 — Single-column Status Details and Detached Workspace Window (2.0.1-salta.242)

- The Extension Status expanded details now use a single-column grid; every row spans the card width and long values wrap instead of sharing a two-column row.
- `PopupPortal.openWindow()` opens `sidepanel.html?mode=window` as a 430×800 Chrome popup. It focuses an existing popup instead of creating duplicates and ignores the same document in normal browser tabs.
- The detached window runs the same `SidePanelApp`; `?mode=window` adds a centered max-width shell. No new manifest permission or entry point is required.
- `openSidePanel()` now reuses `openWindow()` when the SidePanel API is unavailable.
- Entry points: the Welcome popup button and the side-panel header pop-out action.
- Added portal tests for window creation, singleton focus, normal-tab filtering, failure handling and side-panel fallback.

---

# Part 15 — SAI Special-File Highlight and Value Badges (2.0.1-salta.243)

- The MAIN-world socket hub now caches `sai:get.files` entries, applies `sai:file.delete` / `sai:file.upload` / `sai:file.search-valuable` updates, and forwards the normalized list to the content script (`V2_SAI_FILES`).
- `game.saiFiles` exposes the cached list so a content script that starts after the SAI window opened can paint immediately.
- `src/contexts/content/sai-highlighter.ts` maps the cached entries to the `SaiFiles` rows and reproduces the original userscript palette: user blue, system red, job yellow, game-marked valuable teal, credit-value/tag files orange, and other special sources magenta. Source colours keep the same precedence as the original script.
- Value badges show `CR <basePrice>`, `<detectRate>% det`, and a compact `i` tooltip for tags. The overlay is class-based and re-applied by a MutationObserver, so it does not rewrite the game rows.
- The overlay is opt-in through `saiFileHighlightEnabled` (default `false`) and can be toggled from the new Game → Assist tools panel without reloading the page; an inline info button next to the title explains the full colour legend.
- Raw socket payloads are validated and normalized at the main-world boundary; the content script validates the cross-context message again.
- Added contract and domain tests for normalization, tag parsing, value detection and highlight precedence.

---

# Part 16 — Auto Jobs Cycle Failure and Manual Market Refresh (2.0.1-salta.245)

- A failed Auto Jobs market sync exposed `errorCode` on `JobMarketSyncEntry`. `autoFinishMarketBase` copied that field into `AutoFinishMarketResult`, whose schema does not allow it. The persisted/returned `last.markets` payload then failed Zod validation (`unrecognized_keys: errorCode`), aborting the Auto Jobs cycle and leaving the panel without a completion refresh.
- `autoFinishMarketBase` now strips `errorCode` (and still strips the fields that Auto Finish recalculates). The Auto Jobs short error code remains available in the Auto Jobs report.
- The MAIN-world socket hub now parses outgoing `market:get.options` / `get.lots` / `get.jobs` frames. This lets responses from a manual in-game market refresh update the market cache and publish `V2_MARKET_CACHE_UPDATED`, which the background applies to the Auto Jobs snapshot.
- The side-panel `jobAllMarketsSchema` / `autoJobsSnapshotSchema` now accept and preserve `errorCode` for failed markets, so `job.syncAllMarkets` and `auto-jobs.snapshot` no longer reject a payload just because one market failed.
- Added regression tests for the Auto Finish market/state schemas, failed-market Auto Jobs snapshots and outgoing market frame parsing.

---

# Part 17 — Job-level Auto Finish Completion Tracking (2.0.1-salta.246)

- The log showed market refreshes completing with `skipped: 0`; the skipped rows came from Auto Finish selection, not the market mapper.
- `completedResets` was market-level. Once a market was considered complete, every job currently listed in that market was skipped as `ALREADY_COMPLETED`, even when the market later produced new jobs under the same reset. A zero-job market was also marked complete immediately.
- Auto Finish state now persists `completedJobs` (`jobId -> resetAt`). Selection and reporting skip only a job that was actually completed for the current reset. New job IDs in the same market/reset remain runnable.
- Auto Jobs reset scheduling now checks the current job IDs against `completedJobs` and does not treat an empty market as complete. This keeps the interval refresh alive so newly generated work can be discovered.
- The report marks `ALREADY_COMPLETED` only after checking real outcomes, so a force-run failure cannot be mislabelled as a completed job.
- A `jobResult.error` guard prevents `Cannot read properties of undefined (reading 'code')` from aborting an Auto Finish run.
- Added tests for job-level completion, zero-job markets, reset scheduling and Auto Finish state persistence.

---

# Part 18 — Auto Drone Startup Status Noise (2.0.1-salta.247)

- A fresh worker can run Auto Drone before the game socket or drone data is available. `DroneAutoService.runOnce()` returns an error for that transient race, and the Overview used to paint the Auto Drone automation red until the user opened the drone panel.
- Transient socket/bridge/timeout/route failures are now recorded as `waiting` instead of `error`; real drone failures still use `error`. The automation stays visible but no longer raises the red overview state.
- Transient failures schedule the existing Auto Drone retry alarm (60 s) so the first successful game-data read launches normally. Real failures wait for the regular interval.
- `restore()` marks the restored last-run timestamp as already viewed, so an error from a previous worker session does not flash on startup. A new error after a manual drone view still appears.
- `markViewSeen()` now never moves the view timestamp behind the last run timestamp.
- Added tests for transient classification, restored view state, startup waiting status and real-error visibility.

---

# Part 19 — Auto Daily "Already Claimed" Status (2.0.1-salta.248)

- After a successful Auto Daily run, the next check can see `hasClaimedToday: true` and records `solved: false` with `puzzle: "claimed"`. The Overview treated every `solved: false` last run as an error, so the normal post-completion state appeared as `Data fetch failed`.
- `isAutoDailyWaiting()` now recognizes the claimed/waiting state (and the equivalent "already completed" messages) and the Overview excludes it from the red automation error.
- If the solve response is not marked solved but the post-run daily state already reports `hasClaimedToday`, the coordinator normalizes the last run to the claimed/waiting state instead of leaving a false failure.
- Real solve/fetch failures still produce an error.
- Added tests for claimed-state detection while keeping real failures visible.

---

# Part 20 — Build-aware Footer and Update-check Fallbacks (2.0.1-salta.250)

- `build.js` now injects `__COR3_BUILD_NUMBER__` into the bundles while leaving the release tag and manifest `version_name` unchanged (`2.0.1-salta`). The Settings footer appends the build counter (`2.0.1-salta.250`) without changing release identity.
- The update checker now tries three endpoints concurrently (raw GitHub, jsDelivr, GitHub raw) with a 6-second abort timeout per endpoint. This prevents one blocked CDN from producing a permanent “Could not check for updates”.
- `manifest.json` permits the jsDelivr and GitHub raw hosts used by the fallbacks.
- The side-panel bridge timeout for `system.updateCheck` is raised to 20 seconds, and the inline failure message exposes the underlying error in its tooltip.
- Added a fallback test for the update checker.

---

# Part 21 — Automation Startup, Market Retry and File Selection Fixes (2.0.2-salta.252)

- Auto Drone and Auto Daily now expose a waiting/loading state when game data is not ready. The Overview shows `Loading...` instead of a red `Data fetch failed`; real failures remain errors.
- Auto Drone records `NO_COR3_TAB` and socket/bridge startup failures as `waiting` and retries them. `restore()` marks the restored last run as already viewed so stale session errors do not flash on startup.
- Drone event resolution now sends the event `missionId` (with active-mission fallback), fixing the game-side `missionId must be a UUID` error.
- Market sync retries transient `market-not-reachable`/timeout/socket responses before reporting `MARKET_FETCH_FAILED`.
- Job file references now include nested `condition.details.files`; downloaded-file selection prefers the referenced file or the expected extension and refuses to reuse an unrelated `.bin`/`.12vvsh` file.
- Decrypt loadout analysis is re-read with a short settle window after equipping, so a successful plan is not immediately reported as insufficient power.
- HACK retries now recognize `GAME_HACK_FAILED` messages containing `sai-no-hack-software`/`sai-hack-impossible` and apply the HACK loadout.
- Auto Finish error handling is defensive around missing error details; logs now distinguish `no jobs to run` from selections that skipped jobs.
- The expedition active card and stage stats wrap long location text and are clamped to the panel width.

---

# Part 22 — Longer Market Receive Window and v1-style Update Check (2.0.2-salta.253)

- Market `get.options` / `get.lots` / `get.jobs` requests now allow 35 seconds instead of 15/18 seconds; pending market actions expire after 45 seconds. This covers unstable servers that respond slowly under load.
- Market sync still retries transient `market-not-reachable`, timeout, socket and rate-limit responses before reporting `MARKET_FETCH_FAILED`.
- Update checks now query the GitHub Releases API first, then package metadata from `v2`, `main`, jsDelivr and GitHub raw. Request aborts are disabled by default to match v1; the bridge wait is 120 seconds.
- `ChromePopupPortal.updateCheck()` performs the v1-style direct fetch from the popup/side panel before falling back to the background bridge.
- `api.github.com` is included in host permissions.
- Update failures show a direct link to the Releases page so users can check manually when the network blocks all update endpoints.

---

# Part 23 — Decrypt Loadout Hardware Swap Order (2.0.2-salta.255)

- A decrypt plan could select a valid final CPU/GPU/PSU combination but fail on `equip-cpu` with `not-enough-resources` because the intermediate hardware swap exceeded the currently installed PSU.
- `hardwareOrder()` now simulates both CPU-first and GPU-first intermediate draws against the PSU that will be active at that point and picks an order that stays bootable. A target PSU that can power the current pair is installed first; the CPU/GPU order is then evaluated against that target PSU rather than only the final pair.
- All equipped software is now unequipped before hardware swaps, then the target software is equipped after. Keeping active software during a CPU/GPU swap can make the game reject an otherwise valid plan.
- Loadout traces now include the current CPU/GPU/RAM/PSU/software alongside the selected plan, so future `not-enough-resources` reports can distinguish a bad plan from a bad swap order.


---

# Part 24 — Take Decrypt Jobs Before Loadout and Drone Policy Cleanup (2.0.2-salta.257)

- File Decryption now takes the job before applying the decrypt loadout, matching v1. Previously a loadout failure (`equip-cpu: not-enough-resources`) aborted execution before `job.take`, so every decrypt job stayed unaccepted and was reported as retrying.
- The loadout is still applied before routing to the target server. If it fails, the job remains in the taken/retryable state and can be retried instead of disappearing from the run.
- The integration test now asserts take-before-loadout, and the execution test asserts that a loadout failure keeps the taken job.
- The drone in-mission decision dropdown no longer offers `Veterans first (highest risk)`: drone events do not expose veteran/mercenary data, so the option only duplicated a risk sort. Existing stored `veterans` values migrate to `loot`.
- Expedition/mercenary decisions keep all four policies; only the drone dropdown changed.


---

# Part 25 — Preflight, Transition, Mail and Route Access Audit (2.0.2-salta.258)

- `JobPreflight` now mirrors `RouteExecutor`: it checks the current endpoint and its direct/current-node route before falling back to the home route. A target reachable directly is no longer skipped because the home path crosses a maintenance node.
- HACK capability checks consider routes from the current endpoint as well as home. A route that needs no HACK from the current endpoint is not blocked by a home route that does.
- Preflight blocks only `NO_SOFTWARE` and `NO_HARDWARE`. `NO_BOOTABLE_COMBINATION` is treated as a post-take loadout problem, matching the take-first File Decryption flow.
- `LoadoutService` always invalidates its capability cache after a failed or unverified apply, and returns `partial: true` when software/hardware was already changed before the failure. The target software is now re-equipped unconditionally after the hardware swap; it had been unequipped first and could previously be skipped.
- `MailService.claimForSource` marks a source claimed only when the claim completed without failures and without `stashFull`.
- Auto Mail schedules a five-minute retry for transient whole-collect failures (timeout, socket, tab, bridge, temporary).
- Auto Finish's prefetched fast path now checks the retry-exhausted budget, and Job Queue guards a missing auto-dismisser instead of using a non-null assertion.
- Auto Daily no longer calls `solveHack` when the daily state cannot be read; it records a loading/waiting state and uses the existing short-retry schedule.
- `RouteExecutor` ensures target access when the player is already at the target endpoint and reports `accessEnsured` so Job Routing and Valuable do not repeat the login/access command.


---

# Part 26 — Retry Failed Markets Inside the Auto Jobs Queue (2.0.2-salta.259)

- `JobMarketSync.syncAll()` now performs one retry pass for markets that failed transiently on the first pass, inside the same `NetworkOperationQueue` Auto Jobs operation.
- The retry pass waits 1.5–2.5 seconds, refreshes the network snapshot, and retries only transient/network/route failures. Maintenance failures are left for the next scheduled cycle.
- A successful retry replaces the failed market entry, appends its jobs, and publishes the partial snapshot so the UI leaves the "data fetch failed" state without waiting for the next Auto Jobs interval.
- Retry logs use `Market retry complete` / `Market retry failed` with an `attempt: retry` field; initial-pass logs keep their existing messages.
- `isRetryableMarketFailure()` is exported for tests and does not retry `TARGET_IN_MAINTENANCE` / `MAINTENANCE_BLOCKED`.


---

# Part 27 — Loadout Serialization, Best Semantics and Pacing (2.0.3-salta.263)

- `LoadoutService.ensure()` and the manual equip/unequip handlers now share one mutation queue. UI, decrypt, HACK and SEARCH can no longer interleave unequip/equip commands. The runtime is re-read inside the serialized section.
- The capability cache TTL is reduced to 5 seconds, entries are pruned and bounded to 64, and the runtime fingerprint includes hardware consumption/PSU specs. Apply, verify, manual mutations and a game tab becoming ready invalidate the cache immediately.
- `best` semantics changed: when the current hardware can already run the target software, the current plan is kept (no hardware or PSU churn). When a hardware change is required, the highest ability power is selected and the max-PSU policy chooses the strongest bootable PSU. `weakest` still minimizes ability power and PSU.
- The Loadout page button label now says “keep current if sufficient”.
- Apply steps are listed up front, sleep only between commands (not after the last one), support configurable command gaps, and retry a rate-limited command after a 3-second backoff.
- The capability cache key includes PSU policy versions; `MaxPowerPsuPolicy` and `MinPowerPsuPolicy` now use `psuProtection` as an equal-power tie-break before the current-PSU preference.
- `hardwareOrder()` falls back to CPU/GPU before PSU when current hardware specs are missing, instead of assuming zero draw.
- Fallback software (`fallbackToAnyAbility`) is rejected for positive power requirements; it is only valid for the unknown-file-type capability check.
- File Decryption no longer applies DECRYPT before routing. It takes the job, routes/accesses the target, then applies DECRYPT only if the file is not already decryptable. This avoids a DECRYPT → HACK → DECRYPT duplicate swap.
- Valuable SEARCH caches the last successful `(server type, power, strategy)` alongside `LoadoutService.revision()` for at most 30 seconds; consecutive same-type servers skip the read/optimize cycle, while any HACK/manual mutation forces a fresh SEARCH plan.
- The loadout trace now includes strategy, policy ID/version, fallback usage and `keptCurrentHardware`.
- Added tests for current-hardware retention, max-PSU selection after a required swap, PSU protection tie-breaks, fallback rejection, concurrent ensure serialization, rate-limit backoff and software re-equip after a hardware swap.

---

# Part 28 — Release 2.0.3-salta

- Consolidates the post-2.0.2 automation fixes: decrypt jobs take first, market sync retries failed markets in the Auto Jobs queue, and job preflight mirrors direct/current-endpoint routing.
- Loadout changes keep the current sufficient hardware under `best`, serialize UI/automation mutations, shorten capability-cache TTL, retry rate-limited commands, and avoid a duplicate DECRYPT→HACK→DECRYPT swap.
- Mail partial claims stay retryable, transient Auto Mail failures retry in five minutes, Auto Daily waits when its state is unavailable, and target access is ensured when the player is already at the target endpoint.
- Release identity: `package.json.version = 2.0.3`, `cor3Fork.releaseLabel = salta`, tag `v2.0.3-salta`; the local build counter remains separate from the release version.


---

# Part 29 — Version Header in Automation Debug Logs (2.0.3-salta.264)

- The background worker now writes `COR3 Helper initialized — <version>` to the global log at startup, including `version`, `displayVersion`, `build`, `phase` and `initializedAt`.
- The Automation/Developer debug console prepends a synthetic status line on every load/refresh: `COR3 Helper <version> · logs loaded/refreshed · N line(s)`, with the run ID and reason in `data`. It is included in Copy/Export but not persisted into the background buffer.
- The first line therefore always identifies the running build, even when the underlying log buffer contains older session lines.
- Log refresh triggers documented: initial Developer page load, manual Refresh, live refresh every 2 seconds while an automation is running, Auto Jobs/Auto Daily portal events, and tab/page re-entry.
- Global logs remain capped at 500 entries, persisted in `chrome.storage.session` for up to 24 hours, and cleared by the DevTools Clear action; run logs remain in-memory per run (20 runs × 500 lines).


---

# Part 30 — Decrypt File Type Isolation (2.0.3-salta.265)

- `decryptFileType()` now reads file extensions only from decrypt-related conditions (`DecryptFile`, `DecryptDownloadedFile`). A download/upload condition carrying a generic `.enc` or `.bin` no longer overrides the real decrypt extension (for example `.eb52x`).
- Concrete file names from the decrypt condition, `fileInfo`, and the downloaded file are considered, and a real format is preferred over a generic `.enc`/`.bin` wrapper.
- `findDownloadedFile()` uses decrypt-only condition references and requires `job.fileInfo`/reference matches to match the resolved expected extension. This prevents selecting an unrelated `.enc` download by ID/name.
- Added tests for `.enc` plus `.eb52x` in mixed conditions, generic decrypt extensions, downloaded-file preference, and mixed download/decrypt references.


---

# Part 31 — Download Suffix, Lock Diagnostics and Bridge Guard (2.0.3-salta.266)

- Data Download/Decrypt & Extract now matches a downloaded encrypted file by base name when the server file suffix changes (for example `report_8918.dat` → `report_8918.eb54x`).
- The decrypt target prefers the actual downloaded file name (`preferFileName`) over a server-side/condition suffix, while still preferring real formats over `.enc`/`.bin`.
- Decrypt preflight treats `.enc`/`.bin` as unknown wrapper extensions and falls back to “owns any DECRYPT software” instead of blocking on the wrapper.
- Auto Expedition logs the rejected candidate list (status, market, cost, risk) and the active max-price/mode when no mercenary matches; selection behavior is unchanged.
- Auto Finish “selection skipped every job” and run selection logs now include per-job skip reasons and minigame lock expiry, making locked jobs distinguishable from capability/type/completion skips.
- `BridgeServer` no longer throws while auditing a malformed `{ ok: false }` handler result; the Auto Finish run handler also supplies a fallback error object. This addresses the observed `auto-finish.run: Cannot read properties of undefined (reading 'code')` failures.
- Added tests for changed download suffixes, downloaded-file preference, and generic `.enc` preflight fallback.


---

# Part 32 — Expedition Total Cost Cap (2.0.3-salta.267)

- Expedition configure responses can contain both a root `cost` (initial hire fee) and a nested `totalCost` (final cost). `totalCostInfo()` now searches for an explicit `totalCost` at any depth before falling back to `cost`/`price`.
- `ExpeditionService.candidates()` marks a candidate `costEstimated: true` when only the initial price is available. `selectMercenary()` excludes estimated candidates whenever a max-price cap is enabled, so an unknown initial fee cannot pass as the total.
- `ExpeditionService.configure()` now returns the configured response instead of discarding it.
- Before the irreversible launch, `launchExpedition()` verifies the configured total cost against the cap and aborts with a logged error if the total is unavailable or exceeds the cap. This prevents a launched expedition from exceeding the configured maximum even if candidate ranking used a different cost value.
- Auto Expedition diagnostics now include `costEstimated` per rejected candidate.
- Added tests for nested totalCost preference, price-only estimation, candidate extraction, and capped selection.


---

# Part 33 — Release 2.0.4-salta

- Release `2.0.4-salta` consolidates the post-2.0.3 fixes: expedition total-cost cap and configured-cost launch guard, decrypt/download suffix isolation, bridge audit guard, Auto Expedition/Auto Finish skip diagnostics, and version headers in automation debug logs.
- Release identity: `package.json.version = 2.0.4`, `cor3Fork.releaseLabel = salta`, tag `v2.0.4-salta`; the local build counter remains separate.


---

# Part 34 — Zero-Power Decrypt Analysis Retry (2.0.4-salta.269)

- `canDecrypt=false` with `decryptPower=0` after a loadout is ambiguous: it can mean already decrypted, stale analysis, or no decrypt software. The job service now attempts `decrypt.file` instead of immediately returning `DECRYPT_POWER_INSUFFICIENT`.
- The game's `file-already-decrypted` / `cannot-read-sai-file` path still completes the job; missing software/other failures propagate as retryable action errors.
- Added concise diagnostics: `Decrypt loadout ready` (target, required/plan power, software/hardware) and `Decrypt analysis after loadout` / `Decrypt power still insufficient after loadout`.
- Added a regression test for the stale/zero-power attempt path.


---

# Part 35 — Loadout Latency and Take-First Decrypt Locks (2.0.4-salta.270)

- Loadout `get.options` requests now allow 35 seconds in both the content bridge and the game socket hub (previously 18 s / 15 s), covering slow responses that were being reported as `RUNTIME_UNAVAILABLE`.
- `LoadoutService` now caches optimized plans for 60 seconds by ability/target/requiredPower/strategy/policy plus the runtime fingerprint. Repeated decrypt jobs with the same target avoid recomputing the exhaustive plan; inventory/catalog changes invalidate the fingerprint.
- Decrypt jobs are no longer blocked by the minigame-lock preflight. They are taken first and the execution service re-checks the lock after take, so the job is visibly accepted before a lock failure/retry.
- Added a preflight test for taking a File Decryption job while the minigame is locked.


---

# Part 36 — Complete Claimable Jobs Before Locks/Budgets (2.0.4-salta.271)

- Auto Finish now treats `alreadyTaken && canComplete` jobs as claim-only. They bypass retry-exhausted budgets, minigame locks and the completed-job cache, because only `job.complete` remains; no minigame needs to run.
- This prevents a decrypted/claimable job from being stranded when a stale lock or retry budget still applies. `JobExecutionService` already returns to `complete()` before take/preflight for this state; the selection layer now lets those jobs reach it.
- Added a regression test for completing a claimable taken job without taking it again.
- Carried the loadout latency work: 35 s `get.options` timeouts, 60 s optimized-plan cache, and take-first handling for decrypt jobs while the minigame is locked.


---

# Part 37 — Release 2.0.5-salta

- Release `2.0.5-salta` consolidates the post-2.0.4 loadout and completion fixes: 35 s loadout request window, 60 s optimized-plan cache, take-first decrypt jobs during minigame locks, zero-power decrypt attempts, claim-only completion bypassing stale locks/retry budgets, and expedition/download/bridge hardening.
- Release identity: `package.json.version = 2.0.5`, `cor3Fork.releaseLabel = salta`, tag `v2.0.5-salta`; the local build counter remains separate.
