# Static item catalog

`item-catalog.json` is a generated, versioned dump of hardware and software
definitions from a maxed account. It is **not committed** yet because it must
come from real game data, not from hand-written fixtures.

## Generate

1. Capture a raw module dump with `ownedHardware` / `ownedSoftware` arrays in
   the shape accepted by `contracts/catalog-source.ts`, or capture the
   `V2_LOADOUT_GET` payload directly.
2. Build and validate the artifact:

```bash
# Already-shaped catalog source
npm run catalog -- build --input /path/to/raw-source.json --output catalog/item-catalog.json

# Raw V2_LOADOUT_GET capture (wraps it with provenance)
npm run catalog -- from-loadout --input /path/to/loadout.json --output catalog/item-catalog.json \
  --catalog-version 2026.11.15 --game-version <game-version>

npm run catalog -- validate catalog/item-catalog.json
```

A normal account only captures the items it owns; use a maxed account for a
complete static catalog.

`build` also writes `catalog/item-catalog.json.manifest.json` with the
checksum, counts and provenance.

## Runtime behavior

`build.js` copies `catalog/item-catalog.json` into `dist/` when it exists.
`chrome-tab-loadout-adapter` then merges the artifact with the runtime catalog
built from the player's owned items:

- runtime definitions win on id conflicts (they carry current player data);
- static-only definitions are added for items the player does not own yet;
- no artifact means the runtime catalog is used unchanged.

Do not fabricate or hand-edit the catalog: the optimizer treats it as
authoritative for item definitions.
