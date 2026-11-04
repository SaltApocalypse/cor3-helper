# COR3 WS / mailbox / stash protocol notes

Last updated: 2026-11-03
Source captures: `cor3-ws-export_1.json` … `cor3-ws-export_5.json` (headers contain the recorded player actions).

> **Security note:** the capture files are local-only and are ignored by git
> (`cor3-ws-export*.json`) because they contain `jwtToken` values. Never commit
> them or paste them into a public issue/release.

This document records the live-game events used by the helper, the payload shapes observed in the captures, and the internal bridge messages that connect the page-world interceptor, the content script, and the popup.

---

## 1. Frame format

All game events use Socket.IO v4 frames:

```text
42["<eventName>",{"event":{"name":"<eventName>","action":"<action>"},"data":{...},"requestId":"..."}]
```

- `eventName`: top-level namespace (`mail`, `stash`, `expeditions`, `drone-missions`, `gameplay`, …).
- `event.action`: action inside that namespace.
- `data`: response payload (absent/`null` on errors).
- `error`: `{ "message": "..." }` on failures.
- `requestId`: present on responses; useful for correlating commands.

Server pushes (e.g. `mail update.state`) use the same frame without a request.

---

## 2. Mailbox (`mail`) — v1.7+ reward delivery

### 2.1 `mail update.state` (server push)

```json
{
  "pendingCount": 2,
  "messages": [
    {
      "id": "01a1a089-...",
      "createdAt": "2026-11-03T08:32:01.582Z",
      "sender": "远征队",
      "title": "远征战利品",
      "text": "远征期间回收的物品已可领取。",
      "status": "PENDING",
      "attachments": [
        {
          "id": "01a1a089-...",
          "messageId": "01a1a089-...",
          "itemConfigId": "019d719f-...",
          "quantity": 1,
          "source": "EXPEDITION",
          "sourceId": "01a1a067-...",
          "canDelete": true,
          "slotIndex": 0,
          "claimedAt": null,
          "createdAt": "2026-11-03T08:32:01.582Z",
          "type": "ITEM",
          "category": "CONSUMABLES_FOOD",
          "tier": "RARE",
          "name": "Artificial milk",
          "shortName": "Milk",
          "description": "...",
          "imageUrl": "https://cdn.cor3.gg/...",
          "width": 1,
          "height": 1,
          "canRotate": false,
          "maxStack": 1
        }
      ]
    }
  ]
}
```

Key facts:

- `message.status` is `PENDING` or `CLAIMED`.
- `attachment.source` values relevant to automation:
  - `EXPEDITION` → mercenary expedition loot. `sourceId` = expedition id.
  - `DRONE_MISSION` → personal drone loot. `sourceId` = drone mission id.
  - `QUEST_REWARD` / other sources are **not** auto-claimed by this helper.
- Attachments carry `width`/`height`/`canRotate`, so stash capacity can be estimated.
- The server pushes a fresh `update.state` when entering the stash room and after claims.

### 2.2 `mail claim.all`

Request:

```json
42["event",{"event":{"name":"mail","action":"claim.all"},"data":{"messageId":"01a1a089-..."}}]
```

Response:

```json
42["mail",{"event":{"name":"mail","action":"claim.all"},"data":{
  "results":[{"attachmentId":"01a1a089-...","status":"claimed"}]
}}]
```

- Claims **all attachments of one message**.
- The helper sends one `claim.all` at a time so the response can be correlated without relying on `requestId`.
- The server then pushes `mail update.state` and `stash update.state`.

### 2.3 `mail claim.item`

Request:

```json
42["event",{"event":{"name":"mail","action":"claim.item"},"data":{
  "attachmentId":"01a1a0a2-...",
  "placement":{"x":3,"y":31,"rotated":false}
}}]
```

Response:

```json
42["mail",{"event":{"name":"mail","action":"claim.item"},"data":{
  "attachmentId":"01a1a0a2-...","status":"claimed"
}}]
```

