import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AutoJobsStatus, PopupPortal } from '../../../application/popup/portal.js';
import { JOB_TYPES, type JobOffer } from '../../../application/popup/catalog.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import type { TranslateSource } from '../../i18n-context.js';
import { usePolling } from './usePolling.js';

/**
 * Auto Jobs switch, Auto complete job-type settings and the failed-job
 * dismissal countdown (H8 phase 7).
 */

export interface AutoJobsDeps {
    readonly tt: TranslateSource;
    readonly settings: SettingsV1 | null;
    readonly setSettings: (value: SettingsV1 | null) => void;
    readonly setJobStatus: (update: string | ((current: string) => string)) => void;
    readonly loadSnapshot: () => Promise<void>;
    readonly reloadSettings: () => Promise<void>;
}

export interface AutoJobsState {
    readonly autoJobs: AutoJobsStatus | null;
    readonly autoJobsBusy: boolean;
    readonly autoCompleteTypes: readonly JobOffer['type'][];
    readonly allAutoCompleteTypes: boolean;
    readonly autoCompleteTypesSorted: readonly JobOffer['type'][];
    readonly autoDismissCountdown: number | null;
    readonly loadAutoJobs: () => Promise<void>;
    readonly toggleAutoJobs: () => Promise<void>;
    readonly toggleAutoCompleteType: (type: JobOffer['type']) => Promise<void>;
    readonly toggleAllAutoCompleteTypes: () => Promise<void>;
    readonly toggleAutoDismissFailed: () => Promise<void>;
}

export function useAutoJobs(portal: PopupPortal, deps: AutoJobsDeps): AutoJobsState {
    const { tt, settings, setSettings, setJobStatus, loadSnapshot, reloadSettings } = deps;
    const [autoJobs, setAutoJobs] = useState<AutoJobsStatus | null>(null);
    const [autoJobsBusy, setAutoJobsBusy] = useState(false);
    const autoJobsRequestSeq = useRef(0);
    const [autoDismissCountdown, setAutoDismissCountdown] = useState<number | null>(null);

    const autoCompleteTypes = settings?.autoCompleteJobTypes ?? [...JOB_TYPES];
    const allAutoCompleteTypes = autoCompleteTypes.length === JOB_TYPES.length;
    const autoCompleteTypesSorted = [...JOB_TYPES].sort((left, right) => left.localeCompare(right));

    const loadAutoJobs = useCallback(async () => {
        const sequence = ++autoJobsRequestSeq.current;
        const response = await portal.autoJobsStatus();
        if (sequence !== autoJobsRequestSeq.current) return;
        if (response.ok) setAutoJobs(response.value);
        else setJobStatus(tt('Auto Jobs status failed'));
    }, [portal, setJobStatus, tt]);

    useEffect(() => {
        void loadAutoJobs();
    }, [loadAutoJobs]);

    const toggleAutoJobs = useCallback(async () => {
        if (autoJobsBusy || autoJobs?.running) return;
        setAutoJobsBusy(true);
        try {
            const currentlyEnabled = settings?.autoJobsEnabled ?? autoJobs?.enabled ?? false;
            const response = currentlyEnabled ? await portal.disableAutoJobs() : await portal.enableAutoJobs();
            if (!response.ok) setJobStatus(response.error.message);
        } catch (error) {
            setJobStatus(error instanceof Error ? error.message : String(error));
        } finally {
            setAutoJobsBusy(false);
        }
        await Promise.all([loadAutoJobs(), reloadSettings()]);
    }, [portal, autoJobs, autoJobsBusy, loadAutoJobs, reloadSettings, settings, setJobStatus]);

    const toggleAutoCompleteType = useCallback(async (type: JobOffer['type']) => {
        if (!settings) return;
        const current = settings.autoCompleteJobTypes;
        const next = current.includes(type)
            ? current.filter((entry) => entry !== type)
            : [...current, type];
        const response = await portal.updateSettings({ autoCompleteJobTypes: next });
        if (response.ok) setSettings(response.value);
        else setJobStatus(response.error.message);
    }, [portal, settings, setJobStatus, setSettings]);

    const toggleAllAutoCompleteTypes = useCallback(async () => {
        if (!settings) return;
        const next = allAutoCompleteTypes ? [] : [...JOB_TYPES];
        const response = await portal.updateSettings({ autoCompleteJobTypes: next });
        if (response.ok) setSettings(response.value);
        else setJobStatus(response.error.message);
    }, [allAutoCompleteTypes, portal, settings, setJobStatus, setSettings]);

    const toggleAutoDismissFailed = useCallback(async () => {
        if (!settings) return;
        const next = !settings.autoDismissFailedJobsEnabled;
        const response = await portal.updateSettings({ autoDismissFailedJobsEnabled: next });
        if (response.ok) {
            setSettings(response.value);
            setAutoDismissCountdown(next ? 5 : null);
        } else {
            setJobStatus(response.error.message);
        }
    }, [portal, settings, setJobStatus, setSettings]);

    const runAutoDismissNow = useCallback(async () => {
        const response = await portal.dismissFailedJobs();
        if (response.ok) {
            setJobStatus(tt('Submitted {count} failed job(s)', { count: response.value.dismissed }) + (response.value.failed ? tt('; {count} failed to submit', { count: response.value.failed }) : ''));
            await loadSnapshot();
        } else {
            setJobStatus(response.error.message);
        }
    }, [portal, loadSnapshot, setJobStatus, tt]);

    useEffect(() => {
        if (autoDismissCountdown === null) return;
        if (autoDismissCountdown <= 0) {
            setAutoDismissCountdown(null);
            void runAutoDismissNow();
            return;
        }
        const timer = setTimeout(() => setAutoDismissCountdown((value) => value === null ? null : value - 1), 1000);
        return () => clearTimeout(timer);
    }, [autoDismissCountdown, runAutoDismissNow]);

    usePolling(loadSnapshot, 1000, { enabled: autoJobs?.running ?? false, immediate: false });

    return {
        autoJobs,
        autoJobsBusy,
        autoCompleteTypes,
        allAutoCompleteTypes,
        autoCompleteTypesSorted,
        autoDismissCountdown,
        loadAutoJobs,
        toggleAutoJobs,
        toggleAutoCompleteType,
        toggleAllAutoCompleteTypes,
        toggleAutoDismissFailed,
    };
}
