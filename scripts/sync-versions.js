#!/usr/bin/env node
// Keep the fork's versions.json in sync with upstream's game-version tracker.
//
// The extension runtime points at THIS fork (see src/popup/fork-config.js), so
// the fork needs a fresh versions.json. Upstream already maintains that file for
// the live game; this script mirrors it. Run manually with:
//
//   npm run sync-versions          # update the file
//   npm run sync-versions:check    # check only; exits 2 when stale
//
// The release workflow runs --check and warns (but does not block) when stale.
const fs = require('fs');
const path = require('path');

const UPSTREAM_REPO = 'Femtoce11/cor3-helper';
const UPSTREAM_URL = `https://raw.githubusercontent.com/${UPSTREAM_REPO}/main/versions.json`;
const TARGET = path.join(__dirname, '..', 'versions.json');
const CHECK_ONLY = process.argv.includes('--check');

async function main() {
    const res = await fetch(UPSTREAM_URL, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'cor3-helper-fork-version-sync'
        }
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

    const same = current && current.web === remote.web &&
        current.system === remote.system && current.patch === remote.patch;
    if (same) {
        console.log('versions.json is already up to date:', remote);
        return;
    }

    if (CHECK_ONLY) {
        console.error('versions.json is stale.');
        if (current) console.error('  local:   ', current);
        console.error('  upstream:', remote);
        console.error("Run 'npm run sync-versions' to update it before releasing.");
        process.exitCode = 2;
        return;
    }

    fs.writeFileSync(TARGET, JSON.stringify(remote, null, 2) + '\n');
    console.log('Updated versions.json:', remote);
}

main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
