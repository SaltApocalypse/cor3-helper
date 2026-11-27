import type { AutomationLogger } from '../../application/automation/ports.js';

/** Menu id used by the toolbar (action) context menu. */
export const ACTION_MENU_OPEN_WINDOW_ID = 'cor3-open-standalone-window';

export type ActionMenuLanguage = 'en' | 'zh';

/**
 * Chrome places extension-provided action menus below its own entries, so this
 * item lands directly under the built-in "Open in side panel".
 */
export function actionMenuTitle(language: ActionMenuLanguage): string {
    return language === 'zh' ? '在独立窗口中打开' : 'Open in a separate window';
}

export interface ActionMenuMenusApi {
    removeAll(): Promise<void>;
    create(properties: chrome.contextMenus.CreateProperties): string | number;
    readonly onClicked: {
        addListener(listener: (info: chrome.contextMenus.OnClickData) => void): void;
    };
}

export interface ActionMenuRuntimeApi {
    readonly onInstalled: { addListener(listener: () => void): void };
    readonly onStartup: { addListener(listener: () => void): void };
}

export interface ActionMenuDeps {
    readonly menus: ActionMenuMenusApi;
    readonly runtime: ActionMenuRuntimeApi;
    /** Reads the current UI language so the menu matches the rest of the UI. */
    readonly readLanguage: () => Promise<ActionMenuLanguage>;
    readonly openWindow: () => Promise<boolean>;
    readonly logger: Pick<AutomationLogger, 'warn'>;
}

export interface ActionMenuRefreshOptions {
    /** Recreate the item even when the language is unchanged. */
    readonly force?: boolean;
}

export interface ActionMenuHandle {
    /** Re-registers the item when the UI language changed. */
    refresh(options?: ActionMenuRefreshOptions): Promise<void>;
}

const registeredMenus = new WeakMap<object, ActionMenuHandle>();

/**
 * Registers the toolbar context menu item that opens the detached workspace.
 * Registration is idempotent per `menus` object; the handler is installed once
 * and the item is recreated on install/startup so a stale title cannot linger.
 * Settings writes call `refresh()` on every change, so the language is compared
 * before removing and recreating the item.
 */
export function registerActionMenu(deps: ActionMenuDeps): ActionMenuHandle {
    const existing = registeredMenus.get(deps.menus);
    if (existing) return existing;

    let registeredLanguage: ActionMenuLanguage | null = null;
    let queue: Promise<void> = Promise.resolve();

    const apply = async (options: ActionMenuRefreshOptions): Promise<void> => {
        try {
            const language = await deps.readLanguage();
            if (!options.force && language === registeredLanguage) return;
            await deps.menus.removeAll();
            deps.menus.create({
                id: ACTION_MENU_OPEN_WINDOW_ID,
                title: actionMenuTitle(language),
                contexts: ['action'],
            });
            registeredLanguage = language;
        } catch (error) {
            deps.logger.warn('action-menu', 'Could not register the toolbar context menu', {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    // Serialise refreshes so a burst of settings writes cannot interleave a
    // removeAll() from one run with the create() of another.
    const refresh = (options: ActionMenuRefreshOptions = {}): Promise<void> => {
        queue = queue.then(() => apply(options), () => apply(options));
        return queue;
    };

    deps.menus.onClicked.addListener((info) => {
        if (info.menuItemId !== ACTION_MENU_OPEN_WINDOW_ID) return;
        void deps.openWindow().then((opened) => {
            if (!opened) deps.logger.warn('action-menu', 'Could not open the standalone window from the toolbar menu');
        });
    });
    deps.runtime.onInstalled.addListener(() => { void refresh({ force: true }); });
    deps.runtime.onStartup.addListener(() => { void refresh({ force: true }); });
    const handle: ActionMenuHandle = { refresh };
    registeredMenus.set(deps.menus, handle);
    void refresh({ force: true });
    return handle;
}
