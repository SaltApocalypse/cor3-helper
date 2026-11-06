import { _safeSetHtml } from './dom-helpers.js';
import { getCor3Tab } from './utils.js';
import { t } from './i18n.js';
import {
    FORK_REPO,
    FORK_REPO_URL,
    FORK_RELEASES_URL,
    FORK_DISPLAY_NAME,
    UPSTREAM_REPO,
    UPSTREAM_URL
} from './fork-config.js';

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

function pickNewer(a, b) {
    if (!a) return b;
    if (!b) return a;
    return compareVersions(a, b) > 0 ? a : b;
}

async function getBundledVersions() {
    try {
        const resp = await fetch(chrome.runtime.getURL('versions.json'), { cache: 'no-store' });
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        return null;
    }
}

async function getReferenceVersions() {
    let remote = null;
    try {
        const resp = await fetch(`https://raw.githubusercontent.com/${FORK_REPO}/main/versions.json`, { cache: 'no-store' });
        if (resp.ok) remote = await resp.json();
    } catch (e) { /* fall back to bundled */ }

    const bundled = await getBundledVersions();
    if (!remote) return bundled;
    if (!bundled) return remote;

    return {
        web: pickNewer(bundled.web, remote.web),
        system: pickNewer(bundled.system, remote.system),
        patch: pickNewer(bundled.patch, remote.patch)
    };
}

checkUpdateBtn.addEventListener('click', async () => {
    updateResult.textContent = t('Checking...', '检查中...');
    updateResult.style.color = 'var(--text-dim)';
    try {
        const localManifest = chrome.runtime.getManifest();
        const localExtVersion = localManifest.version;
        const localExtVersionName = localManifest.version_name || localExtVersion;

        const versionsResp = await fetch(`https://raw.githubusercontent.com/${FORK_REPO}/main/versions.json`, { cache: 'no-store' });
        if (!versionsResp.ok) throw new Error('Failed to fetch remote versions');
        const remote = await versionsResp.json();

        let remoteExtVersion = null;
        try {
            const pkgResp = await fetch(`https://raw.githubusercontent.com/${FORK_REPO}/main/package.json`, { cache: 'no-store' });
            if (pkgResp.ok) {
                const remotePkg = await pkgResp.json();
                remoteExtVersion = remotePkg.version || null;
            }
        } catch (e) { /* silent */ }

        const { webVersion, systemVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion']);

        let messages = [];
        let extBehind = false;

        if (remoteExtVersion && compareVersions(localExtVersion, remoteExtVersion) < 0) {
            messages.push(`${t('Extension', '扩展')}: <b>v${localExtVersionName}</b> → <b>v${remoteExtVersion}</b>`);
            extBehind = true;
        }

        if (messages.length > 0) {
            let html = `${t('Updates detected:', '检测到更新：')}<br>${messages.join('<br>')}`;
            if (extBehind) {
                html += `<br><a href="${FORK_RELEASES_URL}" target="_blank" style="color:var(--accent-cyan);">${t('Download from ' + FORK_DISPLAY_NAME, '从 ' + FORK_DISPLAY_NAME + ' 下载')}</a><br><span style="font-size:9px;color:var(--text-muted);">${t('Download ZIP, extract, and reload on chrome://extensions', '下载 ZIP，解压后在 chrome://extensions 重新加载')}</span>`;
            }
            html += `<br><span style="font-size:9px;color:var(--text-muted);">${t('Fork', '分支')}: ${FORK_DISPLAY_NAME} · ${t('Upstream', '上游')}: <a href="${UPSTREAM_URL}" target="_blank" style="color:var(--accent-cyan);">${UPSTREAM_REPO}</a></span>`;
            _safeSetHtml(updateResult, html);
            updateResult.style.color = 'var(--accent-orange)';
        } else {
            const localWeb = webVersion || null;
            const localSys = systemVersion || null;
            updateResult.textContent = t(`You're up to date! (${FORK_DISPLAY_NAME})`, `已是最新版本！（${FORK_DISPLAY_NAME}）`);
            updateResult.style.color = 'var(--accent-green)';
        }
    } catch (e) {
        console.log('[COR3 Helper] Check for updates error:', e);
        cor3LogError('popup.js', e, { action: 'checkForUpdates' });
        updateResult.textContent = t('Could not check for updates. Check your connection.', '无法检查更新，请检查网络连接。');
        updateResult.style.color = 'var(--accent-red)';
    }
});

async function displayVersionInfo(retryCount) {
    retryCount = retryCount || 0;
    const versionSection = document.getElementById('versionInfoSection');
    if (!versionSection) return;
    const manifest = chrome.runtime.getManifest();
    const extVersion = manifest.version;
    const extVersionName = manifest.version_name || extVersion;
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

    let parts = [`${t('Extension', '扩展')}: v${extVersionName} <span style="color:var(--accent-cyan);">(${FORK_DISPLAY_NAME})</span>`];
    if (finalWebVersion) parts.push(`${t('Web', '网页')}: ${finalWebVersion}`);
    if (finalSystemVersion) parts.push(`${t('System', '系统')}: ${finalSystemVersion}`);
    if (finalPatchVersion) parts.push(`${t('Patch', '补丁')}: ${finalPatchVersion}`);
    let html = parts.join(' · ');
    html += `<br><span style="font-size:9px;color:var(--text-muted);">${t('Fork', '分支')}: <a href="${FORK_REPO_URL}" target="_blank" style="color:var(--accent-cyan);">${FORK_REPO}</a> · ${t('Upstream', '上游')}: <a href="${UPSTREAM_URL}" target="_blank" style="color:var(--accent-cyan);">${UPSTREAM_REPO}</a></span>`;
    _safeSetHtml(versionSection, html);
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
        const remote = await getReferenceVersions();
        if (!remote) return;
        const { webVersion, systemVersion, patchVersion } = await chrome.storage.local.get(['webVersion', 'systemVersion', 'patchVersion']);

        if (webVersion && remote.web) {
            const comparison = compareVersions(webVersion, remote.web);
            if (comparison > 0) {
                webVersionNotice.textContent = t('⚠️ Game website version is newer than the extension reference', '⚠️ 游戏网页版本高于插件参考版本');
                webVersionNotice.style.display = 'block';
                webVersionData.textContent = t('Detected: ' + webVersion + ' · Reference: ' + remote.web, '检测到：' + webVersion + ' · 参考版本：' + remote.web);
                webVersionData.style.display = 'block';
            }
        }

        if (systemVersion && remote.system) {
            const comparison = compareVersions(systemVersion, remote.system);
            if (comparison < 0) {
                systemVersionNotice.textContent = t('⚠️ Your System version is behind the extension reference!', '⚠️ 你的 System 进度低于插件参考版本！');
                systemVersionNotice.style.display = 'block';
                systemVersionData.textContent = t('Aim for ' + remote.system + ' system version!', '目标系统版本：' + remote.system + '！');
                systemVersionData.style.display = 'block';
            }
        }

        if (patchVersion && remote.patch && patchVersionNotice && patchVersionData) {
            const comparison = compareVersions(patchVersion, remote.patch);
            if (comparison > 0) {
                patchVersionNotice.textContent = t('⚠️ Game patch version differs from the extension reference. Check patch notes!', '⚠️ 游戏补丁版本与插件参考版本不一致，请查看更新说明！');
                patchVersionNotice.style.display = 'block';
                patchVersionData.textContent = t('Detected: ' + patchVersion + ' · Reference: ' + remote.patch, '检测到：' + patchVersion + ' · 参考版本：' + remote.patch);
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
