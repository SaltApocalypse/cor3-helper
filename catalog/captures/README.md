# Local game captures

This directory keeps real `loadout:get.options` dumps for local debugging and
for regenerating `catalog/item-catalog.json`.

- `*.json` files here are **gitignored**: they contain personal account data
  (owned items, equipped modules) and must not be committed.
- Use the extension's **Developer → Loadout dump** tool to produce a new file.

Naming convention:

```text
catalog/captures/loadout-YYYY-MM-DD.json
```

Regenerate the static catalog:

```bash
npm run catalog -- from-loadout \
  --input catalog/captures/loadout-2026-11-24.json \
  --output catalog/item-catalog.json \
  --catalog-version 2026.11.24 --game-version <game-version>
```
