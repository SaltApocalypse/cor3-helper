import { afterEach, describe, expect, it, vi } from 'vitest';
import { toolbarOpenModeMenuItemId } from '../../application/settings/toolbar-open-mode.js';
import { settingsV1Schema, type SettingsPatch, type SettingsV1 } from '../../contracts/storage.js';
import { registerToolbarOpenMode } from './toolbar-open-mode.js';

function fakeSettings(initial: SettingsV1 = settingsV1Schema.parse({})) {
    let value = initial;
    return {
        get: vi.fn(async () => value),
        update: vi.fn(async (patch: SettingsPatch) => {
            value = settingsV1Schema.parse({ ...value, ...patch });
            return value;
        }),
    };
}

function stubChrome() {
    const listeners = {
        menuClick: vi.fn(),
        actionClick: vi.fn(),
        storageChanged: vi.fn(),
        installed: vi.fn(),
        startup: vi.fn(),
    };
    const setPopup = vi.fn().mockResolvedValue(undefined);
    const removeAll = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue(undefined);
    const sidePanelOpen = vi.fn().mockResolvedValue(undefined);
    const windowsCreate = vi.fn().mockResolvedValue({ id: 2 });

    vi.stubGlobal('chrome', {
        action: { setPopup, onClicked: { addListener: listeners.actionClick } },
        contextMenus: { removeAll, create, update, onClicked: { addListener: listeners.menuClick } },
        storage: { onChanged: { addListener: listeners.storageChanged } },
        runtime: {
            getURL: (path: string) => `chrome-extension://test-id/${path}`,
            onInstalled: { addListener: listeners.installed },
            onStartup: { addListener: listeners.startup },
        },
        windows: {
            getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
            getAll: vi.fn().mockResolvedValue([]),
            create: windowsCreate,
            update: vi.fn().mockResolvedValue(undefined),
        },
        sidePanel: { open: sidePanelOpen },
    });

    return { listeners, setPopup, removeAll, create, update, sidePanelOpen, windowsCreate };
}

describe('toolbar open mode router', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('applies the saved mode and builds a localized menu on registration', async () => {
        const chromeApi = stubChrome();
        const settings = fakeSettings({
            ...settingsV1Schema.parse({}),
            toolbarOpenMode: 'popup',
            uiLanguage: 'zh',
        });

        registerToolbarOpenMode({ settings });

        await vi.waitFor(() => expect(chromeApi.setPopup).toHaveBeenCalledWith({ popup: 'sidepanel.html?mode=popup' }));
        expect(chromeApi.create).toHaveBeenCalledWith(expect.objectContaining({
            id: 'cor3-toolbar-open-mode',
            title: '默认打开方式',
        }));
        expect(chromeApi.create).toHaveBeenCalledWith(expect.objectContaining({
            id: toolbarOpenModeMenuItemId('popup'),
            title: '弹窗',
            checked: true,
        }));
    });

    it('opens the side panel directly after the menu selection', async () => {
        const chromeApi = stubChrome();
        const settings = fakeSettings();
        registerToolbarOpenMode({ settings });
        await vi.waitFor(() => expect(chromeApi.create).toHaveBeenCalled());

        const onMenuClick = chromeApi.listeners.menuClick.mock.calls[0]?.[0] as (info: { menuItemId: string }) => void;
        onMenuClick({ menuItemId: toolbarOpenModeMenuItemId('sidePanel') });

        expect(settings.update).toHaveBeenCalledWith({ toolbarOpenMode: 'sidePanel' });
        expect(chromeApi.setPopup).toHaveBeenCalledWith({ popup: '' });
        expect(chromeApi.update).toHaveBeenCalledWith(toolbarOpenModeMenuItemId('sidePanel'), { checked: true });

        const onActionClick = chromeApi.listeners.actionClick.mock.calls[0]?.[0] as () => void;
        onActionClick();
        await vi.waitFor(() => expect(chromeApi.sidePanelOpen).toHaveBeenCalledWith({ windowId: 1 }));
    });

    it('opens a detached window directly after the menu selection', async () => {
        const chromeApi = stubChrome();
        registerToolbarOpenMode({ settings: fakeSettings() });
        await vi.waitFor(() => expect(chromeApi.create).toHaveBeenCalled());

        const onMenuClick = chromeApi.listeners.menuClick.mock.calls[0]?.[0] as (info: { menuItemId: string }) => void;
        onMenuClick({ menuItemId: toolbarOpenModeMenuItemId('window') });

        const onActionClick = chromeApi.listeners.actionClick.mock.calls[0]?.[0] as () => void;
        onActionClick();
        await vi.waitFor(() => expect(chromeApi.windowsCreate).toHaveBeenCalledWith(expect.objectContaining({
            url: expect.stringContaining('?mode=window'),
        })));
    });

    it('applies settings changes coming from import or reset', async () => {
        const chromeApi = stubChrome();
        registerToolbarOpenMode({ settings: fakeSettings() });
        await vi.waitFor(() => expect(chromeApi.create).toHaveBeenCalled());

        const onStorageChanged = chromeApi.listeners.storageChanged.mock.calls[0]?.[0] as (
            changes: Record<string, { newValue?: unknown }>,
            area: string,
        ) => void;
        onStorageChanged({
            'v2.settings': { newValue: { ...settingsV1Schema.parse({}), toolbarOpenMode: 'popup' } },
        }, 'local');

        expect(chromeApi.setPopup).toHaveBeenCalledWith({ popup: 'sidepanel.html?mode=popup' });
        expect(chromeApi.update).toHaveBeenCalledWith(toolbarOpenModeMenuItemId('popup'), { checked: true });
    });

    it('rebuilds the menu when the browser starts', async () => {
        const chromeApi = stubChrome();
        registerToolbarOpenMode({ settings: fakeSettings() });
        await vi.waitFor(() => expect(chromeApi.removeAll).toHaveBeenCalledTimes(1));

        const onStartup = chromeApi.listeners.startup.mock.calls[0]?.[0] as () => void;
        onStartup();

        await vi.waitFor(() => expect(chromeApi.removeAll).toHaveBeenCalledTimes(2));
    });
});
