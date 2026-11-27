# Mercenary expedition mystery egg (2.0 rewrite)

Status: implemented at `2.0.10-salta.330`.

## Trigger

The easter egg is evaluated only for **Helper automatic payments** (`mercAutoPayEnabled`).
Manual in-game payments do not trigger it.

A payment qualifies when all of the following are true:

- final `riskScore >= 95`;
- the payment response contains exactly two loot entries;
- both item names are in the pool:
  - `Artificial milk`
  - `CCS "Kaloshi" Utility boots`
  - `Old Abibas beanie`;
- the outcome is not a known non-full outcome (`PARTIAL_SUCCESS`, `FAILURE`, `DEATH`);
- an unknown non-empty outcome fails closed.

A full success always pays exactly two pool items, so the item pattern is the main
full-success check. Missing outcome data is accepted only when the exact two-item
pattern is present.

## Data flow

1. `ExpeditionService.payout()` opens each ready expedition and now keeps the
   `open.container` response instead of discarding it.
2. `mapExpedition()` reads `outcome`, `completedAt`, `containerData`/`container`
   and returns normalized loot items.
3. `ExpeditionCycle` records the last payout summary in the
   `auto-expedition-payout` automation state (internal only, never rendered) and,
   when `mysteryEggEnabled` is on, evaluates the condition.
4. On a match, it persists `auto-expedition-egg`, sets the run state to idle,
   disables Auto Expedition and publishes `expeditions.auto.done`.
5. The UI fetches the egg state through `expeditions.autoStatus` and renders a
   card-local banner in the Auto Expedition card. The card auto-expands once.
6. Archived expeditions are separated from the active list. The active stage
   list only shows expeditions that still need payment; archived entries live
   in a collapsed "History" section after the auto-pay option.

The egg state survives panel reloads until a new expedition starts:

- the auto launch path clears it on a successful launch;
- `expeditions.view` clears it when a different in-progress expedition appears
  (covers manual launches).

## Settings

`mysteryEggEnabled` (default `false`) is exposed in Settings → Basic settings,
immediately after Developer tools.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` (127 files / 1056 tests) and
`npm run build` pass at `2.0.10-salta.330`.
