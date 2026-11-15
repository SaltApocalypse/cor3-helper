/**
 * Small UI translation layer for the 2.0 shell.
 *
 * v1 keeps a large runtime dictionary. The 2.0 rewrite only translates the
 * surfaces that exist so far; new strings should be added here instead of
 * hardcoding English in components. Language detection runs once on first
 * launch and is then driven by the persisted `uiLanguage` setting.
 */

import { ZH_MESSAGES } from './i18n-messages.js';

export type UiLanguage = 'en' | 'zh';

export function detectBrowserLanguage(languages?: readonly string[]): UiLanguage {
    const candidates = languages ?? (typeof navigator === 'undefined'
        ? []
        : [...(navigator.languages ?? []), navigator.language].filter((entry): entry is string => typeof entry === 'string'));
    for (const candidate of candidates) {
        if (candidate.toLowerCase().startsWith('zh')) return 'zh';
        if (candidate.toLowerCase().startsWith('en')) return 'en';
    }
    return 'en';
}

const EN = {
    'status.ok': 'OK',
    'status.offline': 'OFFLINE',
    'status.auth': 'AUTH',
    'status.needsRefresh': 'NEEDS REFRESH',
    'status.endpoint': 'ENDPOINT',
    'status.noEndpoint': 'NO ENDPOINT',
    'status.pingHint': 'Background service worker is responding.',
    'status.authHint': 'cor3.gg session detected. If it is missing, open cor3.gg, then refresh the page and the extension.',
    'status.endpointHint': 'An endpoint-capable game server is available on the current network map.',

    'nav.overview': 'Overview',
    'nav.progress': 'Progress',
    'nav.automation': 'Automation',
    'nav.game': 'Game',
    'nav.settings': 'Settings',
    'nav.developer': 'Developer',

    'settings.title': 'Settings',
    'settings.basic.title': 'Basic settings',
    'settings.basic.description': 'Language, automation permission and local data.',
    'settings.language': 'Language',
    'settings.language.description': 'Interface language for the 2.0 side panel and popup.',
    'settings.helperMode': 'Helper Mode',
    'settings.helperMode.description': 'While enabled, every automation is disabled and the Automation tab is hidden.',
    'settings.helperMode.info': 'About automation risk',
    'settings.helperMode.warning': 'This extension provides optional automation for in-game tasks. Abusing it can seriously damage your game experience! We recommend playing through the game content before turning Helper Mode off.\n\nThis extension is a third-party tool written and maintained by community players. It carries inherent risks; the developer/maintainer is not responsible for any negative consequences.',
    'settings.helperMode.confirmTitle': 'Turn off Helper Mode?',
    'settings.helperMode.confirmPrompt': 'Type the phrase below to confirm that you understand the risk.',
    'settings.helperMode.confirmWord': 'I understand',
    'settings.helperMode.confirmPlaceholder': 'Type the phrase here',
    'settings.helperMode.confirmButton': 'Turn off Helper Mode',
    'settings.helperMode.cancel': 'Cancel',
    'settings.helperMode.mismatch': 'The text does not match. Check the phrase and try again.',
    'settings.developerMode': 'Developer tools',
    'settings.developerMode.description': 'Show the Developer tab for diagnostics and network inspection.',
    'settings.data.title': 'Settings backup',
    'settings.data.description': 'Reinstalling the extension clears local storage. Export your settings first, then import them after reinstalling.',
    'settings.data.export': 'Export settings',
    'settings.data.import': 'Import settings',
    'settings.data.reset': 'Reset settings',
    'settings.data.resetConfirm': 'Click again to reset all settings',
    'settings.data.exported': 'Settings exported.',
    'settings.data.imported': 'Settings imported.',
    'settings.data.importFailed': 'Import failed: {message}',
    'settings.data.resetDone': 'Settings reset to defaults.',
    'settings.data.busy': 'Working...',

    'settings.qol.title': 'Quality of life',
    'settings.qol.description': 'Optional tweaks for the game interface. They apply to the open cor3.gg tab.',
    'settings.qol.networkFog': 'Disable network map fog',
    'settings.qol.networkFog.desc': 'Hide the fog videos on the network map.',
    'settings.qol.background': 'Disable desktop glitch / wave background',
    'settings.qol.background.desc': 'Remove the animated background layers from the game desktop.',
    'settings.qol.notifications': 'Move game notifications to the left',
    'settings.qol.notifications.desc': 'Place toast and notification history on the left side of the screen.',
    'settings.qol.antiAfk': 'Anti-AFK clicker',
    'settings.qol.antiAfk.desc': 'Click the game desktop every three minutes while the tab is open.',

    'settings.session.title': 'Session',
    'settings.session.description': 'Only the state needed to use the extension.',
    'settings.session.auth': 'cor3.gg session',
    'settings.session.connected': 'Connected',
    'settings.session.needsRefresh': 'Needs refresh',
    'settings.session.refreshHint': 'Open cor3.gg in a tab, then refresh the page and the extension.',
    'settings.session.endpoint': 'Game endpoint',
    'settings.session.endpointAvailable': 'Available',
    'settings.session.endpointMissing': 'Not found',
    'settings.session.snapshot': 'Network snapshot',
    'settings.session.snapshotFresh': '{age} ago',
    'settings.session.snapshotMissing': 'Not captured yet',
    'settings.session.readiness': 'Game tab',
    'settings.session.readinessReady': 'Ready',
    'settings.session.readinessMissing': 'No game tab detected',

    'settings.about.version': 'Version',
    'settings.about.fork': 'Fork',
    'settings.about.forkValue': 'SaltA Fork',
    'settings.about.upstream': 'Built on the upstream COR3 Helper project by Femtoce11.',
    'settings.about.links': 'Project links',
    'settings.about.check': 'Check for updates',
    'settings.about.checking': 'Checking...',
    'settings.about.upToDate': 'You are up to date.',
    'settings.about.updateAvailable': 'Update available: {version}',
    'settings.about.download': 'Download',
    'settings.about.checkFailed': 'Could not check for updates.',

    'developer.title': 'Developer tools',
    'developer.intro': 'Diagnostics for bug reports. Normal use does not need this page.',
    'developer.runtime.title': 'Runtime',
    'developer.runtime.description': 'Background worker and bridge health.',
    'developer.ping': 'Ping background',
    'developer.network.title': 'Network',
    'developer.network.description': 'Live network snapshot, queue and discovery.',
    'developer.network.refresh': 'Refresh map',
    'developer.network.discover': 'Discover 4 IPs',
    'developer.network.waiting': 'Waiting for the live map...',
    'developer.diagnostics.title': 'Diagnostics',
    'developer.diagnostics.description': 'Copy internal state when reporting a bug.',
    'developer.diagnostics.refresh': 'Refresh diagnostics',
    'developer.diagnostics.copy': 'Copy diagnostics',
    'developer.diagnostics.snapshot': 'Copy Auto Jobs snapshot',
    'developer.diagnostics.notLoaded': 'Not loaded',
    'developer.debug.title': 'Automation debug',
    'developer.debug.description': 'Live automation log, exported as one line per entry.',
    'developer.servers': 'Servers',
    'developer.connections': 'Connections',
    'developer.hiddenConnections': 'Hidden connections',
    'developer.home': 'Home',
    'developer.endpoint': 'Endpoint',
    'developer.accessible': 'Accessible',
    'developer.endpointCapable': 'Endpoint-capable',
    'developer.maintenance': 'Maintenance',
    'developer.queue': 'Queue',
    'developer.queueIdle': 'idle',
    'developer.queueWaiting': '{count} waiting',
    'developer.detailUnknown': 'unknown',
    'developer.detailNone': 'none',
    'developer.scan': 'Scan: {scanned}/{total} · new edges {edges} · new servers {servers}',
    'developer.scanPartial': ' · partial',
    'developer.discoveryDone': 'Discovery run complete',
    'developer.scanning': 'Scanning known IPs...',

    'welcome.title': 'Welcome',
    'welcome.description': 'Manage markets, automation and game tools from the side panel or a separate window.',
    'welcome.open': 'Open side panel',
    'welcome.opening': 'Opening side panel...',
    'welcome.openWindow': 'Open in window',
    'welcome.openFailed': 'Could not open the side panel from this context.',
    'welcome.openWindowFailed': 'Could not open the window from this context.',
    'header.openWindow': 'Open in a separate window',

    'helper.title': 'Helper Mode',
    'helper.description': 'Lock every automation until you are ready.',
    'helper.enable': 'Enable Helper Mode',
    'helper.onHint': 'Helper Mode is on. Automation is locked and hidden.',
    'helper.offHint': 'Helper Mode is off. Automation is available in the side panel.',

    'links.title': 'Related links',
    'links.description': 'Official and community resources.',
    'links.arg': 'COR3 web ARG',
    'links.site': 'Fragmentary Order website',
    'links.discord': 'Official Discord community',
    'links.x': 'Official X · Fragmentary Order',
    'links.xCorp': 'Official X · COR3 Corp',
    'links.guide': 'Community game guide',
} as const;