- Places a single attachment at an explicit stash grid cell.
- Used as a fallback when `claim.all` cannot auto-place due to grid fragmentation: the helper computes free rectangles from `stash get.state` and claims attachments one by one.

### 2.4 Reward flow

Mercenary expedition:

1. Expedition reaches `COMPLETED` (`containerOpenedAt` is still `null`).
2. Helper calls `expeditions open.container` (pay).
3. `open.container` response sets `containerOpenedAt` and `completedAt`; `containerData[].isCollected` is already `true`.
4. Rewards appear as `PENDING` mail messages with `source: "EXPEDITION"`.
5. Helper claims each message with `mail claim.all { messageId }`.
6. When no PENDING message remains for that expedition, auto-send refreshes mercenaries and launches the next expedition.

Personal drone:

1. Mission succeeds.
2. Rewards appear directly as `PENDING` mail messages with `source: "DRONE_MISSION"`.
3. Helper claims each message via `mail claim.all`.
4. After the matching mission's mail is claimed, auto-drone refreshes options and launches the next mission.

> The old `expeditions collect.all` path is **legacy** and is no longer used by the new flow.

---

## 3. Stash / warehouse grid (`stash`) — v1.7+

### 3.1 `stash get.state` / `stash update.state`

```json
{
  "gridWidth": 12,
  "usableRows": 60,
  "visibleRows": 60,
  "sortingTable": {
    "width": 15,
    "height": 0,
    "items": []
  },
  "rental": { "status": null, "expiresAt": null, "gracePeriodEndAt": null },
  "items": [
    {
      "location": "stash",
      "x": 4,
      "y": 3,
      "rotated": false,
      "width": 1,
      "height": 2,
      "canRotate": true,
      "backgroundColor": "",
      "id": "01a15e8b-...",
      "itemConfigId": "019d719f-...",
      "quantity": 1,
      "source": "EXPEDITION",
      "canDelete": true,
      "name": "SPI \"Smartwrench\" Powered adjustable wrench",
      "shortName": "Smartwrench",
      "tier": "RARE",
      "baseValue": 8107,
      "canSell": true,
      "sellPrice": 7296,
      "canCraft": true,
      "maxStack": 1,
      "imageUrl": "https://cdn.cor3.gg/..."
    }
  ],
  "maxCapacity": 720,
  "currentUsage": 214,
  "availableSpace": 506
}
```

Notes:

- The grid is `gridWidth` (12) × `usableRows` (60). `maxCapacity = gridWidth * usableRows`.
- `currentUsage = Σ(width * height)` over stash items. Legacy capacity fields are still present and remain footprint-based, so existing capacity checks continue to work.
- `items[].width`/`height` are the **effective** dimensions for the current orientation. If `rotated` is true, the base (unrotated) dimensions are `height × width`.
- `sortingTable` is the warehouse sorting/staging page:
  - width 15, height grows as items are placed;
  - items placed there are not in `items` (they live in `sortingTable.items`);
  - while it contains items, `gameplay update.state` reports `gameplayBlockReason: "stash-sorting"`;
  - if the warehouse page is closed/errors, the game returns those items to the stash using its default placement.

Tiers observed: `COMMON`, `RARE`, `SUPERRARE`, `EPIC`, `QUEST` (and `LEGENDARY` exists in the item config).

### 3.2 `stash move.item`

Request:

```json
42["event",{"event":{"name":"stash","action":"move.item"},"data":{
  "itemId":"01a1a0a6-...",
  "location":"sorting_table",
  "x":0,
  "y":0,
  "rotated":false
}}]
```

- `location`: `"stash"` or `"sorting_table"`.
- Response: full stash state (same shape as `update.state`) with `requestId`.
- The server rejects moves into occupied cells. The sorter therefore parks blocking items in the sorting table first.

### 3.3 `stash sell.item`

```json
42["event",{"event":{"name":"stash","action":"sell.item"},"data":{"itemId":"...","quantity":1}}]
```

- Quantity is per request; the helper sends one request per item (batch sell skips the per-sale stash refresh and does one refresh at the end).

### 3.4 `gameplay update.state`

