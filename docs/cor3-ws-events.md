# COR3 WS / mailbox / stash protocol notes

Last updated: 2026-11-15 (v2 bridge/storage); game captures 2026-11-03
Source captures: `cor3-ws-export_1.json` … `cor3-ws-export_5.json` (headers contain the recorded player actions).

> **Security note:** the capture files are local-only and are ignored by git
> (`cor3-ws-export*.json`) because they contain `jwtToken` values. Never commit
> them or paste them into a public issue/release.

This document records the live-game events used by the helper and the payload shapes observed in the captures.

> **Scope:** sections 1–5 document live-game protocol observations and are kept as reference. Sections 6–7 describe the current v2 extension bridge and persistence. Revalidate game events against a fresh capture after game updates.

---

## 1. Frame format

Game events use Socket.IO v5 / Engine.IO 4 framing; binary payloads are msgpack-encoded. Text frames still use packet prefixes such as `42` (Engine.IO message + Socket.IO event):

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
- In v2 the background joins the dedicated `mail` room and requests `mail get.state` explicitly; it does not rely on stash-room pushes. The payload shape above is unchanged.

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

The helper stores the setting as `autoSendMerc.hasInsurance` and exposes it as
the **Add insurance** switch next to **Auto expedition**. The setting is relayed
to the page world so `configure` quotes and the actual `launch` use the same
value. Mercenary selection is automatic: elite USOL > normal USOL > normal
CORE/HOME, with total cost ascending and risk ascending as a tie-breaker.

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

### 5.4 Automation behavior

- Mission selection is automatic: lowest `batteryCost`, then lowest
  `location.baseRisk`, then shortest `durationSeconds`.
- Auto repair is optional. When enabled, it triggers when `battery.current < 30`
  or `durability <= 60`, repairs to `targetDurability: 100`, and waits for the
  repair to finish without launching another action.
- Repair failure pauses auto expedition and reports the reason in `droneWarning`.
- Drone decisions are always resolved with the aggressive policy.
- The helper no longer waits for a full battery before launch; it launches when
  the current battery can cover the selected mission cost.

---

## 6. Extension bridge (v2)

### 6.1 Page world ↔ content

The MAIN-world hub and the content script use `WindowBridgeTransport` over `window.postMessage`.

- Envelope: `contracts/bridge.ts` (`version: 1`, `source`, `target`, `type`, `payload`, optional `replyTo`/`timeoutMs`/`bridgeToken`).
- Content generates a per-page capability token and sends `V2_BRIDGE_HELLO`; the MAIN world rejects bridge envelopes until the token is established.
- Requests and responses must carry the matching token.
- Residual risk: a malicious same-origin script can observe page-world messages. The token raises the bar but does not replace a privileged execution world.

### 6.2 Content ↔ background

Tab commands use the versioned `v2-tab` envelope from `contracts/tab.ts`.

- Request: `{ protocol: "v2-tab", version: 2, requestId, type, payload }`.
- Response: `{ protocol: "v2-tab", version: 2, requestId, response }`, where `response` is the command result (`{ ok, value | error }` or a raw game result).
- Payload schemas live in `contracts/tab-commands.ts`.
- Content notices use the same envelope and are parsed at the background boundary:
  - `V2_GAME_READY` — per-tab readiness snapshot.
  - `V2_MARKET_CACHE` — raw market snapshot for cache warming.
  - `V2_WS_NOTICE` — redacted WebSocket diagnostic notice.
- Legacy raw `V2_*` messages without the envelope are rejected by both the content listener and the background message handler.

### 6.3 Background ↔ extension UI

Popup, side panel and DevTools talk to the background through `BridgeClient` / `BridgeServer` over `chrome.runtime` messaging.

- Bridge types are string commands such as `settings.get`, `job.syncMarket`, `network.map`.
- Requests are correlated by `id` and validated with Zod on both sides.
- Domain events are broadcast on the `v2-events` runtime port; `chrome-popup-portal.ts` reconnects with capped exponential backoff.
- UI code depends on `application/popup/portal.ts` and never calls `chrome.*` directly.

### 6.4 DevTools

`application/devtools/portal.ts` exposes the DevTools surface; `infrastructure/browser/chrome-devtools-portal.ts` owns `chrome.devtools.inspectedWindow.eval` and storage inspection. The panel supports export, per-category clear, WS send and an offline log viewer.

## 7. Persistence (v2)

All persistent state uses `chrome.storage.local`; transient session logs use `chrome.storage.session`. The current 2.0 build does not use `chrome.storage.sync`.

| Key | Area | Meaning |
|---|---|---|
| `v2.settings` | local | Versioned settings envelope (UI, automation, QoL, Helper Mode snapshot) |
| `v2.auto-finish` | local | Auto Finish last-run report and completed market resets |
| `v2.auto-jobs.snapshot` | local | Persisted Auto Jobs job/market snapshot |
| `v2.automationState` | local | Per-automation run state, leases and locks |
| `v2.dailyOpsCache` | local | Daily ops cache |
| `v2.discovery.progress` | local | Resumable network discovery progress |
| `v2.droneDataCache` | local | Drone config/data cache |
| `v2.expeditionConfigCache` | local | Expedition config cache |
| `v2.featureAvailability` | local | Feature availability probes |
| `v2.job.history` | local | Capped job history |
| `v2.mail.sources` | local | Claimed mailbox source bookkeeping |
| `v2.market.cache` | local | Market options/lots/jobs cache |
| `v2.network.snapshot` | local | Last network map snapshot |
| `v2.sessionLogs` | session | Redacted session log ring buffer (24 h retention) |

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
- If space is insufficient, the claim stays queued and a warning is shown until stash space is freed.

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
