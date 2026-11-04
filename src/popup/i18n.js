// Minimal popup localization.
//
// Scope: language selector + the main popup UI. Static labels can use
// data-i18n-en / data-i18n-zh; plain text nodes are translated by exact match,
// and the word "Market" is rendered as 市场 in Chinese while keeping the market
// name/number.

let _lang = 'en';
const _listeners = new Set();
let _observer = null;
let _translating = false;

const STATIC_ZH = {
    // Section / panel titles
    'Pinned Timers': '固定计时器',
    '📌 Pinned Timers': '📌 固定计时器',
    'Automation/QoL Toggles': '自动化/便利开关',
    'Hack Automation Toggles': '破解自动化开关',
    'Objective Automation Toggles': '目标自动化开关',
    'QoL Toggles': '便利开关',
    'Info Panel Toggles': '信息面板开关',
    'Daily Ops': '每日行动',
    '📅 Daily Ops': '📅 每日行动',
    'Markets': '市场',
    '🏪 Markets': '🏪 市场',
    'Expeditions': '远征',
    'Inventory': '仓库',
    'Loadout': '配装',
    '🖥️ Loadout': '🖥️ 配装',
    'Hardwares': '硬件',
    '⚙️ Hardwares': '⚙️ 硬件',
    'Softwares': '软件',
    '💾 Softwares': '💾 软件',
    'System Overview': '系统概览',
    '📊 System Overview': '📊 系统概览',
    'Status: Ready': '状态：就绪',
    'Show toggles ▾': '展开开关 ▾',
    'Hide toggles ▴': '收起开关 ▴',

    // Toggle labels
    'Helper-Only Mode': '仅辅助模式',
    '🛡️ Helper-Only Mode': '🛡️ 仅辅助模式',
    '(hides automation)': '（隐藏自动化）',
    'Auto Decrypt Hacking': '自动解密破解',
    'Auto ICE Wall Hacking': '自动 ICE Wall 破解',
    'Auto Simple Decrypt Hacking': '自动简单解密破解',
    'Auto Daily Hacking': '自动每日破解',
    'Auto Job Solver UI': '自动任务求解器界面',
    '🤖 Auto Job Solver UI': '🤖 自动任务求解器界面',
    'Auto Valuable Seller UI': '自动贵重物品出售界面',
    '💎 Auto Valuable Seller UI': '💎 自动贵重物品出售界面',
    'Auto Update Markets': '自动刷新市场',
    'Secret Link/Server Finder': '隐藏连接/服务器查找',
    '🔍 Secret Link/Server Finder': '🔍 隐藏连接/服务器查找',
    'Disable Desktop Glitch/Wave': '禁用桌面故障/波纹',
    '🎨 Disable Desktop Glitch/Wave': '🎨 禁用桌面故障/波纹',
    'Disable Network Fog': '禁用网络迷雾',
    '🎨 Disable Network Fog': '🎨 禁用网络迷雾',
    'Move Notifications To Left': '通知移动到左侧',
    '📌 Move Notifications To Left': '📌 通知移动到左侧',

    // Status / common
    'Off': '关闭',
    'On': '开启',
    'Active': '运行中',
    'Inactive': '未运行',
    'Running': '运行中',
    'Paused': '已暂停',
    'Ready': '就绪',
    'Loading...': '加载中...',
    'Loading…': '加载中…',
    'Claimed': '已领取',
    'Unclaimed': '未领取',
    'Claim': '领取',
    'Save': '保存',
    'Cancel': '取消',
    'Insurance:': '保险：',
    'Yes': '是',
    'No': '否',
    'Pending': '待处理',
    'Resolved': '已处理',
    'AUTO-RESOLVED': '自动处理',
    'RESOLVED': '已处理',
    'PENDING': '待处理',
    'No data': '暂无数据',
    'AVAILABLE': '可用',
    'RESTING': '休息中',
    'IN_PROGRESS': '进行中',
    'PREPARING': '准备中',
    'RUNNING': '进行中',
    'COMPLETED': '已完成',
    'FAILED': '失败',
    'ARCHIVED': '已归档',
    'FULL_SUCCESS': '完全成功',
    'PARTIAL_SUCCESS': '部分成功',
    'FAILURE': '失败',
    'SUCCESS': '成功',
    'DEATH': '死亡',
    'DAMAGED': '损坏',
    'SEVERELY_DAMAGED': '严重损坏',
    'DESTROYED': '已摧毁',
    'No active expeditions.': '没有进行中的远征。',
    'No pending decisions found.': '没有待处理的决策。',
    'No expedition data yet.': '暂无远征数据。',
    'Loading expedition data...': '正在加载远征数据...',
    'No archived expeditions found.': '没有已归档的远征。',
    'Loading archived expeditions...': '正在加载已归档远征...',
    'No mercenaries found.': '没有可用雇佣兵。',
    'Loading mercenaries...': '正在加载雇佣兵...',
    'Waiting for mercenary data...': '正在等待雇佣兵数据...',
    'No drone data yet. Click 🔄 to refresh.': '暂无无人机数据，点击 🔄 刷新。',
    'No active drone mission.': '没有进行中的无人机任务。',
    'No active mission decisions.': '没有进行中的任务决策。',
    'No archived drone missions found.': '没有已归档的无人机任务。',
    'Requesting drone data...': '正在请求无人机数据...',
    'Loading archived drone missions...': '正在加载已归档的无人机任务...',
    'No items found.': '没有物品。',
    'Loading inventory...': '正在加载仓库...',
    'Requesting inventory from server...': '正在从服务器请求仓库数据...',
    'No loadout data yet': '暂无配装数据',
    'No data yet': '暂无数据',

    // Market labels / job reset
    'Market-1 Jobs Reset': '市场-1 任务重置',
    'Market-2 Jobs Reset': '市场-2 任务重置',
    'Market-3 Jobs Reset': '市场-3 任务重置',
    'Market-4 Jobs Reset': '市场-4 任务重置',
    'Credits': '信用点',
    'Jobs': '任务',
    'Items': '物品',
    'Lots': '挂单',
    'Next reset': '下次重置',
    'Jobs Reset': '任务重置',

    // Inventory / sorting
    'Rarity': '稀有度',
    'Tag': '标签',
    'Sell': '出售',
    'Sort': '整理',
    'Smart Sort': '智能整理',
    'Compact Sort': '紧凑整理',
    'Sell Price': '出售价格',
    'Total Value': '总价值',

    // Auto Job Solver / Auto Valuable Seller UI
    '🤖 Auto Job Solver': '🤖 自动任务求解器',
    '▶ Start Auto Jobs': '▶ 开始自动任务',
    '■ Stop Auto Jobs': '■ 停止自动任务',
    '🔄 Auto Finish All Jobs': '🔄 自动完成所有工作',
    '🖥️ Debug Console': '🖥️ 调试控制台',
    'Logs': '日志',
    'Loading job data...': '正在加载任务数据...',
    'No job data yet.': '暂无任务数据。',
    'No logs yet.': '暂无日志。',
    'All jobs completed or expired.': '所有任务已完成或已过期。',
    'Refreshing (sequential)...': '正在依次刷新...',
    '💎 Auto Valuable Seller': '💎 自动贵重物品出售',
    'Servers': '服务器',
    'Downloads': '下载',
    'Maintenance': '维护',
    '▶ Start Valuable Seller': '▶ 开始自动出售',
    '▶ Start Valuable Search': '▶ 开始搜索贵重物品',
    'No valuable data yet. Click "Start Valuable Search" to scan servers.': '暂无贵重物品数据。点击“开始搜索贵重物品”扫描服务器。',
    'No download data yet. Click "Start Valuable Search" to scan.': '暂无下载数据。点击“开始搜索贵重物品”扫描。',
    'Run "Start Valuable Search" to see the maintenance status of servers. If no servers are shown after the search, there is no upcoming or active maintenance.': '运行“开始搜索贵重物品”以查看服务器维护状态。如果搜索后没有显示服务器，则没有即将进行或正在进行的维护。',

    // Version / updates
    'Check for Updates': '检查更新',
    "You're up to date!": '已是最新版本！',
    'Updates detected:': '检测到更新：',
    'Download from GitHub': '从 GitHub 下载'
};

