# COR3 Helper — Salta Fork

A Chrome extension that enhances the [cor3.gg](https://cor3.gg) experience by monitoring markets, expeditions, daily ops, and providing timer alerts — all from a compact popup UI.

> **Personal fork:** This is [SaltApocalypse/cor3-helper](https://github.com/SaltApocalypse/cor3-helper), a self-maintained fork of [Femtoce11/cor3-helper](https://github.com/Femtoce11/cor3-helper). It is **not** an official upstream release.
>
> - Fork releases: [SaltApocalypse/cor3-helper/releases](https://github.com/SaltApocalypse/cor3-helper/releases)
> - Upstream project and original author: [Femtoce11/cor3-helper](https://github.com/Femtoce11/cor3-helper)
>
> The extension's update checks point at this fork. Game-version data (`versions.json`) is mirrored from upstream and can also be synced manually with `npm run sync-versions`.

## Affiliation & Disclaimer

This extension is in no way affiliated with, partnered with, or endorsed by cor3.gg, Fragmentary Order, or Rant Gaming Studios.

The use of automation tools may be detectable by the site's developers and could put your account at risk. Always make sure you understand what a particular feature does before enabling it. The developers of this extension assume no liability for any consequences that may arise from your use of its features.

## Features

- **Theme Support** — Multiple color themes to match your preference, including an "Original" theme matching the game's native UI colors
- **Pop-up Window / Panel Support** — Exports the UI to pop-up window or side panel depending on your preference
- **Refresh System** — Either by using "refresh all" button or by clicking "refresh" for each section, it refreshes related data available on the UI
- **Pinned Timers** — Every timer except "RESTING" timer for mercenaries can be pinned to top of the UI for tracking
- **Auto Job Refresh** — If the "auto-refresh" checkbox next to pinned job timer is enabled, jobs get automatically refreshed when they reach zero. This gives users more jobs per day by triggering them earlier and giving enough time to finish
- **Auto Decrypt Hacking** — Automatically solves decryption hacks when enabled. Just toggle it on and the extension handles the rest
- **Auto ICE Wall Hacking** — Automatically solves ICE Wall hacking minigame. Detects triangle patterns and clicks them in the correct sequence to complete the puzzle
- **Auto Simple Decrypt Hacking** — Automatically solves Simple Decrypt hacking minigame. Clicks the decrypt button and monitors progress until completion
- **Anti-AFK Clicker** — Automatically prevents the anti-AFK screen locker from appearing by simulating a click on the desktop wrapper every 3 minutes. Enabled internally whenever any automation feature starts (Auto Job Solver, Auto Valuable Seller, Auto Daily Hacking, hack solvers, etc.)
- **Auto Daily Hacking** — Fully automated daily ops solver. Opens daily ops tab, starts the task, detects the puzzle type (System Log Integrity or Signal Hack), solves it end-to-end, closes windows, and auto-disables the toggle after completion. Includes retry logic (up to 3 attempts) with automatic window cleanup between retries
- **Auto Job Solver** — Automated market job solver supporting 9 job types: File Decryption, IP Injection, Data Download, Log Deletion, Log Download, Decrypt & Extract, File Elimination, Data Upload, and IP Cleanup. Features a tabbed UI showing HOME, D4RK, SOYUZ, and USOL market jobs with per-type checkboxes, a start/stop button, and a debug console with Jobs and Logs tabs. Jobs are sorted by server priority (furthest first) and job type priority, automatically handle endpoint setting (with hack-through if unreachable), server login (with hack if no active access), type-specific actions, and job completion with reward tracking. Checks server maintenance status before each job and skips jobs on servers currently in maintenance. Includes dynamic loadout management — automatically equips the right hack/decrypt software before each job and retries with loadout swaps on power/software errors
- **Auto Valuable Seller** — Automated valuable file/log scanner and seller. Scans all reachable servers for valuable files and logs, downloads them, and sells to the best market. Automatically equips optimal SEARCH and HACK software for each server type before scanning. Features a debug console with real-time progress logs, a server/download results UI, and a Maintenance tab with per-server checkbox selections and batch "Force selected!" for triggering multiple servers at once (furthest-to-closest order)
- **Auto Dismiss Failed Jobs** — Toggle to automatically dismiss failed and bugged jobs after each solver run, keeping the job queue clean
- **Auto Finish All Jobs** — Background scheduling that automatically starts the Auto Job Solver when new jobs become available after reset. Uses chrome.alarms to schedule runs at job reset times with retry logic. Works even when the popup is closed. Server maintenance–aware: skips jobs on servers currently in maintenance and schedules retries at the earlier of job reset or maintenance end.
- **Market Path-Through** — When market servers (D4RK, SOYUZ, USOL) or USOL mercenary endpoints are unreachable (no-path-to-server), dynamically fetches the live network map, discovers all paths via DFS, filters out maintenance-blocked routes, and walks intermediate servers (set endpoint + hack) before retrying the target. Falls back to alternate paths if one fails mid-way.
- **Daily Ops** — Countdown to your next daily ops task with streak bonus, difficulty, and claim status
- **Market Monitoring** — View Market-1 (HOME), Market-2 (D4RK), Market-3 (SOYUZ), and Market-4 (USOL) stats, job reset timers, items list (with INFO popup for item details), and jobs list (with Category/Server/Reward columns). Each market is collapsible (fold arrow)
- **Expedition Mode Tabs** — The Expeditions section is split into Mercenaries and Personal Drone tabs. Each tab groups its Active Expedition, mode hub, Decisions and Archived Expeditions as collapsible sub-panels (unified layout)
- **Info Panel Toggles** — Show/hide the Daily Ops and Markets information panels from the Automation/QoL toggles section
- **Inventory (standalone section)** — Inventory is its own section after Expeditions, shared across both expedition modes, with the batch-sell toolbar
- **Loadout Viewer** — View and manage your equipped hardware (CPU/GPU/RAM/PSU) and installed software. Game-style card UI with hardware specs, software power ratios, resource supply/demand overview with boot status, CHANGE/INFO buttons for hardware, and sort/search/equip/unequip for software
- **Active Expedition Tracking** — See active expeditions with remaining timer, cost, risk, insurance, and mercenary info
- **Expedition Decisions** — View and respond to pending decisions by clicking them with score calculation
- **Auto Choose Decision** — Auto choose decisions 1-min before deadline according to their scoring. Configure loot/risk modifiers to change how scoring works.
- **Inventory Viewer** — Browse your stash sorted by rarity (rarest first) then price, with item/storage details, total value, and last-updated timestamps
- **Mercenaries (Multi-Market)** — View mercenaries from CORE and USOL markets in expandable rows with faction icons. Each merc card shows callsign, rank, status, specialization, traits, mission count, cost, rest timers, risk, failed-survive chance, and death chance. Elite mercenaries are displayed on top with a bold "ELITE" badge.
- **Auto Send Mercenary** — Enable "auto send" toggle and select a mercenary to send just after current expedition is done. It auto-claims previous reward container. Works across both CORE and USOL markets with market-aware expedition config.
- **Auto Choose Mercenary** — Enable "auto choose" toggle for extension to do best mercenary selection according to their cost and risk values across all markets.
- **Auto-choose USOL First** — When enabled, USOL mercenaries are prioritized over CORE mercenaries during auto-choose, picking the cheapest USOL merc before considering CORE.
- **Ignore Elite Mercenary** — When enabled, elite mercenaries are excluded from auto-choose selection.
- **Apply Merc Cost Limiter** — When enabled, mercenaries with costs above the configured "Maximum merc cost limit" are excluded from auto-choose selection. Default limit is 15,000.
- **Get rid of Veterans** — When enabled, overrides loot/risk modifiers for veteran mercenary expeditions with loot=1 and risk=10, making decisions favor high-risk options to have higher chance on getting rid of veteran mercs. Located in the Decisions section.
- **Auto Sell Cheapest Items** — Enable "auto sell" toggle for extension to sell two cheapest items from inventory automatically when there is not enough space to pickup expedition container items.
- **Inventory Batch Sell** — In the Inventory section, filter stash items by rarity (COMMON/RARE/SUPERRARE/EPIC) and craft tag (NONE/CRAFT), then sell all matching items in one action. Both filters must be chosen; a second confirmation click is required before selling.
- **Inventory Merge & Quantity** — Duplicate item types are merged into a single card with an `xN` quantity badge, while keeping the existing compact list layout.
- **Warehouse Sorting** — The new 12-wide warehouse grid is supported. Default sort orders by rarity then item name (row-major packing); Horizontal sort gives each item type its own row band. Both layouts are precomputed and rejected if the required rows exceed the warehouse capacity. Sorting uses the in-game sorting table only for blocking items, skips already-correct items, shows progress, and temporarily pauses mailbox auto-claim.
- **SUPERRARE Rarity** — Registered between RARE and EPIC (final display order: QUEST > LEGENDARY > EPIC > SUPERRARE > RARE > COMMON).
- **Mailbox Auto-Claim** — Mercenary expedition and personal drone rewards are now delivered to the stash mailbox. The helper claims all pending EXPEDITION / DRONE_MISSION mail automatically, with stash-capacity checks, cheapest-item auto-sell, and a `claim.item` fallback for fragmented warehouse layouts.
- **Personal Drone Automation** — Fully automated drone missions (Personal Drone Assembling): auto-dispatch, auto-claim rewards via the mailbox, auto-resolve in-mission decisions, and custom repair rules (durability threshold, low-battery top-up, pause on repair failure, launch only when fully charged). Transient “already in progress” errors are retried instead of pausing the automation. Includes rate-limit retry with backoff that auto-disables on repeated failures. Active drone mission, its decisions, and archived drone missions are shown in the Expeditions panel, with the active mission pin-able like mercenary expeditions.
- **Archived Expeditions** — View past expeditions with outcome, cost, risk, location, loot container details and item images. Auto-loaded on startup
- **Multi-Alarm System** — Create multiple configurable alarms for any timer (daily ops, market job resets, expeditions). Each alarm has its own threshold, volume, continuous mode, and on/off toggle
- **Move Notifications** — Option to move in-game notification toasts and history panel from the right side to the left side of the screen
- **Secret Link/Server Finder** — Scans all known server IPs on the network map to discover hidden connections and servers. Sends `connect.ip` for each known IP, then compares before/after map data. Uses a toggle switch (auto-disables after scan) with progress and results shown in a log box. Reports new connections and new servers found
- **Helper-Only Mode** — Toggle to hide all automation features, converting the extension to a pure info/helper tool
- **Auto Update Markets** — Toggle to automatically refresh market data when WebSocket events arrive
- **Version Tracking** — Displays extension, web, system, and patch versions
- **Check for Updates** — Compare your installed extension, web, and system versions against the latest on this fork's GitHub repository. It lets user know if an update is required for extension or if web/system versions are different from what's stored.
- **Cache-First Design** — Data loads instantly from cache on popup open. Use the "Refresh All" button or per-section refresh buttons to fetch fresh data
- **Real-Time Updates** — WebSocket listeners auto-update daily ops, markets, expeditions, decisions, inventory, mercenaries, loadout, and archived expeditions live when data arrives — even if the popup is opened before data is ready
- **DevTools WS Inspector** — Built-in Chrome DevTools panel for real-time WebSocket message inspection and multicategory log viewer. Features include: category selector (WS Messages, Auto Job Solver, Auto Valuable Seller, Error Logs, Page Console Logs, Extension Console Logs), direction/event/action/server column filtering for WS messages, level/message columns for log categories, format dropdown (Raw / JSON-pretty / Interactive Tree View with inline object/array previews), search with highlight & navigation inside message detail (including tree view traversal with auto-expand), export filtered data as JSON or Markdown table, paginated log display (1000 entries per page) with section selector, IndexedDB-backed storage with 24-hour auto-cleanup, per-category clear, and resizable columns/detail pane. Includes an offline popout log viewer that imports exported log files (JSON, MD, Discord clipboard format) for offline analysis
- **Lightweight** — Only intercepts existing WebSocket traffic and re-triggers some API calls that the game already sends

## Installation

### Option A: Pre-built Release (recommended)

1. **Download** — Go to [Salta fork Releases](https://github.com/SaltApocalypse/cor3-helper/releases) and download the latest `cor3-helper-v*.zip` asset (pre-release builds are expected).

2. **Extract** — Unzip the downloaded archive to a folder on your computer.

3. **Open Chrome Extensions** — Navigate to `chrome://extensions/` in your browser.

4. **Enable Developer Mode** — Toggle the **Developer mode** switch in the top-right corner.

5. **Load the Extension** — Click **Load unpacked** and select the extracted folder (containing `manifest.json`).

6. **Navigate to cor3.gg** — Open [https://cor3.gg](https://cor3.gg) and log in. The extension will automatically start intercepting game data.

7. **Open the Popup** — Click the COR3 Helper icon in your browser toolbar to view your dashboard.

### Option B: Build from Source

1. **Clone** — Clone the repository:
   ```
   git clone https://github.com/SaltApocalypse/cor3-helper.git
   ```

2. **Install Dependencies** — From the project root, run:
   ```
   npm install
   ```

3. **Build** — Bundle the extension into the `dist/` folder:
   ```
   npm run build
   ```
   For development, use watch mode to rebuild on changes:
   ```
   npm run watch
   ```

4. Follow steps 3–7 from **Option A** above to load the `dist/` folder in Chrome.

## Fork Releases & Versioning

- **Base version** (Chrome `manifest.version`): `1.8.0`
- **Display version** (Chrome `manifest.version_name`): `1.8.0-salta.1`
- **GitHub tag**: `v1.8.0-salta.1`
- Fork releases are published as **pre-releases** to distinguish them from upstream stable releases.

Chrome only accepts 1–4 dot-separated integers in `manifest.version`, so the `-salta.1` suffix lives in `version_name` (display-only) and the GitHub tag. `build.js` generates both from `package.json`:

```json
"version": "1.8.0",
"cor3Fork": { "label": "salta", "build": 1 }
```

Result:

```json
"version": "1.8.0",
"version_name": "1.8.0-salta.1"
```

Release process:

```bash
# 0. Update package.json version and create docs/releases/<tag>.md first
npm run release:prepare   # sync versions.json + build
git add versions.json     # only if it changed
git commit -am "chore(release): v1.8.1-salta.1"
git push origin main

git tag -a v1.8.1-salta.1 -m "Salta fork release v1.8.1-salta.1"
git push origin v1.8.1-salta.1
```

`release:prepare` refreshes `versions.json` and rebuilds. The release workflow only checks `versions.json` and prints a warning if it is stale; it does not modify the file or commit to `main`.

> ⚠️ Do **not** run `git push --tags`: this repository also contains upstream tags, and each `v*` tag would trigger the release workflow.

## Game Version Tracking

`versions.json` tracks the live game's web/system/patch versions. The extension displays them in the popup footer (`Web`, `System`, `Patch`) and uses them for “website updated” notices.

`versions.json` is updated **manually**. Run the sync script before a release:

```bash
npm run sync-versions
```

You can also trigger `Sync game versions` from GitHub Actions (`workflow_dispatch`). The release workflow runs a `--check` and prints a warning if `versions.json` is stale; it does not block the release.

Check-only mode:

```bash
npm run sync-versions:check
```

To read the live values yourself:

1. Open [cor3.gg](https://cor3.gg) with the extension loaded.
2. Open the extension popup and read the version footer.
3. Or open the popup DevTools console and run:
   ```js
   chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion'])
   ```
4. Update `versions.json` manually if needed:
   ```json
   {
     "web": "v1.25.31",
     "system": "3.05",
     "patch": "3.95.5"
   }
   ```

Where the values come from:

- `web` — `translation.json?v=...` request query parameter
- `system` — `api/users/me` response `systemVersion`
- `patch` — `updater get.patches` response `selectedVersion`

## Usage

- **On page load**, the extension automatically fetches daily ops, market data, expedition data, and mercenary data to populate the cache.
- **Open the popup** to see cached data instantly with "last updated" timestamps.
- **Refresh All** button sequentially refreshes daily ops → markets → expeditions -> mercenary.
- **Per-section refresh** buttons let you refresh individual data types.
- **Pin timers** to keep them visible at the top of the popup.
- **Auto job refresh** feature can be used to automatically refresh jobs when needed after pinning timers and clicking the "Auto" checkbox next to it.
- **Auto Decrypt Hacking** — Toggle the switch to enable. It automatically solves decryption hacks whenever one appears.
- **Auto ICE Wall Hacking** — Toggle the switch to enable. It automatically solves ICE Wall hacking minigames by detecting and clicking triangle patterns.
- **Auto Simple Decrypt Hacking** — Toggle the switch to enable. It automatically solves Simple Decrypt hacking minigames by clicking the decrypt button and monitoring progress.
- **Auto Daily Hacking** — Toggle the switch to enable. It opens daily ops, starts the task, solves the puzzle automatically, and disables itself when done.
- **Auto Job Solver** — Toggle the switch to reveal job selection UI. Choose job types from HOME, D4RK, SOYUZ, and USOL market tabs, then click Start. The debug console shows real-time job progress and logs. Toggle "Auto Finish All Jobs" for fully automatic operation.
- **Set decision scores** by clicking edit button. After the change click save button to keep the changes. This way you can change default scoring that extension shows next to each decision.
- **Enable auto choose decision** for extension to automatically choose best decision according to scoring which is calculated by default/modified loot/risk modifiers.
- **Enable auto send mercenary** for extension to send selected mercenary by itself after the current expedition ends.
- **Enable auto choose mercenary** for extension to choose which mercenary to send for next expedition according to their cost and risk values across CORE and USOL markets. It only works if "auto-send" feature is turned on. Use "Auto-choose USOL first" to prioritize USOL mercs, "Ignore elite mercenary" to exclude elite mercs from selection, and "Apply merc cost limiter" with a configured max cost to exclude expensive mercs.
- **Get rid of Veterans** — Enable in the Decisions section to override loot/risk modifiers (loot=1, risk=10) for veteran mercenary expeditions, making auto-choose favor high-risk options.
- **Secret Link/Server Finder** — Toggle the switch to enable. It scans all known server IPs by connecting to each one, then compares the network map before and after to discover any new hidden connections or servers. The toggle auto-disables when the scan completes.
- **Alarms** — Click ➕ in the Alarms section to create a new alarm. Choose a timer source, set a threshold, and configure volume/continuous beeping. Toggle alarms on/off or edit/delete them anytime.
- **Check for Updates** — Click the button at the bottom of the popup to see if a new version of the extension is available on this fork's GitHub releases. It also shows if web/system versions are changed recently.
- **DevTools WS Inspector** — Open Chrome DevTools (F12) and navigate to the "COR3 Helper" tab. Use the category selector to switch between WS Messages, Auto Job Solver logs, Auto Valuable Seller logs, Error Logs, Page Console Logs, and Extension Console Logs. Use the page selector to browse log history (1000 entries per page). Use the filter inputs, format dropdown, search bar, and export buttons to analyze data. Toggle Live mode to see only new entries from the activation point onward. Click the ⧉ popout button to open an offline log viewer in a new window where you can import previously exported log files.

## Files

| File                       | Description                                                                                                                                                               |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `manifest.json`            | Extension manifest (Manifest V3) — permissions include storage, scripting, activeTab, tabs, alarms, sidePanel                                                             |
| `popup.html`               | Popup UI (HTML + CSS) — includes auto job solver section, debug console, and all toggle UIs                                                                               |
| `popup.js`                 | Popup logic, rendering, alarm management, auto job solver UI, debug console, live storage update listeners                                                                |
| `console-logger.js`        | Console interceptor — captures console.log/warn/error in both MAIN world and extension contexts for DevTools log viewing                                                  |
| `errors.js`                | Centralized error logging — stores errors to chrome.storage.local with source, message, stack, and context (max 200 entries)                                              |
| `notepack.min.js`          | Bundled notepack.io 3.0.1 library — local copy of msgpack encoder/decoder used by the binary WS codec                                                                     |
| `msgpack-codec.js`         | Socket.IO v5 binary packet codec — converts between legacy 42[...] strings and binary msgpack WS frames using notepack.io                                                 |
| `content-early.js`         | Injected at `document_start` — intercepts WebSocket/HTTP polling messages, WS send functions, D4RK path-through logic                                                     |
| `content.js`               | Injected at `document_idle` — relays data to storage, handles auto-refresh, auto job solver injection, notification repositioning                                         |
| `background.js`            | Service worker — auto finish all jobs scheduling, expedition polling, alarm management                                                         |
| `ws-messages.js`           | IndexedDB writer for WS messages and categorized logs (auto-jobs, auto-valuable, errors). 24h purge                                                                       |
| `ws-interceptor.js`        | WebSocket interceptor helper                                                                                                                                              |
| `decrypt-solver.js`        | Auto-solver for decryption hacking minigame (injected into page when enabled)                                                                                             |
| `ice-wall-solver.js`       | Auto-solver for ICE Wall hacking minigame — detects triangle patterns and clicks them in sequence                                                                         |
| `simple-decrypt-solver.js` | Auto-solver for Simple Decrypt hacking minigame — clicks decrypt button and monitors progress                                                                             |
| `daily-hack-solver.js`     | Fully automated daily ops solver — opens tab, starts task, detects puzzle, solves it, closes windows, auto-disables toggle                                                |
| `auto-job-solver.js`       | MAIN world auto job solver engine — handles 9 job types with promise-based WS event orchestration                                                                         |
| `auto-valuable-seller.js`  | MAIN world valuable seller engine — scans servers for valuable files/logs, downloads them, and sells to markets with auto loadout                                         |
| `devtools.html`            | DevTools entry point — registers the WS Inspector panel                                                                                                                   |
| `devtools.js`              | DevTools page script — creates the panel tab                                                                                                                              |
| `devtools-panel.html`      | DevTools panel UI — message table, detail pane, export/search/format controls, popout button                                                                              |
| `devtools-panel.js`        | DevTools panel logic — multi-category viewing (incl. console logs), filtering, raw/json-pretty/tree-view, search, export, live mode, paginated IndexedDB loading, WS send |
| `devtools-log-viewer.html` | Offline log viewer UI — standalone popout window for importing and viewing exported logs                                                                                  |
| `devtools-log-viewer.js`   | Offline log viewer logic — import/parse JSON, MD table, Discord clipboard formats, category switching, filtering, detail view                                             |
| `versions.json`            | Game-version tracking file (web/system/patch), mirrored from upstream and served by this fork                                                                              |
| `build.js`                 | esbuild bundler script — bundles modular `src/` entry points into `dist/`, copies static files, syncs manifest version and fork `version_name` from `package.json`         |
| `scripts/sync-versions.js` | Fetches upstream `versions.json` and updates the fork's copy (`npm run sync-versions`)                                                                                      |
| `docs/cor3-ws-events.md`   | Mailbox, stash/grid, expedition, drone and gameplay WS protocol notes                                                                                                      |
| `docs/releases/`           | Per-release notes used by the fork release workflow                                                                                                                        |
| `package.json`             | Node.js project config — build/watch/clean/sync-versions scripts, base version, fork version metadata, esbuild dependency                                                  |

## Requirements

- Node.js 18+ (for building)
- Google Chrome (or Chromium-based browser)
- An active [cor3.gg](https://cor3.gg) account

## License

MIT
