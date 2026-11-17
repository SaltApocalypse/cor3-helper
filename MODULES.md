# Modules

This file is the module-level map for the 2.0 implementation on the `v2` branch. It answers “where does this code live?”. Feature parity and technical debt are tracked in
[`docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md`](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md).

Statuses below mean “implementation exists”, not “v1 parity is verified”.

## Source map

| Layer | Path | Responsibility | Status |
|---|---|---|---|
| Kernel | `src/kernel/` | `Result`, branded IDs, clocks, sleep, shared primitives | Implemented |
| Contracts | `src/contracts/` | Zod boundary schemas: bridge, tab, storage, game, market, jobs, loadout, mail, expeditions, drone, inventory, catalog | Implemented |
| Domain | `src/domains/network/` | Network graph, route planning, maintenance filtering, snapshot model | Implemented |
| Domain | `src/domains/loadout/` | Catalog model, calculator, optimizer, PSU policy | Implemented |
| Domain | `src/domains/jobs/` | Job model, market definitions, selector, file types | Implemented |
| Domain | `src/domains/markets/`, `expeditions/`, `drone/`, `inventory/`, `daily-ops/`, `mail/`, `specialists/`, `valuable/`, `minigame/` | Pure feature models and rules | Implemented |
| Application | `src/application/network/` | Snapshot service, discovery, route executor, endpoint lease/mutex, market path/sync | Implemented |
| Application | `src/application/auto-job/` | Job mapping/selection, execution, queue, outcomes, dismissal, snapshots | Implemented |
| Application | `src/application/loadout/`, `inventory/`, `markets/`, `mail/`, `expeditions/`, `drone/`, `daily-ops/`, `specialists/`, `valuable/`, `game/` | Feature use cases and ports | Implemented |
| Application | `src/application/automation/ports.ts` | `SchedulerPort`, `EventPublisher`, `SettingsPort`, clock and run-log ports | Implemented |
| Application | `src/application/catalog/`, `popup/`, `devtools/`, `auth/` | Catalog tooling, UI portals, DevTools portal, auth ports | Implemented |
| Infrastructure | `src/infrastructure/bridge/` | Bridge client/server, Chrome runtime transport, page-world transport | Implemented |
| Infrastructure | `src/infrastructure/browser/` | Chrome tab adapters, popup/DevTools portals, readiness and tab commands | Implemented |
| Infrastructure | `src/infrastructure/game-ws/` | Socket hub, map mapper, loadout mapper, game-ws adapter | Implemented |
| Infrastructure | `src/infrastructure/storage/` | `chrome.storage.local/session` repositories, versioned stores, settings, caches | Implemented |
| Infrastructure | `src/infrastructure/logging/` | Buffered redacted logger and run-log store | Implemented |
| Infrastructure | `src/infrastructure/auth/`, `update/` | Ephemeral session, tab auth adapter, update checker | Implemented |
| Context | `src/contexts/main-world/` | Game socket hub, minigame solvers, page bridge server | Implemented |
| Context | `src/contexts/content/` | Page bridge client, tab-command handlers, QoL DOM automation and the SAI file overlay | Implemented |
| Context | `src/contexts/background/` | Composition root, bridge handlers, automation coordinators, alarms, bootstrap | Implemented |
| Context | `src/contexts/popup/`, `sidepanel/`, `devtools/` | Preact composition roots; `sidepanel/` also serves the detached window via `?mode=window` | Implemented |
| UI | `src/ui/` | Preact components, pages, feature cards, hooks, view models, i18n | Implemented |
| Assets | `src/html/`, `src/libs/` | Popup/side panel/DevTools HTML+CSS; the detached window reuses `sidepanel.html`; vendored msgpack/notepack codecs | Implemented |
| Tooling | `src/tools/` | Catalog CLI, release build-number helper and build helpers | Implemented |

## Background composition

The background context was split by H8. Each level has one job:

