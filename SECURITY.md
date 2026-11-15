# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 2.0.x (`v2` branch) | :white_check_mark: |
| 1.8.x (v1 stable line) | Critical fixes only |
| < 1.8 | :x: |

## Reporting a vulnerability

If you discover a security vulnerability in COR3 Helper, please report it responsibly:

1. **Do not** open a public issue.
2. Email the maintainer or use GitHub's private vulnerability reporting feature.
3. Include a description of the vulnerability, steps to reproduce, and potential impact.

## Scope

This extension runs client-side in the browser. It:

- Intercepts WebSocket messages on `cor3.gg` only.
- Stores settings, caches and diagnostics in `chrome.storage.local` and `chrome.storage.session`.
- Does **not** use `chrome.storage.sync` in the current 2.0 build.
- Does **not** transmit data to an external server. The only remote requests are the game's own API/socket traffic and the update metadata check against `raw.githubusercontent.com` for this fork.
- Does **not** persist authentication credentials. The game session token is held in memory and reacquired from the live page.
- Redacts tokens, JWTs, cookies and session identifiers from logs and exports.

Engineering-level token and logging rules are documented in [docs/security.md](./docs/security.md).

## Response

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for confirmed vulnerabilities.
