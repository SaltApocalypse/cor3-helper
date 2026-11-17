# cor3-helper 2.0 — Architecture Decision Record

- **Status:** Accepted; implementation ongoing on `v2` (build `2.0.5-salta.272`)
- **Date:** 2026-11-08
- **Last status update:** 2026-11-15
- **Current verification:** typecheck, lint, Vitest (93 files / 448 tests) and build pass at this build.
- **Baseline:** `experimental` at `c7b69c7` (`v1.8.6-salta-exp.2`)
- **Related audit:** [`cor3-helper-2.0-architecture-audit.md`](./cor3-helper-2.0-architecture-audit.md)
- **Scope:** architecture, technology selection, security, repository strategy, UI, loadout data, release identity
- **Rule:** this document records decisions. It does not start the rewrite.

---

## 1. Decision summary

| ID | Decision | Status |
|---|---|---|
| D-001 | Use the current repository with a long-lived rewrite branch created from `experimental` (later renamed `v2`) | **Approved** |
| D-002 | Use strict TypeScript for all new source; no new JavaScript source files | **Approved** |
| D-003 | Use Zod only at external data boundaries | **Approved** |
| D-004 | Use Preact + TypeScript for a redesigned UI | **Approved** |
| D-005 | Stop persistent bearer-token storage; use content-mediated auth; redact logs | **Approved** |
| D-006 | Generate a versioned static item catalog from a max account; keep player inventory dynamic | **Approved** |
| D-007 | Maximum `psuPower` is the default PSU policy; make the policy extensible | **Approved** |
| D-008 | Support non-max accounts as a mandatory requirement | **Approved** |
| D-009 | Deprecate Dev TC; do not migrate legacy implementations directly | **Approved** |
| D-010 | Use a dedicated 2.0 extension identity shared by local and release builds; final migration remains open | **Approved** |

Open items are listed in section 11. They are not silently decided in this document.

---

## 2. Decision details

### D-001 — Repository strategy

**Decision:** Option B. Same repository, long-lived rewrite branch created from `experimental`. The branch was later renamed `v2` when the 2.0 source was promoted to the repository root.

Branch model:

```text
main          stable v1.x
experimental  v1.x experimental
v2            2.0 rewrite (promoted to the root layout)
```

Rules:

- The rewrite branch was created from `experimental`, because it contains the latest network and loadout work.
- Freeze non-critical v1 feature work during 2.0.
- Keep v1 open for critical bug fixes only.
- Do not rewrite existing tags or history.
- Final 2.0 release tags should use the `v2.0.0-salta` form (`<version>-<releaseLabel>`); `cor3Fork.build` remains the local build counter.
- The project remains a downstream fork of the original project. 2.0 is an independent architecture design and original rewrite, not an official upstream release.

Consequences:

- One repository, one issue tracker, one release workflow.
- Stable v1 and 2.0 can be validated sequentially.
- `v2` must be protected from accidental feature drift.
- The final merge/identity strategy still needs a decision.

### D-002 — TypeScript

**Decision:** Fully adopt TypeScript. All new source is TypeScript. No new JavaScript source files.

