# Contributing to COR3 Helper 2.0

Thanks for your interest in contributing! This branch (`v2`) contains the 2.0 rewrite. The v1 implementation is no longer in the working tree; it is available in git history as a behavior reference.

## Getting started

Requirements:

- Node.js 24+
- npm 11+
- Chrome 120+ (or another Chromium browser with side panel support)

Setup:

```bash
git clone https://github.com/<your-account>/cor3-helper.git
cd cor3-helper
git checkout v2
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked** and select the generated `dist/` directory
4. Open <https://cor3.gg> and test against the live game

Re-run `npm run build` after source changes, then reload the extension.

## Project structure

```text
src/kernel/          Result, IDs, clocks, shared primitives
src/contracts/       Zod boundary schemas (bridge, storage, game, tab)
src/domains/         Pure domain model and rules
src/application/     Use cases and ports
src/infrastructure/  Chrome, storage, WebSocket and logging adapters
src/contexts/        background, content, main-world, popup, sidepanel, devtools
src/ui/              Preact components, hooks, view models and i18n
src/html/            Popup / side panel / DevTools HTML and CSS
src/tools/           Catalog CLI and developer tooling
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for layer rules, [MODULES.md](./MODULES.md) for the module map, and [AGENTS.md](./AGENTS.md) for the hard rules.

## Development workflow

1. Create a feature branch from `v2`.
2. Make focused, atomic changes.
3. Run the checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The same checks run in GitHub Actions for pushes and pull requests targeting `v2`.

4. Test the changed feature in Chrome against cor3.gg.
5. Update the relevant documentation (`README`, `ARCHITECTURE`, `MODULES`, feature inventory, ADR) when behavior, layout or decisions change.
6. Local builds use `npm run bump:build` to increment `cor3Fork.build`. Release builds do not use the local build counter; see below.

Formatting:

```bash
npm run format
npm run format:check
```

## Release

Releases are tag-driven. The tag must equal `package.json.version` plus `cor3Fork.releaseLabel`:

```bash
# 1. set "version" in package.json (for example 2.1.0)
# 2. commit
git add package.json
git commit -m "chore(release): v2.1.0-<maintainer>"

# 3. push the branch and the tag
git push origin v2
git tag v2.1.0-<maintainer>
git push origin v2.1.0-<maintainer>
```

GitHub Actions then runs typecheck/lint/test/build, packages `dist` as `COR3 Helper v2.1.0-<maintainer>.zip`, and publishes the GitHub Release. A tag that does not match the committed version fails before building.

Do not use `git push --tags`: the repository carries upstream v1 tags. Push the specific release tag.

## Code rules

- All new source is TypeScript (`.ts`/`.tsx`). Do not add new `.js` source; `src/libs/` is vendored exception.
- Domain code must not import `chrome`, `window`, `document`, WebSocket, fetch or IndexedDB.
- Application code depends on ports, not concrete infrastructure.
- UI components use Preact and do not call browser/game APIs directly.
- Validate external data with Zod at the boundary only.
- Do not persist bearer tokens. Redact tokens, JWTs, cookies and session IDs from logs and exports.
- Use `Result<T, E>` for expected failures; throw only for unexpected failures.
- Do not use a global event bus or service locator.
- Do not recreate the v1 static path table.
- Do not commit runtime logs, diagnostic exports or generated tool output (`*.log`, `dist-tools/`, `dist/`).

## Submitting changes

1. Fork the repository and create a branch from `v2`.
2. Make focused, atomic commits.
3. Open a Pull Request with a clear description of the change and why it is needed.
4. Include the checks you ran and any manual game testing.
5. Reference related issues.

## Reporting bugs

Use the [Bug Report](https://github.com/SaltApocalypse/cor3-helper/issues/new?template=bug_report.md) template and include:

- steps to reproduce
- expected vs actual behavior
- console and DevTools Log Viewer output (redact tokens and session data)
- extension build version (from `dist/manifest.json` or `package.json`)

For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.
