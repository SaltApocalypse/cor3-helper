import { describe, expect, it, vi } from 'vitest';
import { ACTION_MENU_OPEN_WINDOW_ID, registerActionMenu, type ActionMenuMenusApi, type ActionMenuRuntimeApi } from './action-menu.js';

function fakes(initial: 'en' | 'zh' = 'zh') {
    let language: 'en' | 'zh' = initial;
    const listeners: ((info: { readonly menuItemId: string | number }) => void)[] = [];
    const installed: (() => void)[] = [];
    const startup: (() => void)[] = [];
    const create = vi.fn();
    const removeAll = vi.fn().mockResolvedValue(undefined);
    const menus = {
        removeAll,
        create,
        onClicked: {
            addListener: (listener: (info: { readonly menuItemId: string | number }) => void) => { listeners.push(listener); },
        },
    } as unknown as ActionMenuMenusApi;
    const runtime = {
        onInstalled: { addListener: (listener: () => void) => { installed.push(listener); } },
        onStartup: { addListener: (listener: () => void) => { startup.push(listener); } },
    } as unknown as ActionMenuRuntimeApi;
    return {
        menus,
        runtime,
        create,
        removeAll,
        listeners,
        installed,
        startup,
        setLanguage: (next: 'en' | 'zh') => { language = next; },
        readLanguage: async () => language,
    };
}

describe('registerActionMenu', () => {
    it('creates a toolbar menu item below the built-in side panel entry', async () => {
        const fake = fakes('zh');
        registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalled());
        expect(fake.create).toHaveBeenCalledWith({
            id: ACTION_MENU_OPEN_WINDOW_ID,
            title: '在独立窗口中打开',
            contexts: ['action'],
        });
    });

    it('uses the English title for an English UI', async () => {
        const fake = fakes('en');
        registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Open in a separate window' })));
    });

    it('opens the window for its own item only', async () => {
        const fake = fakes();
        const openWindow = vi.fn().mockResolvedValue(true);
        registerActionMenu({ ...fake, openWindow, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.listeners.length).toBe(1));
        fake.listeners[0]?.({ menuItemId: 'something-else' });
        expect(openWindow).not.toHaveBeenCalled();
        fake.listeners[0]?.({ menuItemId: ACTION_MENU_OPEN_WINDOW_ID });
        await vi.waitFor(() => expect(openWindow).toHaveBeenCalledTimes(1));
    });

    it('logs a failure when the window cannot be opened', async () => {
        const fake = fakes();
        const warn = vi.fn();
        registerActionMenu({ ...fake, openWindow: async () => false, logger: { warn } });
        await vi.waitFor(() => expect(fake.listeners.length).toBe(1));
        fake.listeners[0]?.({ menuItemId: ACTION_MENU_OPEN_WINDOW_ID });
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    });

    it('recreates the item on install and startup', async () => {
        const fake = fakes();
        registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
        fake.installed.forEach((listener) => listener());
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(2));
        fake.startup.forEach((listener) => listener());
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(3));
        expect(fake.removeAll).toHaveBeenCalledTimes(3);
    });

    it('does not touch the menu when settings change but the language did not', async () => {
        const fake = fakes('zh');
        const handle = registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
        await handle.refresh();
        expect(fake.removeAll).toHaveBeenCalledTimes(1);
        expect(fake.create).toHaveBeenCalledTimes(1);
    });

    it('rewrites the title after a language change', async () => {
        const fake = fakes('zh');
        const handle = registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
        fake.setLanguage('en');
        await handle.refresh();
        expect(fake.create).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Open in a separate window' }));
        expect(fake.create).toHaveBeenCalledTimes(2);
    });

    it('returns the same handle instead of registering the handler twice', async () => {
        const fake = fakes();
        const first = registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        const second = registerActionMenu({ ...fake, openWindow: async () => true, logger: { warn: vi.fn() } });
        expect(second).toBe(first);
        await vi.waitFor(() => expect(fake.create).toHaveBeenCalledTimes(1));
        expect(fake.listeners.length).toBe(1);
    });
});
