# Settings / Storage Sync Assessment — COR3 Helper 2.0

- **Date:** 2026-11-14
- **Status:** Proposed — not implemented in the current 2.0 build (rechecked at `2.0.5-salta.272`; tracked as O-016)
- **Scope:** should v2 sync settings and/or cached data across Chrome profiles and devices?
- **Current v2 state:** all settings live in `chrome.storage.local` under `v2.settings`; data caches are also local. Users can export/import settings as a JSON backup.
- **Current v1 state:** user-facing settings use `chrome.storage.sync`; large or device-specific game data uses `chrome.storage.local`.

## Recommendation

**Add settings-only sync. Do not sync data caches or automation progress.**

| Category | Sync? | Reason |
|---|---|---|
| UI language, theme/QoL switches, panel layout, Helper Mode consent | **Yes** | Small, user intent, useful across devices/profiles. |
| Automation settings (Auto Jobs, Auto Drone, Auto Expedition, Auto Mail, Auto Daily, job type filters, intervals, mercenary/drone policies) | **Yes** | Small and portable. They describe behaviour, not local game state. |
| Developer mode, update preferences | **Yes** | Tiny and portable. |
| `helperModeSaved` snapshot | **Yes** (inside settings) | Needed to restore automations on another device after disabling Helper Mode. |
| Network snapshot / market cache / job history | **No** | Large, stale quickly, device/server specific, contains game state rather than preferences. |
| Drone/expedition config caches | **No** | Game data, not user preferences; server config can change. |
| Automation run state, locks, queues, leases | **No** | Runtime/device state; syncing would create duplicate-run hazards. |
| Session logs / DevTools logs | **No** | Diagnostic data, potentially sensitive even after redaction. |
| Mail source tracker | **No** | Local claim bookkeeping; syncing could suppress legitimate claims on another device. |

## Why settings-only sync is safe

- v2 settings are a small JSON object. Estimate: < 4 KB, well below `chrome.storage.sync` per-item quota.
- No bearer tokens or session IDs are stored in settings.
- The existing schema (`settingsV1Schema`) already applies defaults to missing fields, so older synced data remains usable.
- v1 proves the model works: `selectedTheme`, `uiLang`, `helperMode`, automation switches and QoL toggles already used sync.

## Quotas and conflict behaviour

`chrome.storage.sync` limits (Chrome):

- ~100 KB total
- ~8 KB per item
- ~120 writes per minute
- 512 items

Settings fit comfortably. Chrome resolves conflicts with last-write-wins per item and keeps sync disabled when the user is signed out.

The current `settings.update()` is already serialized by a write queue in `SettingsRepository`, so a debounced sync mirror will not fight local writes. A practical design:

1. Keep `chrome.storage.local` as the authoritative fast cache.
2. After a successful local settings write, debounce ~500–1000 ms and write the same object to `chrome.storage.sync`.
3. On startup, read sync first when present; if it has a newer `writtenAt`, apply it locally.
4. Add `settingsSyncEnabled` (default true) and `settingsSyncUpdatedAt`.
5. Never sync `panelOpenState` conflicts aggressively; last-write-wins is acceptable.

Alternative: keep local authoritative and provide “Push to sync / Pull from sync” buttons in Settings. This is easier to reason about but less seamless.

## Migration from v1

v1 stores settings as individual `chrome.storage.sync` keys (`uiLang`, `helperMode`, `autoSendMerc`, `autoDrone`, QoL keys, etc.). A one-time migration can:

- map known v1 keys into `settingsV1Schema`
- ignore removed/obsolete keys
- keep v2’s `settings.export/import` as the fallback for users who do not use Chrome sync

This should run only when `v2.settings` does not exist.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Synced automation enabled on a machine that is not ready | Keep existing readiness/feature-availability checks; Helper Mode still gates execution. |
| Stale settings after a schema change | Version + defaults; `settingsV1Schema` strips unknown keys. |
| Two devices writing rapidly | Debounce sync writes; local write queue remains authoritative. |
| User does not want cross-device behaviour | Add `settingsSyncEnabled` toggle. |
| Sync quota pressure from future large fields | Keep only primitive/enum settings in sync; never add caches to the synced object. |
| Token leakage | Settings never contain tokens; add a test asserting exported/synced settings contain no `token`, `jwt`, `session`, `cookie` keys. |

## Implementation sketch

```text
SettingsRepository
  ├─ local VersionedRepository (authoritative, fast)
  └─ SyncSettingsMirror (debounced)
        ├─ write: chrome.storage.sync.set({ 'v2.settings': envelope })
        └─ read: on startup, compare writtenAt and hydrate local
```

Add a `SettingsSyncPort` in infrastructure and inject it into the background composition root. Do not let UI call `chrome.storage` directly.

## Conclusion

**Yes — add settings-only sync**, with an opt-out toggle and a one-time v1 migration. It restores a real v1 convenience without syncing fragile game data. **No — do not sync caches, logs, queues, leases, or automation progress.** The existing JSON export/import remains the portable backup and recovery path.
