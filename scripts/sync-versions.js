#!/usr/bin/env node
// Keep the fork's versions.json at least as new as upstream's game-version tracker.
//
// The extension runtime points at THIS fork (see src/popup/fork-config.js), so
// the fork needs an accurate versions.json. Upstream maintains a baseline for
// the live game, but it can lag behind. This script merges upstream values
// without ever downgrading a newer fork-specific value. Run manually with:
//
//   npm run sync-versions          # merge upstream values without downgrading
//   npm run sync-versions:check    # check only; exits 2 when behind upstream
//
// The release workflow runs --check and warns (but does not block) when behind.
const fs = require('fs');
const path = require('path');

const UPSTREAM_REPO = 'Femtoce11/cor3-helper';
const UPSTREAM_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main/versions.json`;
const TARGET = path.join(__dirname, '..', 'versions.json');
const CHECK_ONLY = process.argv.includes('--check');

function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    const parse = (v) => {
        const stripped = String(v).replace(/^v/, '');
        const match = stripped.match(/^([\d.]+)(.*)$/);
        if (!match) return { parts: [0], suffix: stripped };
        return {
            parts: match[1].split('.').map(n => parseInt(n) || 0),
            suffix: match[2] || ''
        };
    };

    const a = parse(v1);
    const b = parse(v2);

    const maxLength = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < maxLength; i++) {
        const num1 = a.parts[i] || 0;
        const num2 = b.parts[i] || 0;
        if (num1 < num2) return -1;
        if (num1 > num2) return 1;
    }

    const hasSuffix1 = a.suffix.length > 0;
    const hasSuffix2 = b.suffix.length > 0;
    if (!hasSuffix1 && hasSuffix2) return -1;
    if (hasSuffix1 && !hasSuffix2) return 1;
    if (hasSuffix1 && hasSuffix2) return a.suffix.localeCompare(b.suffix);

    return 0;
}

async function main() {
    const res = await fetch(UPSTREAM_URL, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'cor3-helper-fork-version-sync'
        },
        signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) {
        throw new Error(`Failed to fetch ${UPSTREAM_URL}: ${res.status} ${res.statusText}`);
    }

    const remote = await res.json();
    if (!remote || typeof remote !== 'object' || !remote.web || !remote.system || !remote.patch) {
        throw new Error(`Unexpected versions.json payload from ${UPSTREAM_URL}`);
    }

    let current = null;
    if (fs.existsSync(TARGET)) {
        try {
            current = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
        } catch (e) {
            current = null;
        }
    }

    const keys = ['web', 'system', 'patch'];
    const merged = {
        web: remote.web,
        system: remote.system,
        patch: remote.patch
    };

    // Never downgrade a value that the fork already tracks ahead of upstream.
    for (const key of keys) {
        if (current && current[key] && compareVersions(current[key], merged[key]) > 0) {
            merged[key] = current[key];
        }
    }

    const same = current && keys.every(key =>
        current[key] && compareVersions(current[key], merged[key]) === 0);
    if (same) {
        console.log('versions.json is already up to date or ahead of upstream:', current);
        return;
    }

    const behindKeys = keys.filter(key =>
        !current || !current[key] || compareVersions(current[key], remote[key]) < 0);

    if (CHECK_ONLY) {
        console.error('versions.json is behind upstream.');
        if (current) console.error('  local:   ', current);
        console.error('  upstream:', remote);
        console.error('  behind:  ', behindKeys.join(', '));
        console.error("Run 'npm run sync-versions' to merge upstream values before releasing.");
        process.exitCode = 2;
        return;
    }

    fs.writeFileSync(TARGET, JSON.stringify(merged, null, 2) + '\n');
    console.log('Updated versions.json:', merged);
}

main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
