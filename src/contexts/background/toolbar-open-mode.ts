import {
    parseToolbarOpenMode,
    toolbarOpenModeLabels,
    toolbarOpenModeMenuItemId,
    toolbarOpenModePopup,
    type ToolbarOpenMode,
} from '../../application/settings/toolbar-open-mode.js';
import { settingsV1Schema, TOOLBAR_OPEN_MODES, type SettingsPatch, type SettingsV1 } from '../../contracts/storage.js';
import { openWorkspaceSidePanel, openWorkspaceWindow } from '../../infrastructure/browser/workspace-opener.js';
import { SETTINGS_KEY } from '../../infrastructure/storage/settings-repository.js';

const MENU_ROOT_ID = 'cor3-toolbar-open-mode';

interface SettingsPort {
    get(): Promise<SettingsV1>;
    update(patch: SettingsPatch): Promise<SettingsV1>;
}

export interface ToolbarOpenModeDeps {
    readonly settings: SettingsPort;
}

export function registerToolbarOpenMode({ settings }: ToolbarOpenModeDeps): void {
    let currentMode: ToolbarOpenMode = 'none';

    async function applyPopup(mode: ToolbarOpenMode): Promise<void> {
        try {
            await chrome.action.setPopup({ popup: toolbarOpenModePopup(mode) });
        } catch {
            // Keep the manifest popup if the browser rejects the runtime change.
        }
    }

    function syncMenuChecked(mode: ToolbarOpenMode): void {
        for (const item of TOOLBAR_OPEN_MODES) {
            try {
                void Promise.resolve(chrome.contextMenus.update(toolbarOpenModeMenuItemId(item), { checked: item === mode }))
                    .catch(() => undefined);
            } catch {
                // The menu may still be rebuilding after a service worker restart.
            }
        }
    }

    async function rebuildMenu(current: SettingsV1): Promise<void> {
        const labels = toolbarOpenModeLabels(current.uiLanguage);
        await chrome.contextMenus.removeAll();
        chrome.contextMenus.create({
            id: MENU_ROOT_ID,
            title: labels.parent,
            contexts: ['action'],
        });
        for (const mode of TOOLBAR_OPEN_MODES) {
            chrome.contextMenus.create({
                id: toolbarOpenModeMenuItemId(mode),
                parentId: MENU_ROOT_ID,
                title: labels.items[mode],
                type: 'radio',
                checked: mode === currentMode,
                contexts: ['action'],
            });
        }
    }

    async function refresh(): Promise<void> {
        try {
            const current = await settings.get();
            currentMode = current.toolbarOpenMode;
            await Promise.all([applyPopup(currentMode), rebuildMenu(current)]);
        } catch {
            // The manifest launcher and menu remain usable if settings are unavailable.
        }
    }

    chrome.contextMenus.onClicked.addListener((info) => {
        const mode = parseToolbarOpenMode(String(info.menuItemId));
        if (!mode) return;
        currentMode = mode;
        void applyPopup(mode);
        syncMenuChecked(mode);
        void settings.update({ toolbarOpenMode: mode }).catch(() => undefined);
    });

    chrome.action.onClicked.addListener(() => {
        if (currentMode === 'sidePanel') void openWorkspaceSidePanel();
        if (currentMode === 'window') void openWorkspaceWindow();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[SETTINGS_KEY];
        if (!change?.newValue) return;
        const parsed = settingsV1Schema.safeParse(change.newValue);
        if (!parsed.success) return;
        currentMode = parsed.data.toolbarOpenMode;
        void applyPopup(currentMode);
        syncMenuChecked(currentMode);
    });

    chrome.runtime.onInstalled.addListener(() => {
        void refresh();
    });
    chrome.runtime.onStartup?.addListener(() => {
        void refresh();
    });

    void refresh();
}
