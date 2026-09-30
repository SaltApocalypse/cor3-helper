import { _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';

const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const updateResult = document.getElementById('updateResult');

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

checkUpdateBtn.addEventListener('click', async () => {
    updateResult.textContent = 'Checking...';
    updateResult.style.color = 'var(--text-dim)';
    try {
        const localManifest = chrome.runtime.getManifest();
        const localExtVersion = localManifest.version;

        const versionsResp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/versions.json', { cache: 'no-store' });
        if (!versionsResp.ok) throw new Error('Failed to fetch remote versions');
        const remote = await versionsResp.json();

        let remoteExtVersion = null;
        try {
            const pkgResp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/package.json', { cache: 'no-store' });
            if (pkgResp.ok) {
                const remotePkg = await pkgResp.json();
                remoteExtVersion = remotePkg.version || null;
            }
        } catch (e) { /* silent */ }

        const { webVersion, systemVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion']);

        let messages = [];
        let extBehind = false;

        if (remoteExtVersion && compareVersions(localExtVersion, remoteExtVersion) < 0) {
            messages.push(`Extension: <b>v${localExtVersion}</b> → <b>v${remoteExtVersion}</b>`);
            extBehind = true;
        }

        if (messages.length > 0) {
            let html = `Updates detected:<br>${messages.join('<br>')}`;
            if (extBehind) {
                html += `<br><a href="https://github.com/Femtoce11/cor3-helper/releases" target="_blank" style="color:var(--accent-cyan);">Download from GitHub</a><br><span style="font-size:9px;color:var(--text-muted);">Download ZIP, extract, and reload on chrome://extensions</span>`;
            }
            _safeSetHtml(updateResult, html);
            updateResult.style.color = 'var(--accent-orange)';
        } else {
            const localWeb = webVersion || null;
            const localSys = systemVersion || null;
            updateResult.textContent = `You're up to date!`;
            updateResult.style.color = 'var(--accent-green)';
        }
    } catch (e) {
        console.log('[COR3 Helper] Check for updates error:', e);
        cor3LogError('popup.js', e, { action: 'checkForUpdates' });
        updateResult.textContent = 'Could not check for updates. Check your connection.';
        updateResult.style.color = 'var(--accent-red)';
    }
});

async function displayVersionInfo(retryCount) {
    retryCount = retryCount || 0;
    const versionSection = document.getElementById('versionInfoSection');
    if (!versionSection) return;
    const extVersion = chrome.runtime.getManifest().version;
    const { webVersion, systemVersion, patchVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion']);

    let finalWebVersion = webVersion;
    let finalSystemVersion = systemVersion;
    let finalPatchVersion = patchVersion;

    if (!webVersion || !systemVersion || !patchVersion) {
        try {
            const tab = await getCor3Tab();
            if (tab) {
                const response = await chrome.tabs.sendMessage(tab.id, { action: "getVersionFallbacks" });
                if (response) {
                    if (!finalWebVersion && response.webVersion) {
                        finalWebVersion = response.webVersion;
                        chrome.storage.local.set({ webVersion: response.webVersion });
                    }
                    if (!finalSystemVersion && response.systemVersion) {
                        finalSystemVersion = response.systemVersion;
                        chrome.storage.local.set({ systemVersion: response.systemVersion });
                    }
                    if (!finalPatchVersion && response.patchVersion) {
                        finalPatchVersion = response.patchVersion;
                        chrome.storage.local.set({ patchVersion: response.patchVersion });
                    }
                }
            }
        } catch (e) {
            console.log('[COR3 Helper] Could not get version fallbacks:', e);
        }
    }

    let parts = [`Extension: v${extVersion}`];
    if (finalWebVersion) parts.push(`Web: ${finalWebVersion}`);
    if (finalSystemVersion) parts.push(`System: ${finalSystemVersion}`);
    if (finalPatchVersion) parts.push(`Patch: ${finalPatchVersion}`);
    versionSection.textContent = parts.join(' · ');
    versionSection.style.display = 'block';

    if ((!finalWebVersion || !finalSystemVersion || !finalPatchVersion) && retryCount < 5) {
        setTimeout(() => displayVersionInfo(retryCount + 1), 2000);
    }
}
displayVersionInfo(0);

async function autoCheckWebsiteUpdated() {
    const webVersionNotice = document.getElementById('webVersionNotice');
    const webVersionData = document.getElementById('webVersionData');
    const systemVersionNotice = document.getElementById('systemVersionNotice');
    const systemVersionData = document.getElementById('systemVersionData');
    const patchVersionNotice = document.getElementById('patchVersionNotice');
    const patchVersionData = document.getElementById('patchVersionData');
    if (!webVersionNotice || !webVersionData || !systemVersionNotice || !systemVersionData) return;
    try {
        const resp = await fetch('https://raw.githubusercontent.com/Femtoce11/cor3-helper/main/versions.json', { cache: 'no-store' });
        if (!resp.ok) return;
        const remote = await resp.json();
        const { webVersion, systemVersion, patchVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion']);

        if (webVersion && remote.web) {
            const comparison = compareVersions(webVersion, remote.web);
            if (comparison > 0) {
                webVersionNotice.textContent = '⚠️ Website is recently updated';
                webVersionNotice.style.display = 'block';
                webVersionData.textContent = 'Detected: ' + webVersion + ' · Old: ' + remote.web;
                webVersionData.style.display = 'block';
            }
        }

        if (systemVersion && remote.system) {
            const comparison = compareVersions(systemVersion, remote.system);
            if (comparison < 0) {
                systemVersionNotice.textContent = '⚠️ You are lagging behind in progress!';
                systemVersionNotice.style.display = 'block';
                webVersionData.textContent = 'Aim for ' + remote.system + ' system version!';
                webVersionData.style.display = 'block';
            }
        }

        if (patchVersion && remote.patch && patchVersionNotice && patchVersionData) {
            const comparison = compareVersions(patchVersion, remote.patch);
            if (comparison > 0) {
                patchVersionNotice.textContent = '⚠️ Patch version is changed. Check patch notes!';
                patchVersionNotice.style.display = 'block';
                patchVersionData.textContent = 'Detected: ' + patchVersion + ' · Old: ' + remote.patch;
                patchVersionData.style.display = 'block';
            }
        }
    } catch (e) { /* silent */ }
}
autoCheckWebsiteUpdated();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.webVersion || changes.systemVersion || changes.patchVersion) {
        displayVersionInfo();
        autoCheckWebsiteUpdated();
    }
});
