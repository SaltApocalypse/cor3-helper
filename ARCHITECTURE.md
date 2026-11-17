# Architecture

## Status

The project is on the `v2` branch and contains the 2.0 rewrite. v1 is no longer in the working tree; it remains available in git history as a behavior reference.

Last verified: 2026-11-15 at build `2.0.5-salta.272`. Typecheck, lint, Vitest (93 files / 448 tests) and build pass. The remaining gaps are tracked in the feature inventory (H4, H10, M7, O-016).

Authoritative decisions:

- [`cor3-helper-2.0-architecture-decision-record.md`](./docs/architecture/cor3-helper-2.0-architecture-decision-record.md)
- [`cor3-helper-2.0-architecture-audit.md`](./docs/architecture/cor3-helper-2.0-architecture-audit.md)

## Runtime contexts

```text
MAIN world       content-early + injected game engines
ISOLATED world   content bridge + DOM automation + SAI overlay
Service worker   background scheduler
Extension UI     Preact popup / side panel / detached window / DevTools
```

Every cross-context message uses a typed, versioned envelope. No new global `window.__cor3*` state is allowed. Cross-context messages are validated with Zod at the receiving boundary.

## Layers

```text
Presentation (Preact UI)
        ↓
Application use cases
        ↓
Domain
        ↑
Infrastructure adapters
        ↑
Context composition roots
```

Rules:

- Domain is pure TypeScript; no `chrome`, `window`, DOM, WebSocket, fetch, or IndexedDB.
- Application depends on ports and domain; not concrete infrastructure.
- UI does not call browser/game APIs directly.
- Infrastructure implements ports and validates external data with Zod.
- Contexts are the only composition roots.
- Use manual dependency injection; no service locator or global event bus.
- Expected failures use `Result<T, E>`; unexpected failures throw.

## Automation and loadout

Automation coordinators live in `src/contexts/background/automation/` and are Chrome-free; they receive scheduler, settings, clock, event and store ports. The Loadout page and automatic File Decryption both call the same `LoadoutService`/`optimizeLoadout` path, so “recommended loadout” and decrypt loadouts cannot drift into different optimizers.

A known decrypt target is planned exactly from owned software. The unrelated DECRYPT fallback is reserved for unknown file types. Hardware is installed in an order that keeps the current CPU/GPU draw within the target PSU, and File Decryption applies its plan before the job is taken. When `catalog/item-catalog.json` is present, its definitions are merged with the runtime catalog (runtime wins by id); without it, the runtime catalog is used unchanged.

## Source layout

```text
src/kernel/          Result, IDs, clocks
src/contracts/       bridge, game, storage, tab schemas
src/domains/         network, loadout, jobs, markets, expeditions, inventory, daily-ops
src/application/     use cases and ports
src/infrastructure/  Chrome, storage, WebSocket, logging adapters
src/contexts/        main-world, content, background, popup, sidepanel, devtools
src/ui/              Preact components, hooks, view models and i18n
src/html/            popup/side-panel/DevTools HTML and CSS (the detached window reuses sidepanel.html)
```

The 2.0 source was promoted from the transitional workspace to the root `src` layout on the `v2` branch; legacy v1 source was removed from the working tree.

## Approved technology

- Strict TypeScript
- Zod at external boundaries
- Preact + TypeScript UI
- esbuild
- Vitest
- GitHub Actions CI (typecheck, lint, test, build)
- Release identity (`COR3 Helper 2.0`, shared by local and release builds)

## Release

Releases are tag-driven. `package.json.version` plus `cor3Fork.releaseLabel` must equal the pushed tag (`v<version>-<releaseLabel>`). GitHub Actions verifies the version, builds the release manifest (`COR3 Helper 2.0`), packages `COR3 Helper v<version>-salta.zip`, and publishes the GitHub Release. Local builds use `<version>-salta.<build>` and releases use `<version>-salta`; both share the same extension key.

## Security

- Do not persist bearer tokens.
- Content mediates authenticated game/API calls.
- Redact Authorization/JWT/cookie/session fields from logs, snapshots, and exports.
- The 2.0 build uses a dedicated extension identity shared by local and release builds. Migration from v1 remains open (O-002).

## Commands

```bash
npm run typecheck
npm test
npm run lint
npm run build          # extension -> dist/
```
