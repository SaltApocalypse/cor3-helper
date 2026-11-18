import { TOOLBAR_OPEN_MODES } from '../../contracts/storage.js';

export type ToolbarOpenMode = (typeof TOOLBAR_OPEN_MODES)[number];
export type ToolbarOpenModeLanguage = 'en' | 'zh';

export interface ToolbarOpenModeLabels {
    readonly parent: string;
    readonly items: Readonly<Record<ToolbarOpenMode, string>>;
}

const MENU_ITEM_PREFIX = 'toolbar-open-mode:';

const POPUP_BY_MODE: Readonly<Record<ToolbarOpenMode, string>> = {
    sidePanel: '',
    window: '',
    popup: 'sidepanel.html?mode=popup',
    none: 'popup.html',
};

const EN_LABELS: ToolbarOpenModeLabels = {
    parent: 'Default open mode',
    items: {
        sidePanel: 'Side panel',
        window: 'Detached window',
        popup: 'Toolbar popup',
        none: 'None (launcher)',
    },
};

const ZH_LABELS: ToolbarOpenModeLabels = {
    parent: '默认打开方式',
    items: {
        sidePanel: '侧边栏',
        window: '独立窗口',
        popup: '弹窗',
        none: '无（启动器）',
    },
};

/** Empty popup disables the browser action popup so onClicked can be handled. */
export function toolbarOpenModePopup(mode: ToolbarOpenMode): string {
    return POPUP_BY_MODE[mode];
}

export function toolbarOpenModeMenuItemId(mode: ToolbarOpenMode): string {
    return `${MENU_ITEM_PREFIX}${mode}`;
}

export function parseToolbarOpenMode(menuItemId: string): ToolbarOpenMode | null {
    if (!menuItemId.startsWith(MENU_ITEM_PREFIX)) return null;
    const value = menuItemId.slice(MENU_ITEM_PREFIX.length);
    return TOOLBAR_OPEN_MODES.find((mode) => mode === value) ?? null;
}

export function toolbarOpenModeLabels(language: ToolbarOpenModeLanguage): ToolbarOpenModeLabels {
    return language === 'zh' ? ZH_LABELS : EN_LABELS;
}