Approved compiler settings:

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "useUnknownInCatchVariables": true
}
```

Additional rules:

- `tsc --noEmit` runs in CI.
- Separate `tsconfig` files for contexts where DOM/library availability differs.
- No `any` in public contracts.
- Do not use TypeScript only as JSDoc annotations; use real `.ts`/`.tsx` modules.
- esbuild remains the bundler.
- Existing v1 JavaScript remains as reference or temporary compatibility code, not as a pattern for new work.

Consequences:

- More upfront work for game DTO normalization.
- A much stronger feedback loop for AI agents.
- Public contracts can be generated and tested.

### D-003 — Runtime validation

**Decision:** Adopt Zod at external boundaries only.

Validation boundaries:

```text
WebSocket frames
HTTP responses
chrome.storage reads/writes
cross-context bridge messages
imported log/snapshot files
static item catalog
```

Rules:

- Parse once at the adapter boundary; pass typed data inward.
- Do not repeat Zod schemas inside every domain function.
- Do not add a second validation library.
- Measure Zod bundle impact per context.
- Weird or unknown fields are logged and handled explicitly; do not silently trust raw game data.

Open implementation detail: whether to use the full Zod API or a size-optimized import style. The maintainer chose Zod; this document does not override that with Valibot.

### D-004 — UI framework

**Decision:** Preact + TypeScript, component-based redesign.

Scope:

- Popup and side panel.
- Detached popup window (the same `SidePanelApp`, opened through `chrome.windows.create`).
- Content-script QoL overlays (DOM adaptation such as the SAI file highlighter) are not Preact; they live in `src/contexts/content/` and are gated by persisted settings.
- DevTools panel and offline log viewer where appropriate.
- Not the MAIN-world game engines.
- Not the standalone DOM solvers.

Rules:

- Components render view models and handle interaction.
- Application/domain rules stay outside components.
- Components do not call `chrome.*`, `window.postMessage`, WebSocket, or storage directly.
- Panels are independent and testable in isolation.
- No large global state framework.
- Preact Signals vs local hooks/small stores is **Open**.
- The UI is a redesign, not a mechanical migration of current DOM code.
- Preact should be bundled only into UI contexts.

Suggested UI layout:

```text
ui/
├── app/
│   ├── PopupApp.tsx
│   ├── SidePanelApp.tsx
│   └── DevToolsApp.tsx
├── components/
│   ├── panels/
│   ├── controls/
│   └── layout/
├── hooks/
├── stores/
├── i18n/
└── view-models/
```

### D-005 — Bearer token and log security

**Decision:** Stop persistent bearer-token storage by default. Use in-memory/session access and a content-mediated authentication adapter.

Rules:

- Do not write `bearerToken` to `chrome.storage.local`.
- Do not expose a persistent token to popup, background, or storage consumers.
- The content context owns the live game session and authenticates game/API requests.
- Popup/background call a typed auth adapter; they never read the token.
- Reacquire the game session after restart/reload.
- If a token must transit a context boundary, use a short-lived, explicit, typed request, not a global.
- Redact Authorization, JWT, token, cookie, and session fields from:
  - console logs;
  - WS logs;
  - diagnostics;
  - snapshots;
  - exported JSON/Markdown;
  - error reports.
- Retention limits apply to logs and snapshots.

Consequences:

- The current `bearerToken` storage key is not migrated.
- Background code that currently fetches authenticated APIs must move behind a content-mediated port.
- Daily Ops API access and any future authenticated API need an adapter.
- Log export becomes safer but may contain less raw diagnostic data.

### D-006 — Static item catalog

**Decision:** Generate a versioned static catalog from the maintainer's maxed account. Keep player inventory dynamic. Derive plans at runtime.

Three layers, with hard separation:

1. **Static Item Catalog**
   - item IDs, category, base specs, consumption, abilities, server/file applicability;
   - no owner data, no equipped data, no recommended loadout.
2. **Dynamic Player Inventory**
   - owned hardware/software IDs;
   - equipped state;
   - current hardware;
   - fetched at runtime.
3. **Derived Loadout Plans**
   - catalog × inventory;
   - only owned items;
   - target-specific;
   - recomputed when inventory or catalog version changes.

Catalog requirements:

- Reproducible extraction script.
- Zod schema for every record.
- Unique ID validation.
- Numeric range validation.
- Server/file type reference validation.
- `catalogVersion` and `gameVersion` fields.
- Checksum and version diff report.
- Explicit provenance: source, capture date, account type, game patch, script version.
- Catalog is data, not code.

Licensing:

- **Open.** Account access does not imply redistribution rights.
- Do not publish a catalog derived from the account until the terms and ownership are reviewed.
- If redistribution is not allowed, keep the generated catalog local/private or as a build-time artifact with documented provenance.

**Implementation note (dev.230):** the catalog CLI and optional `catalog/item-catalog.json` loader exist, but no artifact is committed. Until one is generated, the runtime catalog is built from owned items (`catalogVersion: 'runtime'`). The loader now merges artifact definitions with runtime-owned items (runtime wins by id), so event or unknown items are not dropped. Generating the artifact requires a real max-account module dump (O-014).

### D-007 — PSU selection policy

**Decision:** Maximum `psuPower` remains the default policy, but it must be an independent strategy.

Implemented interface:

```ts
interface PsuSelectionPolicy {
  id: string;
  version: number;
  compare(a: HardwareDefinition, b: HardwareDefinition, context?: PsuPolicyContext): number;
}
```

Current default (`MaxPowerPsuPolicy`, version 2):

```text
1. highest psuPower
2. equal power keeps the currently equipped PSU
```

Rules:

- The optimizer must not contain a hardcoded `psuPower` comparison.
- Policy ID and version are part of the loadout cache key.
- Future policies may cover protection, efficiency, switching cost, task reserve, and other constraints.
- Only the MaxPower policy is implemented now.

**Implemented strategies (dev.230):**

- `best`: keeps the current hardware when it already satisfies the requirement; otherwise maximizes ability power and uses `MaxPowerPsuPolicy` for the new hardware. `weakest` minimizes ability power and uses `MinPowerPsuPolicy`.
- `weakest`: keeps the lowest feasible ability power and uses `MinPowerPsuPolicy`.
- PSU ranking and optimizer post-processing both go through `PsuSelectionPolicy`; the capability cache key includes strategy, policy id and policy version.

### D-008 — Non-max accounts

**Decision:** Non-max accounts are mandatory.

Rules:

- All plans use the player's actual owned items.
- The max account is a catalog source and validation baseline only.
- If no feasible plan exists, return an explicit `INFEASIBLE`/domain error.
- Never assume the player owns all items.
- Never silently equip a lower-quality plan without reporting the feasibility result.
- Test with partial inventories, missing PSU capacity, missing software types, and missing server-specific tools.

### D-009 — Dev TC and legacy code

**Decision:** Deprecate Dev TC. Do not migrate legacy implementations directly.

Rules:

- Dev TC is not part of 2.0.
- Legacy code is a source of requirements, protocol knowledge, business rules, and algorithms, not a migration template.
- Do not preserve old directory structure for compatibility.
- Re-evaluate each feature against the feature inventory.
- Keep only confirmed, valuable behavior.
- `ws-interceptor.js` is dead code and should not be migrated.
- `FALLBACK_PATH_MAP` is a legacy fallback and should disappear after dynamic routing parity.

### D-010 — Extension identity

**Decision:** Use a dedicated 2.0 extension identity. Local and release builds share the same identity; migration from v1 remains open.

Development identity:

```text
Name: COR3 Helper 2.0
manifest key: shared 2.0 extension key
version_name: <version>-salta (release) / <version>-salta.<build> (local)
storage namespace: separate from v1
```

Rules:

- Local and release builds use the same manifest profile.
- The 2.0 build must not overwrite v1 settings or caches.
- Local builds must not publish to the stable release channel.
- Final release identity is **Open**: same ID/name for upgrade, or distinct identity for side-by-side.
- If the final identity differs, provide a settings export/import migration path.
- The release workflow must verify which identity is being built.
- **Implementation note (2.0.0):** the development phase is complete. Local and release builds use the same `COR3 Helper 2.0` identity and extension key; only `version_name` differs (local builds append the build counter). This supersedes the separate-dev-identity profile for 2.0. Migration from v1 remains O-002.

---

## 3. Conflicts and interactions

No maintainer decision is overridden here. These are interactions that need design attention.

### C-01 — Preact UI vs. behavior parity

**Interaction:** Preact is a redesign, but v1 contains many edge-state behaviors.

**Risk:** A clean component rewrite can silently lose rendering and interaction details.

**Recommendation:** Build Preact in parallel with a parity checklist. Keep domain/application work independent of UI. Do not delete the v1 UI until the new UI passes the “must preserve” list.

### C-02 — Separate dev extension ID vs. release workflow

**Interaction:** A dedicated dev key/name requires a manifest build profile and separate storage namespace.

**Risk:** A dev build could be published accidentally or use the stable update channel.

**Recommendation:** Add a `build:dev`/`build:release` split, validate `name`, `key`, `version_name`, and storage namespace in CI. Keep final identity open.

### C-03 — No persistent token vs. background authenticated calls

**Interaction:** Background and popup may need authenticated API data, but they must not read a persisted token.

**Risk:** Moving token access to content can create a new synchronous bottleneck or hidden dependency.

**Recommendation:** Define a typed `AuthRequestPort` with request/response and timeout. Background asks content to perform authenticated calls. Do not reintroduce a shared token store. Treat login/reconnect as session events.

### C-04 — Static catalog from max account vs. non-max support

**Interaction:** Catalog generation uses a max account; runtime must work for partial inventories.

**Risk:** Accidentally baking ownership/equipped data into the catalog would violate D-008.

**Recommendation:** Enforce schema separation. Catalog records must reject `owned`, `equipped`, `quantity`, and player-specific fields. Add fixtures for non-max inventories; fail tests if a plan uses unowned items.

### C-05 — Static catalog vs. redistribution licensing

**Interaction:** The catalog source is an account; the repository may be public.

**Risk:** Account access may not equal permission to publish derived data.

**Recommendation:** Keep this Open. Perform provenance/legal review before publishing. Support a local/private catalog artifact if necessary.

### C-06 — Zod at boundaries vs. bundle size

**Interaction:** Zod in multiple IIFE bundles increases size because there is no shared runtime chunk.

**Risk:** A large validation layer in every context.

**Recommendation:** Measure per-context size. Share schemas in source but accept duplication in bundles; use only boundary schemas and avoid broad object parsing. Choose a size-aware import style without changing the Zod decision.

### C-07 — Preact vs. MAIN-world engines and standalone solvers

**Interaction:** Preact is for extension UI contexts; game engines and DOM solvers run in the page.

**Risk:** Accidentally coupling UI to page-world automation.

**Recommendation:** Keep Preact out of MAIN-world engines and standalone solvers. UI talks through ports/contracts only.

### C-08 — Dev TC deprecation vs. network diagnostics

**Interaction:** Dev TC contains a reachability test that is useful for network debugging.

**Risk:** Losing a useful diagnostic while removing the UI.

**Recommendation:** Do not migrate Dev TC. If the capability is still needed, reimplement it as a formal Network Diagnostics test, not as a hidden popup TC. This is **Open** (O-010).

### C-09 — Freeze v1 vs. critical fixes

**Interaction:** Freezing v1 feature work still requires bug fixes and security patches.

**Risk:** Divergence between v1 and the 2.0 reference.

**Recommendation:** Define a short “critical only” policy; cherry-pick fixes into 2.0; keep a changelog mapping. Do not add new v1 features during the rewrite.

### C-10 — TypeScript all new code vs. legacy JS

**Interaction:** Existing JS remains in the tree until migrated.

**Risk:** Agents may copy legacy JS patterns into new TS files.

**Recommendation:** New-code rule is absolute. Add lint/CI checks that reject new `.js` source under the 2.0 source tree. Legacy JS is read-only reference.

---

## 4. Updated technology stack

| Layer | Technology | Status |
|---|---|---|
| Extension | Chrome MV3 | Keep |
| Language | TypeScript strict | Approved |
| UI | Preact + TypeScript | Implemented |
| UI state | Local hooks + pure view models | Implemented (O-003 resolved) |
| Bundler | esbuild | Implemented |
| Validation | Zod at boundaries | Implemented |
| Tests | Vitest + fixtures | Implemented; Playwright not adopted |
| Lint/format | oxlint + Prettier | Implemented |
| Architecture checks | oxlint + architecture-boundary test | Implemented (dev.230) |
| Storage | chrome.storage.local/session behind repositories | Implemented; settings sync not adopted (O-016) |
| Game transport | WebSocket/HTTP adapters + typed contracts | Implemented |
| Scheduling | Clock/Scheduler ports + chrome.alarms | Implemented |
| Logging | Structured, redacted, bounded retention | Implemented |

---

## 5. Updated target directory structure

```text
src/
├── kernel/
├── contracts/
├── domains/
│   ├── network/
│   ├── loadout/
│   ├── jobs/
│   ├── markets/
│   ├── expeditions/
│   ├── inventory/
│   └── daily-ops/
├── application/
│   ├── auto-job/
│   ├── auto-valuable/
│   ├── market-sync/
│   ├── expedition-sync/
│   ├── stash-sort/
│   ├── daily-hack/
│   └── background-scheduler/
├── infrastructure/
│   ├── game-ws/
│   ├── game-http/
│   ├── storage/
│   ├── logging/
│   ├── dom/
│   ├── browser/
│   └── time/
├── contexts/
│   ├── main-world/
│   ├── content/
│   ├── background/
│   ├── popup/
│   └── devtools/
├── ui/                        # Preact + TypeScript
│   ├── app/
│   ├── components/
│   ├── hooks/
│   ├── stores/
│   ├── i18n/
│   └── view-models/
└── standalone/                # legacy DOM solver adapters only if retained
```

---

## 6. Updated UI architecture

### 6.1 Component boundaries

```text
PopupApp
├── HelperModeBar
├── PinnedTimersPanel
├── AutomationToggles
├── DailyOpsPanel
├── AutoJobPanel
├── ValuableSellerPanel
├── MarketsPanel
├── ExpeditionsPanel
├── InventoryPanel
├── LoadoutPanel
└── VersionFooter
```

Each panel receives a typed view model and callbacks. It does not import storage, game commands, or domain algorithms.

### 6.2 State

- Feature-scoped stores.
- No single global `popup/state.js`.
- No large Redux-like store.
- Signals vs local hooks/store is **Open**.
- Cross-panel state goes through application view models, not component-to-component mutation.

### 6.3 i18n

- Key-based catalog, not exact-text matching.
- No DOM observer translation.
- English/Chinese keys are explicit.
- Dynamic values use typed interpolation.
- Translation coverage is measurable in tests.

### 6.4 Testing

- Pure view-model tests.
- Component render tests with a DOM test environment.
- No live game dependency.
- Screenshot/manual checklist for complex panels (loadout, inventory, markets).

---

## 7. Updated loadout architecture

### 7.1 Catalog

```text
ItemCatalog
├── catalogVersion
├── gameVersion
├── hardware[]
├── software[]
└── checksum
```

No player state.

### 7.2 Inventory

```text
InventorySnapshot
├── ownedHardwareIds
├── ownedSoftwareIds
├── equippedHardware
├── equippedSoftwareIds
└── capturedAt
```

### 7.3 Plan

```text
LoadoutPlan
├── software
├── hardware
├── targetAbility
├── target
├── power
├── requiredPower
├── feasible
├── switchCost
└── policyId / policyVersion
```

### 7.4 Optimizer

- Candidate generation from owned items.
- Hardware feasibility filtering.
- Ability-specific scoring.
- Current-plan retention.
- Explicit infeasible result.
- Policy-driven PSU selection.
- Cache keyed by catalog/inventory/target/policy.

### 7.5 Catalog extraction

Required tooling:

```text
scripts/catalog/extract.ts
scripts/catalog/validate.ts
scripts/catalog/diff.ts
scripts/catalog/checksum.ts
```

Required metadata:

```text
source
capturedAt
accountType
gameVersion
catalogVersion
extractorVersion
```

Licensing remains Open.

---

## 8. Updated token and logging architecture

### 8.1 Token flow

```text
Game page
  -> content-early captures live session
  -> content auth adapter keeps token in memory
  -> background/popup request authenticated operation
  -> content performs operation and returns typed result