```json
42["gameplay",{"event":{"name":"gameplay","action":"update.state"},"data":{
  "gameplayBlockReason":"stash-sorting"
}}]
```

- Used by the sorter to know when the sorting table is considered busy.
- `gameplayBlockReason` clears when the sorting table is empty.

---

## 4. Expeditions (`expeditions`)

### 4.1 Launch

Request (same shape as configure):

```json
42["event",{"event":{"name":"expeditions","action":"launch"},"data":{
  "mercenaryId":"...",
  "marketId":"...",
  "locationConfigId":"...",
  "zoneConfigId":"...",
  "goalId":"...",
  "hasInsurance":false
}}]
```

Successful response is a single expedition object with `status: "PREPARING"`.

Important fields:

- `completedAt`: set when the reward container is opened/paid (capture shows it set together with `containerOpenedAt`).
- `containerOpenedAt`: `null` until the player pays for the reward container.
- `containerData`: array of reward slots; after payment each entry has `isCollected: true`.
- `status`: `PREPARING` → `IN_PROGRESS` → `COMPLETED` (or `FAILED`).

### 4.1.1 Insurance

Mercenary expeditions only. `hasInsurance` is sent in **both** `configure` and `launch` requests:

```json
42["event",{"event":{"name":"expeditions","action":"configure"},"data":{
  "mercenaryId":"...",
  "marketId":"...",
  "locationConfigId":"...",
  "zoneConfigId":"...",
  "goalId":"...",
  "hasInsurance":true
}}]
```

The `configure` response includes:

- `isInsuranceAvailable`: whether insurance can be selected for this expedition.
- `insuranceCost`: insurance premium (0 when `hasInsurance` is false).
- `totalCost`, `prepaymentAmount`, `remainingAmount`: reflect the selected insurance.
- `riskScore`, `riskLevel`, `riskBreakdown`, `outcomeChances`, `duration`.

The `launch` response includes `hasInsurance` and `insuranceRefundAmount`.
In the capture, the insured launch returned `insuranceRefundAmount` equal to
`prepaymentAmount`.

The helper stores the setting as `autoSendMerc.hasInsurance` and exposes a
**Mercenary Insurance** toggle in the Mercenaries settings. The setting is
relayed to the page world so `configure` quotes and the actual `launch` use the
same value.

### 4.2 Open reward container

```json
42["event",{"event":{"name":"expeditions","action":"open.container"},"data":{"expeditionId":"..."}}]
```

- This is the “pay and send to stash” action.
- New behavior: loot is delivered to the **mailbox**, not directly to the stash.
- Response is the updated expedition object (with `containerOpenedAt`, `completedAt`, `containerData`).

### 4.3 Legacy `collect.all`

```json
42["event",{"event":{"name":"expeditions","action":"collect.all"},"data":{"expeditionId":"..."}}]
```

- Only used by the legacy fallback. The new flow uses `mail claim.all`.

### 4.4 `insert.archive`

- Emitted after rewards are fully claimed; the helper removes the expedition from cached data.

### 4.5 Launch errors

Examples observed/handled:

- `Maximum 1 active expedition allowed`
- `This location requires an elite mercenary`
- `Mercenary is not available`
- `insufficient-credits`
- Generic “already in progress / operation pending” errors (transient).

Transient errors are detected by keyword matching (English and Chinese) and must not disable automation.

---

## 5. Personal drone (`drone-missions`)

### 5.1 Actions

| Action | Direction | Notes |
|---|---|---|
| `get.options` | request/response | Full drone state: `drone`, `battery`, `locations[].missions[]`, `activeMissionId`, etc. |
| `launch` | request/response | `{ locationConfigId, missionConfigId }` |
| `resolve.event` | request/response | `{ missionId, eventId, optionId }` |
| `repair` | request/response | `{ targetDurability }`; response is the same full options shape |
| `claim` | request/response | Legacy claim. New flow claims via the mailbox instead. |
| `update` | server push | `{ droneId, durability, repaired }` after repair/durability changes |
| `completed` | server push | Mission completion payload |
| `get.archived` | request/response | `{ cursor, limit }` → `{ items, hasMore, nextCursor, totalCount }` |

