# AGENTS.md — cor3-helper (v2)

## Current branch

`v2` is the 2.0 rewrite branch. The v1 implementation is no longer present in the working tree; it remains available in git history (`main`, `experimental`, and the `v2` ancestry).

- All extension source lives under `src/`.
- v1 is a behavior reference only. Do not reintroduce v1 source or its static path table.
- The development build writes to `dist/`.

## Commands

```bash
npm run typecheck       # strict TypeScript check
npm test                # Vitest
npm run lint            # oxlint src
npm run build           # build extension -> dist/
npm run build:min       # minified build -> dist/
```

## Hard rules

1. All new source is TypeScript (`.ts`/`.tsx`). Do not add new `.js` source.
2. Domain code must not import `chrome`, `window`, `document`, WebSocket, fetch, or IndexedDB.
3. Application code depends on ports, not concrete infrastructure.
4. UI components use Preact and do not call browser/game APIs directly.
5. Validate external data with Zod at the boundary only.
6. Do not persist bearer tokens.
7. Redact tokens, JWTs, cookies, and session IDs from logs/exports.
8. Do not use a global event bus or service locator.
9. Do not edit architecture decisions silently; add an ADR/open item instead.
10. Do not recreate the v1 static path table in new code.

## Architecture

See:

- `ARCHITECTURE.md`
- `MODULES.md`
- `docs/architecture/cor3-helper-2.0-architecture-decision-record.md`
- `docs/architecture/cor3-helper-2.0-architecture-audit.md`
- `docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md`

Background context composition and per-domain modules:

- `src/contexts/background/index.ts` (composition root)
- `src/contexts/background/handlers/` (bridge adapters)
- `src/contexts/background/automation/` (automation coordinators)
- `src/contexts/background/composition/` (runtime wiring)

## Definition of done

- typecheck passes
- tests pass
- lint passes
- build passes
- behavior parity is checked for any replaced feature
- docs/ADR updated for cross-cutting changes