| Path | Responsibility |
|---|---|
| `src/contexts/background/index.ts` | Composition root only: create runtimes, register handlers/lifecycle, start transport |
| `src/contexts/background/composition/core.ts` | Logger, settings, bridge server/transport, event ports, stores |
| `src/contexts/background/composition/game.ts` | Tab adapters and game services (network, market, loadout, jobs, inventory, mail, expeditions, drone) |
| `src/contexts/background/composition/automation.ts` | Coordinator wiring and late-bound ports |
| `src/contexts/background/composition/chrome-scheduler.ts` | The only automation adapter over `chrome.alarms` |
| `src/contexts/background/handlers/*.ts` | Per-domain bridge adapters (system, devtools, settings, network, jobs, inventory, valuable, …) |
| `src/contexts/background/automation/*.ts` | Chrome-free coordinators and helpers for Auto Jobs, Auto Finish, Auto Drone, Auto Expedition, Auto Mail, Auto Daily, Auto Refresh, Valuable and job locks/pipeline |
| `src/contexts/background/alarms.ts` | Declarative alarm route table and Helper Mode clear list |
| `src/contexts/background/messaging.ts` | `chrome.runtime.onMessage`, `tabs.onRemoved`, `onInstalled` |
| `src/contexts/background/bootstrap.ts` | Persisted-state restore, Helper Mode application, scheduler start |

## Automation and loadout pipeline

The Loadout page and automatic File Decryption share one application path:

```text
Loadout page "Apply optimized"
Auto Jobs File Decryption (before take)
        |
        v
LoadoutService.ensure({ ability, target, requiredPower, strategy })
        |
        v
optimizeLoadout()  (owned items + static catalog when available)
        |
        v
apply: unequip old software -> adaptive hardware order -> equip software
        |
        v
verify with retry
```

Key modules:

| Path | Responsibility |
|---|---|
| `src/domains/loadout/optimizer.ts` | Candidate generation, best/weakest selection, PSU post-processing |
| `src/domains/loadout/psu-policy.ts` | `MaxPowerPsuPolicy` and the policy interface |
| `src/application/loadout/service.ts` | `canSatisfy` (read-only preflight) and `ensure` (apply + verify); policy-keyed capability cache, adaptive hardware order, plan/step diagnostics |
| `src/application/auto-job/execution-service.ts` | Decrypt flow, pre-take decrypt loadout, completion retry |
| `src/contexts/background/composition/automation.ts` | Wires the decrypt hook and maps loadout failures to job outcomes |
| `src/contexts/background/automation/job-preflight.ts` | Prevents taking jobs with no owned DECRYPT/HACK plan |

Behavior note: a known decrypt file type (for example `.xvct`) is planned exactly. The unrelated-software fallback is only used when the file type is unknown.

## UI composition

| Path | Responsibility |
|---|---|
| `src/ui/app/SidePanelApp.tsx` | Layout, page switch and hook composition only |
| `src/ui/app/hooks/` | Per-domain side-panel state, portal calls and polling (`usePolling`) |
| `src/ui/app/panels/` | Overview, Progress, Game, Settings, Developer, Automation panels |
| `src/ui/app/view-models/` | Pure UI calculations with unit tests |
| `src/ui/components/` | Shared cards, status widgets, modals and controls |
| `src/ui/pages/` | Detailed feature pages |
| `src/ui/features/` | Automation cards and reusable feature UI |
| `src/ui/devtools/` | DevTools panel and offline log viewer |

## Boundaries

- Domain code has no browser/game APIs (`chrome`, `window`, `document`, WebSocket, fetch, IndexedDB).
- Application depends on ports, not concrete infrastructure.
- UI components use Preact and do not call `chrome.*` or game APIs directly.
- External data is validated with Zod at the boundary.
- No persisted bearer token.
- No static path table.
- Vendor JavaScript is limited to `src/libs/`; all other source is TypeScript.

## Current verification and known gaps

- Last verified: 2026-11-15, build `2.0.5-salta.272`.
- `npm run typecheck`, `npm run lint`, `npm test` (93 files / 448 tests) and `npm run build` pass.
- No domain/application imports of `chrome`, `window`, `document`, WebSocket, fetch or IndexedDB; an architecture-boundary test enforces this and the UI layer rules.
- Persisted stores now use versioned envelopes with idempotent migrations (H9).
- Release builds are tag-driven: `version` + `releaseLabel` determine the tag, and CI publishes `COR3 Helper v<version>-salta.zip`.
- Known gaps: H4 still needs a real `catalog/item-catalog.json` artifact (the loader now merges); H10 still needs background/content/portal and UI rendering tests; M7 unused settings remain open; O-016 settings sync remains a proposal.
- Runtime logs (`*.log`) and `dist-tools/` are ignored by git and must not be committed.

## See also

- [Architecture](./ARCHITECTURE.md)
- [Architecture decisions](./docs/architecture/cor3-helper-2.0-architecture-decision-record.md)
- [Feature inventory and technical debt](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md)
- [H8 background decomposition](./docs/architecture/cor3-helper-2.0-h8-background-decomposition-design.md)