// Chinese translations for common server/runtime errors. These are applied
// only to error/warning displays so debug logs keep their original text.
const ERROR_ZH = {
    'Unknown error': '未知错误',
    'unknown error': '未知错误',
    'IP already exists on server': '该 IP 已存在于服务器',
    'Server IP limit reached': '服务器 IP 数量已达上限',
    'No path to server (unreachable)': '无法到达服务器（不可达）',
    'Server is in maintenance': '服务器维护中',
    'Missing required software': '缺少所需软件',
    'Not enough hack power': '破解算力不足',
    'No hacking software': '没有破解软件',
    'Cannot read SAI file': '无法读取 SAI 文件',
    'Access token expired or invalid': '访问令牌过期或无效',
    'Session token expired': '会话令牌已过期',
    'Job already taken previously': '任务已被接取',
    'Job no longer available': '任务已不可用',
    'Job has expired': '任务已过期',
    'Job conditions not met': '任务条件未满足',
    'File not found on server': '服务器上找不到文件',
    'Log not found on server': '服务器上找不到日志',
    'Access denied to server': '服务器访问被拒绝',
    'Rate limited — too many requests': '请求过于频繁，已被限流',
    'File not found on server/folder': '服务器/文件夹中找不到文件',
    'Market not reachable': '市场不可达',
    'Unable to decrypt that file extension. Please install the appropriate decryption software': '无法解密该文件扩展名，请安装相应的解密软件',
    'Insufficient decrypt power for this file': '该文件解密算力不足',
    'File is already decrypted': '文件已解密',
    'Job is not available (stale data)': '任务不可用（数据过期）',
    'No cor3.gg tab': '未找到 cor3.gg 标签页',
    'Insufficient credits to launch expedition': '信用点不足，无法派遣远征',
    'Insufficient credits to open reward container. Auto-send disabled.': '信用点不足，无法开启奖励容器。自动派遣已禁用。',
    'Auto expedition paused: automatic mercenary selection returned no mercenary.': '自动远征已暂停：自动选择未返回可用雇佣兵。',
    'Auto expedition paused: the selected expedition location is missing zone/goal config.': '自动远征已暂停：所选远征地点缺少区域/目标配置。',
    'Auto expedition paused: stash is full. Clear stash space, then turn Auto expedition off and on to resume.': '自动远征已暂停：仓库已满。请清理仓库空间，然后关闭再开启“自动远征”以恢复。',
    'Auto expedition paused: not enough credits. Earn credits, then turn Auto expedition off and on to resume.': '自动远征已暂停：信用点不足。请获取更多信用点，然后关闭再开启“自动远征”以恢复。',
    'Auto drone paused. Re-enable Auto expedition to resume.': '自动无人机已暂停。请重新启用“自动远征”以恢复。',
    'Drone is destroyed — auto-drone paused. Repair or replace the drone.': '无人机已摧毁——自动远征已暂停。请维修或更换无人机。'
};

