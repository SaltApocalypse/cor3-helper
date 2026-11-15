# COR3 Helper 2.0 — Salta Fork

**English** · [简体中文](./README.zh-CN.md)

A Chrome extension for [cor3.gg](https://cor3.gg) that monitors markets, jobs, expeditions, daily ops, inventory and loadout, and provides optional automation.

This branch (`v2`) contains the **2.0 rewrite**. It is a development build, not the stable v1 extension.

> **Personal fork:** [SaltApocalypse/cor3-helper](https://github.com/SaltApocalypse/cor3-helper), based on [Femtoce11/cor3-helper](https://github.com/Femtoce11/cor3-helper). This is not an official upstream release.
>
> - Fork releases: <https://github.com/SaltApocalypse/cor3-helper/releases>
> - Upstream project: <https://github.com/Femtoce11/cor3-helper>

## Status

- Version: `package.json` `version` for releases; `cor3Fork.build` for development builds
- Branch: `v2`
- Architecture: typed, layered 2.0 rewrite (domain / application / infrastructure / contexts)
- Build output: `dist/` (Manifest V3)
- Verification: typecheck, lint, Vitest (80 files / 355 tests) and build pass at `2.0.0-salta-dev.234`; CI runs the same checks on pull requests
- Known gaps: the static catalog artifact still needs a real module dump, and background/content/portal plus UI rendering tests remain incomplete; see [feature inventory](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md)

## Requirements

- Node.js 24+
- npm 11+
- Chrome 120+ (or another Chromium browser with side panel support)

## Build

```bash
npm install
npm run build       # -> dist/
```

Load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked** and select the `dist/` directory
4. Open <https://cor3.gg>

Minified build:

```bash
npm run build:min
```

## Release

Releases are tag-driven. Set `package.json` `version`, push a matching tag, and GitHub Actions builds and publishes `COR3 Helper v<version>-salta.zip`.

```bash
# package.json: "version": "2.1.0"
git add package.json
git commit -m "chore(release): v2.1.0-salta"
git tag v2.1.0-salta
git push origin v2
git push origin v2.1.0-salta
```

The tag must equal `<version>-<cor3Fork.releaseLabel>`. Development builds keep using `cor3Fork.build` and the `2.0.0-salta-dev.<build>` version. Dev and release share the same extension key; only the display name and version differ.

## Scripts

| Command | Purpose |
|---|---|
| `npm run build` | Build the extension into `dist/` |
| `npm run build:min` | Minified build |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | oxlint over `src/` |
| `npm test` | Vitest unit tests |
| `npm run format` | Format source with Prettier |
| `npm run clean` | Remove `dist/` and `dist-tools/` |
| `npm run bump:build` | Increment `cor3Fork.build` for a functional update |
| `npm run catalog` | Build/validate the static item catalog CLI |

## Project structure

```
src/
  kernel/          Result, IDs, clocks, shared primitives
  contracts/       Zod boundary schemas (bridge, storage, game, tab)
  domains/         Pure domain model and rules
  application/     Use cases and ports
  infrastructure/  Chrome, storage, WebSocket and logging adapters
  contexts/        background, content, main-world, popup, sidepanel, devtools
  ui/              Preact components, hooks, view models, i18n
  html/            Popup / side panel / DevTools HTML and CSS
  tools/           Catalog CLI and developer tooling
build.js           esbuild build script
manifest.json      Manifest V3 source (version injected at build time)
```

`dist/` is generated and ignored by git.

## Documentation

- [Architecture](./ARCHITECTURE.md)
- [Module status](./MODULES.md)
- [Architecture decision record](./docs/architecture/cor3-helper-2.0-architecture-decision-record.md)
- [Architecture audit](./docs/architecture/cor3-helper-2.0-architecture-audit.md)
- [Feature inventory and technical debt](./docs/architecture/cor3-helper-2.0-feature-inventory-and-tech-debt.md)
- [H8 background decomposition design](./docs/architecture/cor3-helper-2.0-h8-background-decomposition-design.md)
- [Settings sync assessment](./docs/architecture/cor3-helper-2.0-settings-sync-assessment.md)
- [Static catalog generation](./catalog/README.md)
- [Security notes](./docs/security.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md) for the project rules, module boundaries and definition of done.

## Disclaimer

This extension is not affiliated with, partnered with, or endorsed by cor3.gg, Fragmentary Order, or Rant Gaming Studios.

Automation may be detectable by the game's developers and could put your account at risk. Understand what a feature does before enabling it. The authors assume no liability for consequences of use.

## License

See [LICENSE](./LICENSE).
