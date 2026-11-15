import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AutoExpeditionStatus, PopupPortal } from '../../../application/popup/portal.js';
import type { SettingsPatch, SettingsV1 } from '../../../contracts/storage.js';
import type { ExpeditionOverview } from '../../../domains/expeditions/model.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Mercenary expeditions and Auto Expedition (H8 phase 7).
 */

export interface ExpeditionsDeps {
    readonly activePage: PopupPage;
    readonly expeditionPanelOpen: boolean;
    readonly reportDetail: (message: string) => void;
    readonly reloadSettings: () => Promise<void>;
    readonly setSettings: (value: SettingsV1 | null) => void;
    readonly loadAutoDrone: () => Promise<void>;
}

export interface ExpeditionsState {
    readonly expeditions: ExpeditionOverview | null;
    readonly expeditionBusy: boolean;
    readonly autoExpedition: AutoExpeditionStatus | null;
    readonly loadExpeditions: () => Promise<void>;
    readonly loadAutoExpedition: () => Promise<void>;
    readonly toggleAutoExpedition: () => Promise<string | null>;
    readonly cancelMercPreparation: () => Promise<void>;
    readonly updateAutomationSettings: (patch: SettingsPatch) => Promise<{ readonly ok: boolean; readonly error?: string }>;
}

export function useExpeditions(portal: PopupPortal, deps: ExpeditionsDeps): ExpeditionsState {
    const { activePage, expeditionPanelOpen, reportDetail, reloadSettings, setSettings, loadAutoDrone } = deps;
    const [expeditions, setExpeditions] = useState<ExpeditionOverview | null>(null);
    const [expeditionBusy, setExpeditionBusy] = useState(false);
    const [autoExpedition, setAutoExpedition] = useState<AutoExpeditionStatus | null>(null);
    const [autoExpeditionInterval, setAutoExpeditionInterval] = useState(30);

    const loadExpeditions = useCallback(async () => {
        setExpeditionBusy(true);
        const response = await portal.expeditionView();
        if (response.ok) {
            setExpeditions(response.value);
        } else {
            reportDetail(response.error.message);
        }
        setExpeditionBusy(false);
    }, [portal, reportDetail]);

    const loadAutoExpedition = useCallback(async () => {
        const response = await portal.autoExpeditionStatus();
        if (response.ok) {
            setAutoExpedition(response.value);
            setAutoExpeditionInterval(response.value.intervalMinutes);
        }
    }, [portal]);

    useEffect(() => {
        void loadAutoExpedition();
    }, [loadAutoExpedition]);

    const toggleAutoExpedition = useCallback(async (): Promise<string | null> => {
        setExpeditionBusy(true);
        const response = autoExpedition?.enabled
            ? await portal.disableAutoExpedition()
            : await portal.enableAutoExpedition(autoExpeditionInterval);
        setExpeditionBusy(false);
        await Promise.all([loadAutoExpedition(), reloadSettings()]);
        return response.ok ? null : response.error.message;
    }, [portal, autoExpedition, autoExpeditionInterval, loadAutoExpedition, reloadSettings]);

    const cancelMercPreparation = useCallback(async () => {
        const response = await portal.cancelExpeditionPreparation();
        if (!response.ok) reportDetail(response.error.message);
        await loadAutoExpedition();
    }, [portal, loadAutoExpedition, reportDetail]);

    const updateAutomationSettings = useCallback(async (patch: SettingsPatch): Promise<{ readonly ok: boolean; readonly error?: string }> => {
        const response = await portal.updateSettings(patch);
        if (!response.ok) {
            reportDetail(response.error.message);
            return { ok: false, error: response.error.message };
        }
        setSettings(response.value);
        await Promise.all([loadAutoExpedition(), loadAutoDrone()]);
        return { ok: true };
    }, [portal, loadAutoExpedition, loadAutoDrone, reportDetail, setSettings]);

    usePolling(() => Promise.all([loadExpeditions(), loadAutoExpedition(), loadAutoDrone()]).then(() => undefined), 15000, {
        enabled: activePage === 'automation' && expeditionPanelOpen,
    });

    // While a mercenary preparation is in flight the card needs a fast poll.
    usePolling(loadAutoExpedition, 1000, {
        enabled: activePage === 'automation' && Boolean(autoExpedition?.preparation),
        immediate: false,
    });

    return {
        expeditions,
        expeditionBusy,
        autoExpedition,
        loadExpeditions,
        loadAutoExpedition,
        toggleAutoExpedition,
        cancelMercPreparation,
        updateAutomationSettings,
    };
}
