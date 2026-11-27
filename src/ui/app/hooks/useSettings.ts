import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { PopupPortal } from '../../../application/popup/portal.js';
import type { UpdateCheckResult } from '../../../contracts/update-check.js';
import type { AuthStatus, SettingsPatch, SettingsV1 } from '../../../contracts/storage.js';
import type { HackToggleKey } from '../../features/automation/HackingAutomationCard.js';
import { detectBrowserLanguage, translate, type UiLanguage } from '../../i18n.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';

/**
 * Settings, language, auth and panel layout (H8 phase 7).
 *
 * `reloadAutomation` is injected by the composition root because the settings
 * actions (helper mode, import, reset) refresh the automation status hooks.
 */

export interface SettingsDeps {
    readonly activePage: PopupPage;
    readonly setActivePage: Dispatch<StateUpdater<PopupPage>>;
    readonly reloadAutomation: () => Promise<void>;
    readonly reportDetail: (message: string) => void;
}

export interface SettingsState {
    readonly settings: SettingsV1 | null;
    readonly setSettings: (value: SettingsV1 | null) => void;
    readonly auth: AuthStatus | null;
    readonly language: UiLanguage;
    readonly tt: TranslateSource;
    readonly helperMode: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly updatePanelOpen: (key: string, open: boolean) => void;
    readonly panelOrder: Readonly<Record<string, readonly string[]>>;
    readonly reorderPanels: (pageKey: string, ids: readonly string[]) => void;
    readonly resetPanelOrder: () => Promise<string | null>;
    readonly updateResult: UpdateCheckResult | null;
    readonly updateStatusError: string | null;
    readonly updateChecking: boolean;
    readonly checkUpdates: () => Promise<void>;
    readonly loadSettings: () => Promise<void>;
    readonly loadAuth: () => Promise<void>;
    readonly changeHelperMode: (enabled: boolean) => Promise<void>;
    readonly changeDeveloperMode: (enabled: boolean) => Promise<void>;
    readonly changeMysteryEgg: (enabled: boolean) => Promise<void>;
    readonly changeQol: (
        key: 'disableNetworkFog' | 'disableBackground' | 'moveNotificationsLeft' | 'antiAfkEnabled' | 'saiFileHighlightEnabled',
        enabled: boolean,
    ) => Promise<void>;
    readonly changeLanguage: (next: UiLanguage) => Promise<void>;
    readonly toggleHack: (key: HackToggleKey) => Promise<void>;
    readonly exportSettings: () => Promise<string | null>;
    readonly importSettings: (json: string) => Promise<string | null>;
    readonly resetSettings: () => Promise<string | null>;
}

