# Security

## Token policy

The 2.0 extension must not persist bearer tokens by default.

- Tokens live in the content context's in-memory/session adapter.
- Popup and background request authenticated operations through a typed port.
- Popup and background never read a persisted token.
- Reloading/restarting reacquires the live game session.
- A token must not appear in `chrome.storage`, exported logs, snapshots, or diagnostics.

## Log redaction

The infrastructure logger redacts at write time:

- `Authorization` and similar sensitive keys;
- `Bearer ...` strings;
- JWT-shaped strings;
- cookies and session IDs when represented as sensitive keys.

Callers must still avoid logging raw request/response bodies unnecessarily. Redaction is a safety net, not a license to log secrets.

## Runtime logs and exports

- Runtime logs (for example `auto.log`) and DevTools exports may contain game state and session-adjacent metadata even after redaction.
- Never commit raw logs or diagnostic exports. The repository ignores `*.log`; keep exports outside the working tree or in an ignored path.
- Use the DevTools log viewer and inspect the redacted output before attaching logs to an issue.
- Retention is bounded by the in-memory/session log store; exported files are the user's responsibility.

## Permissions

The 2.0 manifest requests only the permissions it uses: `storage`, `tabs`, `sidePanel` and `alarms`. Host access is limited to the game origins and the fork's own GitHub path for update metadata. Unused `scripting`/`activeTab` permissions were removed in dev.230.

## Extension identity

The build uses its own extension identity and storage namespace. It must not read or overwrite settings or caches from stable releases or other builds.

## Test requirement

Any new logging path must include a test that feeds a token-like value through it and asserts the value is absent from the captured output.