### 5.2 Drone options shape (relevant fields)

```json
{
  "drone": {
    "durability": 100,
    "maxDurability": 100,
    "isRepairing": false,
    "isDestroyed": false
  },
  "battery": { "current": 100, "max": 100, "restoreSeconds": 0 },
  "activeMissionId": null,
  "locations": [
    {
      "id": "...",
      "name": "...",
      "baseRisk": 0,
      "missions": [
        { "id": "...", "name": "...", "batteryCost": 10, "durationSeconds": 600 }
      ]
    }
  ]
}
```

### 5.3 Drone claim flow (new)

1. Mission completes → rewards are already in `mail` with `source: "DRONE_MISSION"`, `sourceId = missionId`.
2. Helper claims the matching message(s) with `mail claim.all`.
3. Helper clears `droneCompleted`, refreshes `get.options`, and launches the next mission.

---

## 6. Internal bridge (extension ↔ page world)

### 6.1 content-early → content (`window.postMessage`)

| Type | Payload | Meaning |
|---|---|---|
| `COR3_WS_MAIL` | `{ action, data, error, requestId }` | Any `mail` event (`update.state`, `claim.all`, `claim.item`) |
| `COR3_WS_GAMEPLAY` | `{ data }` | `gameplay update.state` (block reason) |
| `COR3_WS_STASH_MOVE` | `{ data, error, requestId }` | `stash move.item` response |
| `COR3_WS_DRONE_UPDATE` | `{ data }` | `drone-missions update` push |
| `COR3_WS_CONTAINER_OPENED` | `{ data, error, requestId }` | `open.container` response (error is now forwarded) |
| `COR3_WS_EXPEDITION_LAUNCH_ERROR` | `{ error, transient, requestId }` | Any launch error that is not one of the known special cases |

### 6.2 content → content-early (`window.postMessage`)

| Type | Payload | WS command |
|---|---|---|
| `COR3_MAIL_CLAIM_ALL` | `{ messageId }` | `mail claim.all` |
| `COR3_MAIL_CLAIM_ITEM` | `{ attachmentId, x, y, rotated }` | `mail claim.item` |
| `COR3_STASH_MOVE_ITEM` | `{ itemId, location, x, y, rotated }` | `stash move.item` |
| `COR3_CHECK_MAIL` | `{ source, sourceId, timeoutMs? }` | internal: watch a mailbox source and claim it |
| `COR3_REQUEST_STASH` | – | re-join stash room (also triggers a fresh `mail update.state`) |

Internal content event:

| Type | Payload | Meaning |
|---|---|---|
| `COR3_MAIL_CLAIMED` | `{ source, sourceId, assumed }` | All PENDING mail for this source is claimed (or assumed done after a timeout) |

### 6.3 popup → content (`chrome.tabs.sendMessage`)

| Action | Payload | Meaning |
|---|---|---|
| `sortStash` | `{ mode: "default" \| "horizontal" }` | Start the warehouse sorter; progress is stored in `stashSortProgress` |
| `claimDrone` | `{ missionId }` | Claim drone rewards via the mailbox |
| `sellItem` | `{ itemId, quantity, skipStashRefresh? }` | Sell one item |
| `batchSellItems` | `{ items: [{ itemId, quantity }] }` | Batch sell (one request per item) |
| `requestStash` | – | Refresh stash |

---

## 7. Storage keys used by these features

| Key | Area | Meaning |
|---|---|---|
| `mailData` / `mailDataUpdatedAt` | local | Last `mail update.state` payload |
| `gameplayData` / `gameplayDataUpdatedAt` | local | Last `gameplay update.state` payload |
| `stashData` / `stashDataUpdatedAt` | local | Last stash state (grid + items) |
| `stashSorting` | local | `true` while the sorter is running; mailbox auto-claim is paused |
| `stashSortProgress` | local | `{ mode, phase, done, total, text, error?, startedAt, finishedAt? }` |
| `droneData` / `droneDataUpdatedAt` | local | Last `get.options`/`repair` state |
| `droneCompleted` / `droneCompletedUpdatedAt` | local | Last drone completion push |
| `droneWarning` | local | Human-readable drone warning/status |
| `mailWarning` | local | Human-readable mailbox claim warning/status |
| `autoDrone` | sync | Drone automation settings (`enabled`, `paused`, repair rules, …) |
| `autoSendMerc` | sync | Mercenary auto-send settings (including `hasInsurance`) |
| `autoSellCheapest` | sync | Whether to sell the cheapest items when the stash is full |