export function useSettings(portal: PopupPortal, deps: SettingsDeps): SettingsState {
    const { activePage, setActivePage, reloadAutomation, reportDetail } = deps;
    const [settings, setSettings] = useState<SettingsV1 | null>(null);
    const [auth, setAuth] = useState<AuthStatus | null>(null);
    const languageInitStarted = useRef(false);
    const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>({});
    const panelStateInitialized = useRef(false);
    const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
    const [updateStatusError, setUpdateStatusError] = useState<string | null>(null);
    const [updateChecking, setUpdateChecking] = useState(false);
    const updateRequestId = useRef(0);
    const mountedRef = useRef(true);

    const language: UiLanguage = settings?.uiLanguage ?? 'en';
    const helperMode = settings?.helperMode ?? false;
    const languageRef = useRef(language);
    languageRef.current = language;
    const tt = useCallback((source: string, vars?: Readonly<Record<string, string | number>>) => translate(languageRef.current, source, vars), []);

    useEffect(() => {
        if (!settings || panelStateInitialized.current) return;
        panelStateInitialized.current = true;
        setPanelOpen(settings.panelOpenState);
    }, [settings]);

    const updatePanelOpen = useCallback((key: string, open: boolean) => {
        panelStateInitialized.current = true;
        setPanelOpen((current) => {
            const panelOpenState = { ...current, [key]: open };
            void portal.updateSettings({ panelOpenState });
            return panelOpenState;
        });
    }, [portal]);

    const panelOrder = settings?.panelOrderState ?? {};

    const reorderPanels = useCallback((pageKey: string, ids: readonly string[]) => {
        const panelOrderState = { ...settings?.panelOrderState, [pageKey]: [...ids] };
        // Update the local view immediately so the drop does not snap back
        // while the settings round-trip is in flight.
        setSettings((current) => current ? { ...current, panelOrderState } : current);
        void portal.updateSettings({ panelOrderState }).then((response) => {
            if (response.ok) setSettings(response.value);
            else reportDetail(response.error.message);
        });
    }, [portal, reportDetail, settings?.panelOrderState]);

    const resetPanelOrder = useCallback(async (): Promise<string | null> => {
        const response = await portal.updateSettings({ panelOrderState: {} });
        if (!response.ok) return response.error.message;
        setSettings(response.value);
        return null;
    }, [portal]);

    const loadSettings = useCallback(async () => {
        const response = await portal.getSettings();
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    const loadAuth = useCallback(async () => {
        const response = await portal.authStatus();
        if (response.ok) setAuth(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    useEffect(() => {
        void loadSettings();
        void loadAuth();
    }, [loadSettings, loadAuth]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            updateRequestId.current += 1;
        };
    }, []);

    const loadUpdateStatus = useCallback(async () => {
        const requestId = ++updateRequestId.current;
        try {
            const response = await portal.updateStatus();
            if (!mountedRef.current || requestId !== updateRequestId.current) return;
            if (response.ok) {
                setUpdateResult(response.value);
                setUpdateStatusError(null);
            } else {
                setUpdateStatusError(response.error.message);
            }
        } catch (error) {
            if (!mountedRef.current || requestId !== updateRequestId.current) return;
            setUpdateStatusError(error instanceof Error ? error.message : String(error));
        }
    }, [portal]);

    const checkUpdates = useCallback(async () => {
        if (updateChecking) return;
        setUpdateChecking(true);
        setUpdateStatusError(null);
        const requestId = ++updateRequestId.current;
        try {
            const response = await portal.updateCheck();
            if (!mountedRef.current || requestId !== updateRequestId.current) return;
            if (response.ok) {
                setUpdateResult(response.value);
                setUpdateStatusError(null);
            } else {
                setUpdateStatusError(response.error.message);
            }
        } catch (error) {
            if (!mountedRef.current || requestId !== updateRequestId.current) return;
            setUpdateStatusError(error instanceof Error ? error.message : String(error));
        } finally {
            if (mountedRef.current) setUpdateChecking(false);
        }
    }, [portal, updateChecking]);

    useEffect(() => {
        if (activePage !== 'settings') {
            updateRequestId.current += 1;
            return;
        }
        void loadUpdateStatus();
    }, [activePage, loadUpdateStatus]);

    const changeHelperMode = useCallback(async (enabled: boolean) => {
        const response = await portal.updateSettings(enabled
            ? { helperMode: true }
            : { helperMode: false, helperModeConsent: true });
        if (!response.ok) {
            reportDetail(response.error.message);
            return;
        }
        setSettings(response.value);
        if (enabled) {
            setActivePage((current) => current === 'automation' ? 'overview' : current);
            await reloadAutomation();
        }
    }, [portal, reloadAutomation, reportDetail, setActivePage]);

    const changeDeveloperMode = useCallback(async (enabled: boolean) => {
        const response = await portal.updateSettings({ developerMode: enabled });
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    const changeMysteryEgg = useCallback(async (enabled: boolean) => {
        const response = await portal.updateSettings({ mysteryEggEnabled: enabled });
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    const changeQol = useCallback(async (
        key: 'disableNetworkFog' | 'disableBackground' | 'moveNotificationsLeft' | 'antiAfkEnabled' | 'saiFileHighlightEnabled',
        enabled: boolean,
    ) => {
        const response = await portal.updateSettings({ [key]: enabled } as SettingsPatch);
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    const changeLanguage = useCallback(async (next: UiLanguage) => {
        const response = await portal.updateSettings({ uiLanguage: next, languageInitialized: true });
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, reportDetail]);

    const exportSettings = useCallback(async (): Promise<string | null> => {
        const response = await portal.exportSettings();
        if (!response.ok) return response.error.message;
        const stamp = new Date().toISOString().slice(0, 10);
        portal.exportText(`cor3-helper-settings-${stamp}.json`, JSON.stringify(response.value, null, 2));
        return null;
    }, [portal]);

    const importSettings = useCallback(async (json: string): Promise<string | null> => {
        let payload: unknown;
        try {
            payload = JSON.parse(json);
        } catch {
            return tt('The selected file is not valid JSON');
        }
        const response = await portal.importSettings(payload);
        if (!response.ok) return response.error.message;
        setSettings(response.value);
        panelStateInitialized.current = false;
        setPanelOpen(response.value.panelOpenState);
        await reloadAutomation();
        return null;
    }, [portal, reloadAutomation, tt]);

    const resetSettings = useCallback(async (): Promise<string | null> => {
        const response = await portal.resetSettings();
        if (!response.ok) return response.error.message;
        // A reset is a fresh install: re-run browser-language detection so a
        // Chinese browser does not fall back to the English default.
        const detected = detectBrowserLanguage();
        const reinitialized = await portal.updateSettings({ uiLanguage: detected, languageInitialized: true });
        setSettings(reinitialized.ok ? reinitialized.value : response.value);
        panelStateInitialized.current = false;
        setPanelOpen(reinitialized.ok ? reinitialized.value.panelOpenState : response.value.panelOpenState);
        await reloadAutomation();
        return null;
    }, [portal, reloadAutomation]);

    const toggleHack = useCallback(async (key: HackToggleKey) => {
        if (!settings) return;
        const response = await portal.updateSettings({ [key]: !settings[key] } as SettingsPatch);
        if (response.ok) setSettings(response.value);
        else reportDetail(response.error.message);
    }, [portal, settings, reportDetail]);

    useEffect(() => {
        if (!settings || settings.languageInitialized || languageInitStarted.current) return;
        languageInitStarted.current = true;
        const detected = detectBrowserLanguage();
        if (detected === settings.uiLanguage) {
            void portal.updateSettings({ languageInitialized: true }).then((response) => {
                if (response.ok) setSettings(response.value);
            });
            return;
        }
        void portal.updateSettings({ uiLanguage: detected, languageInitialized: true }).then((response) => {
            if (response.ok) setSettings(response.value);
        });
    }, [settings, portal]);

    return {
        settings,
        setSettings,
        auth,
        language,
        tt,
        helperMode,
        panelOpen,
        updatePanelOpen,
        panelOrder,
        reorderPanels,
        resetPanelOrder,
        updateResult,
        updateStatusError,
        updateChecking,
        checkUpdates,
        loadSettings,
        loadAuth,
        changeHelperMode,
        changeDeveloperMode,
        changeMysteryEgg,
        changeQol,
        changeLanguage,
        toggleHack,
        exportSettings,
        importSettings,
        resetSettings,
    };
}