type MessageKey = keyof typeof EN;
type Dictionary = Record<MessageKey, string>;

const ZH: Dictionary = {
    'status.ok': '正常',
    'status.offline': '离线',
    'status.auth': '已连接',
    'status.needsRefresh': '需刷新',
    'status.endpoint': '端点',
    'status.noEndpoint': '无端点',
    'status.pingHint': '后台服务工作线程正在响应。',
    'status.authHint': '已检测到 cor3.gg 会话。若未显示，请先打开 cor3.gg，然后刷新网页与扩展。',
    'status.endpointHint': '当前网络地图中存在支持端点的游戏服务器。',

    'nav.overview': '总览',
    'nav.progress': '进度',
    'nav.automation': '自动化',
    'nav.game': '游戏',
    'nav.settings': '设置',
    'nav.developer': '开发者',

    'settings.title': '设置',
    'settings.basic.title': '基本设置',
    'settings.basic.description': '语言、自动化权限和本地数据。',
    'settings.language': '语言',
    'settings.language.description': '2.0 侧边栏和弹窗的界面语言。',
    'settings.helperMode': '辅助模式',
    'settings.helperMode.description': '开启后禁用所有自动化功能，并隐藏 Automation 面板。',
    'settings.helperMode.info': '关于自动化风险',
    'settings.helperMode.warning': '该扩展提供了部分自动化处理游戏内任务的功能，滥用该功能会对你的游戏体验造成严重损害！建议您在充分体验游戏内容后再考虑关闭辅助模式。\n\n该扩展是社区玩家自发编写维护的第三方工具，存在一定的风险，开发者/维护者不对其可能的任何负面影响负责！',
    'settings.helperMode.confirmTitle': '关闭辅助模式？',
    'settings.helperMode.confirmPrompt': '请在下方输入指定文本，确认你已了解相关风险。',
    'settings.helperMode.confirmWord': '我已知晓',
    'settings.helperMode.confirmPlaceholder': '在此输入确认文本',
    'settings.helperMode.confirmButton': '关闭辅助模式',
    'settings.helperMode.cancel': '取消',
    'settings.helperMode.mismatch': '输入内容不匹配，请检查后重试。',
    'settings.developerMode': '开发者工具',
    'settings.developerMode.description': '显示 Developer 面板，用于诊断和网络检查。',
    'settings.data.title': '设置备份',
    'settings.data.description': '重新安装扩展会清除本地存储。建议先导出设置，重新安装后再导入。',
    'settings.data.export': '导出设置',
    'settings.data.import': '导入设置',
    'settings.data.reset': '重置设置',
    'settings.data.resetConfirm': '再次点击以重置所有设置',
    'settings.data.exported': '设置已导出。',
    'settings.data.imported': '设置已导入。',
    'settings.data.importFailed': '导入失败：{message}',
    'settings.data.resetDone': '设置已重置为默认值。',
    'settings.data.busy': '处理中...',

    'settings.qol.title': '生活质量',
    'settings.qol.description': '可选的游戏界面优化，仅对当前打开的 cor3.gg 标签页生效。',
    'settings.qol.networkFog': '禁用网络地图迷雾',
    'settings.qol.networkFog.desc': '隐藏网络地图上的迷雾视频。',
    'settings.qol.background': '禁用桌面故障/波浪背景',
    'settings.qol.background.desc': '移除游戏桌面上的动态背景层。',
    'settings.qol.notifications': '将游戏内通知移至左侧',
    'settings.qol.notifications.desc': '将弹窗和通知历史移动到屏幕左侧。',
    'settings.qol.antiAfk': '防挂机点击器',
    'settings.qol.antiAfk.desc': '标签页打开时每三分钟点击一次游戏桌面。',

    'settings.session.title': '会话',
    'settings.session.description': '仅显示使用扩展所必需的状态。',
    'settings.session.auth': 'cor3.gg 会话',
    'settings.session.connected': '已连接',
    'settings.session.needsRefresh': '需要刷新',
    'settings.session.refreshHint': '请先打开 cor3.gg 标签页，然后刷新网页与扩展。',
    'settings.session.endpoint': '游戏端点',
    'settings.session.endpointAvailable': '可用',
    'settings.session.endpointMissing': '未找到',
    'settings.session.snapshot': '网络快照',
    'settings.session.snapshotFresh': '{age} 前',
    'settings.session.snapshotMissing': '尚未捕获',
    'settings.session.readiness': '游戏标签页',
    'settings.session.readinessReady': '就绪',
    'settings.session.readinessMissing': '未检测到游戏标签页',

    'settings.about.version': '版本',
    'settings.about.fork': '分支',
    'settings.about.forkValue': 'SaltA Fork',
    'settings.about.upstream': '基于 Femtoce11 的上游 COR3 Helper 项目。',
    'settings.about.links': '项目链接',
    'settings.about.check': '检查更新',
    'settings.about.checking': '检查中...',
    'settings.about.upToDate': '已是最新版本。',
    'settings.about.updateAvailable': '发现新版本：{version}',
    'settings.about.download': '前往下载',
    'settings.about.checkFailed': '无法检查更新。',

    'developer.title': '开发者工具',
    'developer.intro': '用于反馈问题的诊断信息，正常使用无需打开此页。',
    'developer.runtime.title': '运行时',
    'developer.runtime.description': '后台服务与通信健康状态。',
    'developer.ping': '测试后台连接',
    'developer.network.title': '网络',
    'developer.network.description': '实时网络快照、队列与发现。',
    'developer.network.refresh': '刷新地图',
    'developer.network.discover': '扫描 4 个 IP',
    'developer.network.waiting': '正在等待实时地图...',
    'developer.diagnostics.title': '诊断',
    'developer.diagnostics.description': '反馈问题时复制内部状态。',
    'developer.diagnostics.refresh': '刷新诊断',
    'developer.diagnostics.copy': '复制诊断',
    'developer.diagnostics.snapshot': '复制 Auto Jobs 快照',
    'developer.diagnostics.notLoaded': '未加载',
    'developer.debug.title': '自动化调试',
    'developer.debug.description': '实时自动化日志，导出时每条记录占一行。',
    'developer.servers': '服务器',
    'developer.connections': '连接',
    'developer.hiddenConnections': '隐藏连接',
    'developer.home': '主服务器',
    'developer.endpoint': '端点',
    'developer.accessible': '可访问',
    'developer.endpointCapable': '支持端点',
    'developer.maintenance': '维护',
    'developer.queue': '队列',
    'developer.queueIdle': '空闲',
    'developer.queueWaiting': '{count} 个等待',
    'developer.detailUnknown': '未知',
    'developer.detailNone': '无',
    'developer.scan': '扫描：{scanned}/{total} · 新增连接 {edges} · 新增服务器 {servers}',
    'developer.scanPartial': ' · 部分完成',
    'developer.discoveryDone': '发现扫描完成',
    'developer.scanning': '正在扫描已知 IP...',

    'welcome.title': '欢迎',
    'welcome.description': '在侧边栏或独立窗口中管理市场、自动化与游戏工具。',
    'welcome.open': '打开侧边栏',
    'welcome.opening': '正在打开侧边栏...',
    'welcome.openWindow': '在独立窗口中打开',
    'welcome.openFailed': '无法在当前上下文打开侧边栏。',
    'welcome.openWindowFailed': '无法在当前上下文打开独立窗口。',
    'header.openWindow': '在独立窗口中打开',

    'helper.title': '辅助模式',
    'helper.description': '在你准备好之前锁定所有自动化功能。',
    'helper.enable': '启用辅助模式',
    'helper.onHint': '辅助模式已开启，自动化功能已锁定并隐藏。',
    'helper.offHint': '辅助模式已关闭，可在侧边栏使用自动化功能。',

    'links.title': '相关链接',
    'links.description': '官方与社区资源。',
    'links.arg': 'COR3 网页 ARG 解密',
    'links.site': 'Fragmentary Order 官网',
    'links.discord': '官方 Discord 社区',
    'links.x': '官方 X · Fragmentary Order',
    'links.xCorp': '官方 X · COR3 Corp',
    'links.guide': '社区维护的游戏指南',
};

const DICTIONARIES: Record<UiLanguage, Dictionary> = { en: EN, zh: ZH };

function interpolate(template: string, vars?: Readonly<Record<string, string | number>>): string {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match);
}

export function t(language: UiLanguage, key: MessageKey, vars?: Readonly<Record<string, string | number>>): string {
    return interpolate(DICTIONARIES[language]?.[key] ?? EN[key], vars);
}

/**
 * Translate a free-form English source string. Existing semantic keys above
 * cover the 2.0 shell; this helper covers the ported v2 panels without
 * duplicating every sentence beside its JSX.
 */
export function translate(language: UiLanguage, source: string, vars?: Readonly<Record<string, string | number>>): string {
    const template = language === 'zh' ? ZH_MESSAGES[source] ?? source : source;
    return interpolate(template, vars);
}

export type { MessageKey };