---

## 8. Error classification

### 8.1 Transient / busy

Matched by keyword (case-insensitive), both in content-early and content:

```text
already, in progress, in-progress, processing, busy, operation, pending, cooldown
正在, 已在, 操作中, 进行中, 处理中, 冷却
```

Behavior:

- Drone: do **not** pause; clear the pending-action lock, schedule a `get.options` refresh in ~2.5–4 s.
- Expedition launch: do **not** disable auto-send; mark `autoSendExpeditionBlocked`, request expeditions after 8 s so the state can settle.
- `open.container`: retry the payment up to 3 times with 4/8/12 s backoff.

### 8.2 Rate limit

- Matches `too many requests`, `rate limit`, `rate-limited`.
- Drone retries after 20/40/60 s, then disables after 3 retries.

### 8.3 Stash full

- `Insufficient stash capacity`, `stash.error.insufficient_capacity`, `stash full`, or any `capacity` message.
- Mail auto-claim checks `maxCapacity - currentUsage` against the message footprint before claiming.
- If space is insufficient and `autoSellCheapest` is on, the helper sells the cheapest sellable items, then retries.

---

## 9. Rarity order

Used by the popup list and the warehouse sorter:

```text
QUEST (0) > LEGENDARY (1) > EPIC (2) > SUPERRARE (3) > RARE (4) > COMMON (5)
```

Notes:

- `QUEST` is a value of the `tier` field, i.e. it is treated as a rarity by the game data. Quest items are usually `canSell: false`.
- `SUPERRARE` was added between `RARE` and `EPIC` (per the task), while `QUEST` is kept first per the latest decision.

---

## 10. Warehouse sorting notes / limitations

- If `sortingTable.items` is non-empty, the sorter refuses to start (close the warehouse window to let the game return those items first).
- **Smart Sort** groups by rarity, then by item height (tallest first), keeps identical item types together, and packs multiple types onto the same shelf. Items stay upright unless their base width exceeds the grid.
- **Compact Sort** is the old first-fit layout, kept as a fallback for nearly full warehouses.
- If Smart Sort exceeds `usableRows`, the sorter automatically falls back to Compact Sort and stores a notice in `stashSortNotice`.
- The sorter computes the full target layout before sending any command. If both layouts exceed the row limit, the sort is rejected.
- Already-correct items are skipped.
- Only items blocking a target are parked in the sorting table; they are moved back to their targets afterwards.
- Every move is serialized and waits for the `stash move.item` response (9 s timeout, ~220 ms gap).
- If a move fails, the sorter stops and tries to return items still in the sorting table to their original cells. Items already placed stay in the stash.
- The sorting table width is 15; if a staged item is wider, the sorter rotates it when allowed.
- `stashSorting` is set while running, so mailbox auto-claim pauses; it is cleared on success, failure, or exception.

---

## 11. Adding a new WS command (pattern)

1. Add a `window.__cor3Xxx` wrapper in `src/content-early/ws-commands.js` (or the feature module) using `wsSend`.
2. Relay the response in `src/content-early/ws-message-handler.js` (or the feature handler) via `window.postMessage`.
3. Add a `postMessage` dispatcher branch in `src/content-early/message-listener.js` if the content script needs to send it.
4. Add a content-side listener in the relevant `src/content/*.js` module and persist state in `chrome.storage.local`.
5. If the popup needs it, add a `chrome.runtime.onMessage` action and a popup UI module.

This keeps the page-world (MAIN) and isolated-world (content) boundaries explicit.
