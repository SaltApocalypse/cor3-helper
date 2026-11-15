import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AutoDailyStatus, PopupPortal } from '../../../application/popup/portal.js';
import type { DailyOpsState } from '../../../domains/daily-ops/model.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Daily Ops view, manual daily hack and Auto Daily (H8 phase 7).
 */

export interface DailyDeps {
    readonly activePage: PopupPage;
    readonly tt: TranslateSource;
    readonly reportDetail: (message: string) => void;
    readonly reloadSettings: () => Promise<void>;
    readonly dailyHackEnabled: boolean | undefined;
}

export interface DailyState {
    readonly daily: DailyOpsState | null;
    readonly dailyBusy: boolean;
    readonly autoDaily: AutoDailyStatus | null;
    readonly loadDaily: (silent?: boolean, force?: boolean) => Promise<void>;
    readonly loadAutoDaily: () => Promise<void>;
    readonly toggleAutoDaily: () => Promise<void>;
    readonly runDailyHackNow: () => Promise<void>;
}

export function useDaily(portal: PopupPortal, deps: DailyDeps): DailyState {
    const { activePage, tt, reportDetail, reloadSettings, dailyHackEnabled } = deps;
    const [daily, setDaily] = useState<DailyOpsState | null>(null);
    const [autoDaily, setAutoDaily] = useState<AutoDailyStatus | null>(null);
    const [autoDailyInterval, setAutoDailyInterval] = useState(240);
    const [dailyBusy, setDailyBusy] = useState(false);

    const loadDaily = useCallback(async (silent = false, force = false) => {
        if (!silent) setDailyBusy(true);
        try {
            const response = await portal.dailyView(force);
            if (response.ok) setDaily(response.value);
        } finally {
            if (!silent) setDailyBusy(false);
        }
    }, [portal]);

    const loadAutoDaily = useCallback(async () => {
        const response = await portal.autoDailyStatus();
        if (response.ok) {
            setAutoDaily(response.value);
            setAutoDailyInterval(response.value.intervalMinutes);
        }
    }, [portal]);

    useEffect(() => {
        void loadAutoDaily();
    }, [loadAutoDaily]);

    const toggleAutoDaily = useCallback(async () => {
        setDailyBusy(true);
        try {
            const currentlyEnabled = dailyHackEnabled ?? autoDaily?.enabled ?? false;
            const response = currentlyEnabled
                ? await portal.disableAutoDaily()
                : await portal.enableAutoDaily(autoDailyInterval);
            if (!response.ok) reportDetail(response.error.message);
        } catch (error) {
            reportDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setDailyBusy(false);
        }
        await Promise.all([loadAutoDaily(), reloadSettings()]);
    }, [portal, autoDaily, autoDailyInterval, dailyHackEnabled, loadAutoDaily, reloadSettings, reportDetail]);

    const runDailyHackNow = useCallback(async () => {
        setDailyBusy(true);
        try {
            const response = await portal.runDailyHack();
            if (response.ok) {
                reportDetail(`${response.value.solved ? tt('Daily hack solved') : tt('Daily hack not solved')}: ${response.value.message}`);
            } else {
                reportDetail(response.error.message);
            }
        } catch (error) {
            reportDetail(error instanceof Error ? error.message : String(error));
        } finally {
            setDailyBusy(false);
        }
        await Promise.all([loadDaily(true, true), loadAutoDaily()]);
    }, [portal, loadDaily, loadAutoDaily, reportDetail, tt]);

    usePolling(() => Promise.all([loadAutoDaily(), loadDaily(true)]).then(() => undefined), 15000, {
        enabled: activePage === 'automation' && (autoDaily?.enabled ?? false),
        immediate: false,
    });

    return { daily, dailyBusy, autoDaily, loadDaily, loadAutoDaily, toggleAutoDaily, runDailyHackNow };
}