const ERROR_PHRASES_ZH = [
    ['Auto expedition paused:', '自动远征已暂停：'],
    ['no available mercenary with expedition data. All candidates may be resting or missing configure data.', '没有可用且已获取远征数据的雇佣兵。所有候选可能都在休息或缺少配置数据。'],
    [' USOL market is unreachable.', ' USOL 市场不可达。'],
    ['selected mercenary is no longer available (status: ', '所选雇佣兵已不可用（状态：'],
    ['no expedition config available for ', '没有可用的远征配置：'],
    ['Failed to open reward container: ', '开启奖励容器失败：'],
    ['Mercenary not available after ', '雇佣兵不可用，已重试 '],
    [' retries. Merc data may be stale.', ' 次。雇佣兵数据可能已过期。'],
    ['Expedition action still in progress — retrying shortly…', '远征操作仍在处理中——稍后重试…'],
    ['Turn Auto expedition off and on to retry.', '请关闭再开启“自动远征”以重试。'],
    ['stash is full. Clear stash space, then turn Auto expedition off and on to resume.', '仓库已满。请清理仓库空间，然后关闭再开启“自动远征”以恢复。'],
    ['not enough credits. Earn credits, then turn Auto expedition off and on to resume.', '信用点不足。请获取更多信用点，然后关闭再开启“自动远征”以恢复。'],
    ['Rate limited — retrying in ', '请求过于频繁——正在重试：'],
    ['Rate limited — auto-dispatch disabled after ', '请求过于频繁——自动远征已禁用，重试次数：'],
    [' retries. Re-enable to resume.', ' 次。重新启用后继续。'],
    ['Drone repair failed: ', '无人机维修失败：'],
    ['Drone launch failed: ', '无人机派遣失败：'],
    ['Drone claim failed: ', '无人机领取失败：'],
    ['Drone ', '无人机 '],
    [' deferred (', ' 操作延迟（'],
    [') — retrying…', '）—— 正在重试…'],
    ['Auto-send disabled.', '自动派遣已禁用。']
];

export function translateErrorText(text) {
    if (_lang !== 'zh' || text == null) return text == null ? '' : String(text);
    let out = String(text);
    if (ERROR_ZH[out]) return ERROR_ZH[out];
    for (const [en, zh] of ERROR_PHRASES_ZH) {
        if (out.indexOf(en) !== -1) out = out.split(en).join(zh);
    }
    return out;
}