```

Rules:

- No persisted token by default.
- No token in `chrome.storage.local`.
- No token in exported logs.
- No token in global window state longer than required.
- Session loss is an explicit session event.

### 8.2 Log redaction

Redact at write time and export time:

```text
Authorization
Bearer tokens
JWT
cookies
session IDs
account identifiers where not needed
```

Add automated tests that feed a token-like string into logging and assert it never appears in output.

---

## 9. Updated implementation roadmap

| Phase | Change caused by decisions | Exit criteria |
|---|---|---|
| Phase 0 | TypeScript, Preact, Zod, Vitest, dev extension identity, `v2` branch | CI typecheck/test/build; dev build side-by-side; fixtures |
| Phase 1 | Kernel/contracts, Zod boundaries, content auth adapter, Preact shell | One panel end-to-end; no persisted token |
| Phase 2 | Network domain shadow mode | Path parity; no endpoint changes |
| Phase 3 | Market path + endpoint lease | Path-through parity; no races |
| Phase 4 | Catalog extraction, optimizer, PSU policy, non-max fixtures | Plan parity; explicit infeasible; catalog validated |
| Phase 5 | Jobs/markets/expeditions/inventory | Feature parity per slice |
| Phase 6 | Preact UI + key-based i18n | Panel parity; no business logic in components |
| Phase 7 | Final identity, migration, cleanup, release | Must-preserve parity; rollback plan |

### Roadmap status

The table above is the original plan and is kept for history. Implementation has moved past the early phases: see section 10 for current status and the feature inventory for per-feature parity. Phase 7 (final identity, migration, release) remains open.

---

## 10. Implementation status

Status: **2.0 rewrite implemented on `v2`; H9 is complete and H10 is partially addressed.**

- Source was promoted from the transitional `v2/` workspace to the repository root `src/`.
- v1 source was removed from the working tree; it remains in git history as the behavior reference.
- Build output is `dist/`; current build is `2.0.5-salta.272`.
- Background split (H8): 54-line composition root, 103 bridge commands across 17 handler modules, and port-driven automation coordinators.
- Side panel split: per-domain hooks, pure view models and page panels.
- H1 release workflow fixed: typecheck/lint/test/build, zip `dist/`, generated release notes.
- H2/H3/H5/H6/H7 complete; H9 store migrations complete; H4 partial because the static catalog artifact is still absent (the loader now merges when it appears).
- H10 integration/UI tests are partially addressed (decrypt pipeline, storage migrations and architecture boundaries) but background/content/portal orchestration and UI rendering remain deferred.
- **Loadout/auto-decryption:** the Loadout page and automatic File Decryption share `LoadoutService.ensure()` + `optimizeLoadout()`. File Decryption takes the job first, routes/accesses the target, then uses exact-target planning and an adaptive hardware order before decrypting, and reports plan/step diagnostics.
- **Network routing (dev.236):** `RouteExecutor` tries the direct target endpoint before path-through. Path-through starts from the current endpoint/last reached node and falls back to home; HACK loadout is equipped lazily only after a retryable hack error.
- **Release pipeline:** tag-driven. A tag must equal `package.json.version + cor3Fork.releaseLabel`; the workflow builds `COR3 Helper v<version>-salta.zip` and publishes a GitHub Release.
- **Verification:** typecheck, lint, 81 test files / 363 tests and build pass.
- **Parity snapshot:** 89 implemented/improved, 37 partial and 20 missing of 147 v1 parity rows; most missing rows are presentation polish.
- H8 details: see [`cor3-helper-2.0-h8-background-decomposition-design.md`](./cor3-helper-2.0-h8-background-decomposition-design.md).
- Current feature and debt status: see [`cor3-helper-2.0-feature-inventory-and-tech-debt.md`](./cor3-helper-2.0-feature-inventory-and-tech-debt.md).

Remaining focus:

1. H10: add fake-tab integration tests for background/content/portal orchestration and component-level UI tests.
2. H4: generate and commit `catalog/item-catalog.json` from a real max-account module dump.
3. M7: remove or implement the remaining unused/reserved settings.
4. O-016: decide whether to implement settings-only sync.
5. Live-game smoke for the dev.229/230 decrypt-loadout changes (`.xvct`, mixed file types, Helper Mode and disabled Auto Jobs).

## 11. Open items

| ID | Item | Why it is open | Suggested owner/decision |
|---|---|---|---|
| O-001 | Catalog redistribution/licensing | Account access ≠ public redistribution rights | Maintainer + license review |
| O-002 | Final extension identity | **Narrowed:** local and release share the same key/ID; migration from v1 remains open | Maintainer |
| O-003 | Preact Signals vs local hooks/store | **Resolved:** local hooks + pure view models chosen in H8 Phase 7 | — |
| O-004 | Hidden route model | Task-gated vs permanent | Network validation |
| O-005 | Target browser matrix | Chrome only vs Chromium/Edge | Maintainer |
| O-006 | v1 critical-fix policy | Freeze scope | Maintainer |
| O-007 | “Must preserve” parity list | Scope control | Maintainer review |
| O-008 | Catalog extraction game-terms compliance | Legal/account safety | Maintainer |
| O-009 | Future PSU policies | Not needed now | Later optimizer work |
| O-010 | Preserve reachability test as diagnostics | Dev TC deprecated | Maintainer/network owner |
| O-011 | H9 store migrations | **Resolved in dev.230:** remaining stores use versioned envelopes with migrations and tests | — |
| O-012 | H10 integration/UI tests | **Partial:** decrypt pipeline, storage migrations and boundaries covered; background/content/portal and UI rendering still lack coverage | Maintainer, next quality task |
| O-013 | Release build number automation | **Resolved:** release tag must equal `version + releaseLabel`; `cor3Fork.build` is the local build counter | — |
| O-014 | Static catalog artifact | **Partial:** the loader now merges; the artifact still needs a real module dump | Catalog owner (H4) |
| O-015 | PSU policy post-processing | **Resolved in dev.230:** `MinPowerPsuPolicy` added; ranking goes through the policy and the cache key includes policy version | — |
| O-016 | Settings-only sync | The [settings sync assessment](./cor3-helper-2.0-settings-sync-assessment.md) is a proposal; 2.0 remains local-only | Maintainer |

---

## 12. Impact summary

### Positive impacts

- Clear branch and rollback strategy.
- Strong type safety and runtime validation.
- UI redesign with a component model.
- Much lower token/log exposure.
- Clear separation of static catalog, dynamic inventory, and derived plans.
- Non-max accounts become a first-class test target.
- PSU policy becomes extensible without changing the optimizer core.
- Legacy tools and dead code stop polluting the design.

### Costs

- TypeScript/Zod/Preact setup and migration cost.
- Preact UI parity work is significant.
- Content-mediated auth adds a request layer.
- Static catalog extraction, validation, and provenance work.
- More upfront tests and CI.
- Temporary dual maintenance of v1 and 2.0.

### Conflict handling rule

If a future implementation choice conflicts with an approved decision, record it as a new ADR/open item and ask the maintainer. Do not silently override D-001..D-010.

---

## 13. Approval record

Approved by maintainer on 2026-11-08:

- D-001 repository strategy
- D-002 TypeScript
- D-003 Zod
- D-004 Preact
- D-005 token/log security
- D-006 static catalog/inventory split
- D-007 PSU policy
- D-008 non-max support
- D-009 Dev TC/legacy policy
- D-010 dedicated 2.0 extension identity

This record does not authorize code rewrite. Implementation starts only after maintainer confirmation.