// Substring replacements for dynamic labels such as "Cost: 500" or "Risk: +1".
// Longest/most-specific phrases come first.
const PHRASE_ZH = [
    ['Battery Cost:', '电量消耗：'],
    ['Total Cost:', '总费用：'],
    ['Open Cost:', '开启费用：'],
    ['Sell Price:', '出售价格：'],
    ['Next Task:', '下一任务：'],
    ['Next reset:', '下次重置：'],
    ['Grace period ends:', '宽限期结束：'],
    ['Remaining:', '剩余：'],
    ['Deadline:', '截止时间：'],
    ['Expires in:', '剩余时间：'],
    ['Task:', '任务：'],
    ['Claimed:', '已领取：'],
    ['Streak:', '连续天数：'],
    ['Difficulty:', '难度：'],
    ['Bonus:', '奖励：'],
    ['Reward:', '奖励：'],
    ['Credits:', '信用点：'],
    ['Jobs:', '任务：'],
    ['Items:', '物品：'],
    ['Lots:', '挂单：'],
    ['Status:', '状态：'],
    ['Location:', '地点：'],
    ['Mission:', '任务：'],
    ['Risk:', '风险：'],
    ['Loot:', '战利品：'],
    ['Battery:', '电量：'],
    ['Durability:', '耐久：'],
    ['Cost:', '费用：']
];

function translatePhrases(text) {
    let out = text;
    for (const [en, zh] of PHRASE_ZH) {
        if (out.indexOf(en) !== -1) out = out.split(en).join(zh);
    }
    return out;
}

export function getUiLang() {
    return _lang;
}

export function t(en, zh) {
    return _lang === 'zh' ? zh : en;
}

export function translateStatus(text) {
    if (_lang !== 'zh' || text == null) return text;
    return STATIC_ZH[String(text)] || String(text);
}

export function marketLabel(name) {
    if (name == null) return '';
    const text = String(name);
    if (_lang !== 'zh') return text;
    return text.replace(/\bMarkets\b/g, '市场').replace(/\bMarket\b/g, '市场');
}

export function onLangChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n-en]').forEach((el) => {
        const text = _lang === 'zh' ? el.dataset.i18nZh : el.dataset.i18nEn;
        if (text != null) el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-title-en]').forEach((el) => {
        const text = _lang === 'zh' ? el.dataset.i18nTitleZh : el.dataset.i18nTitleEn;
        if (text != null) el.title = text;
    });
}

function shouldSkipTextNode(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    if (parent.closest('script, style, [data-i18n-en]')) return true;
    return false;
}

function translateTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkipTextNode(node)) return;
    const current = node.nodeValue;
    if (!node.__i18nOriginal || (current !== node.__i18nOriginal && current !== node.__i18nLast)) {
        node.__i18nOriginal = current;
    }
    const original = node.__i18nOriginal;
    const trimmed = original.trim();
    if (!trimmed) return;

    let translated = trimmed;
    if (_lang === 'zh') {
        if (STATIC_ZH[trimmed] != null) {
            translated = STATIC_ZH[trimmed];
        } else {
            translated = marketLabel(translatePhrases(trimmed));
        }
    }

    const next = original.replace(trimmed, translated);
    node.__i18nLast = next;
    if (node.nodeValue !== next) node.nodeValue = next;
}

function translateTextIn(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateTextNode);
}

function installObserver() {
    if (_observer || !document.body) return;
    _observer = new MutationObserver((mutations) => {
        if (_translating) return;
        if (_lang !== 'zh') return;
        _translating = true;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                translateTextIn(node);
            }
        }
        _translating = false;
    });
    _observer.observe(document.body, { childList: true, subtree: true });
}

function applyLangUi() {
    document.documentElement.lang = _lang === 'zh' ? 'zh-CN' : 'en';
    const btn = document.getElementById('langToggleBtn');
    if (btn) btn.title = t('Language', '语言');
    document.querySelectorAll('#langDropdown .theme-option').forEach((opt) => {
        opt.classList.toggle('active', opt.dataset.lang === _lang);
    });
    applyStaticTranslations();
    translateTextIn(document.body);
    _listeners.forEach((fn) => {
        try { fn(_lang); } catch (e) { /* keep other listeners alive */ }
    });
}

async function setLang(lang) {
    _lang = lang === 'zh' ? 'zh' : 'en';
    await chrome.storage.sync.set({ uiLang: _lang });
    applyLangUi();
}

function setupLanguageDropdown() {
    const btn = document.getElementById('langToggleBtn');
    const dropdown = document.getElementById('langDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const themeDropdown = document.getElementById('themeDropdown');
        if (themeDropdown) themeDropdown.classList.remove('open');
        dropdown.classList.toggle('open');
    });

    dropdown.querySelectorAll('.theme-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.remove('open');
            setLang(opt.dataset.lang);
        });
    });

    document.addEventListener('click', () => dropdown.classList.remove('open'));
}

function init() {
    setupLanguageDropdown();
    installObserver();
    chrome.storage.sync.get('uiLang', (data) => {
        _lang = data && data.uiLang === 'zh' ? 'zh' : 'en';
        applyLangUi();
    });
}

init();
