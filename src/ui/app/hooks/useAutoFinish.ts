import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AutoFinishFailure, AutoFinishMarketResult, AutoFinishStatus, PopupPortal } from '../../../application/popup/portal.js';
import type { AutoFinishUnknownJob } from '../../../contracts/auto-finish.js';
import { sortUnknownJobs } from '../view-models/job-report.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { autoFinishMarketsToJobReport, type UiJobReport } from '../view-models/job-report.js';
import { usePolling } from './usePolling.js';

/**
 * Auto Finish switch, manual run and run progress (H8 phase 7).
 */

export interface AutoFinishDeps {
    readonly tt: TranslateSource;
    readonly activePage: PopupPage;
    readonly jobRunId: string | null;
    readonly setJobStatus: (update: string | ((current: string) => string)) => void;
    readonly setJobReport: (report: readonly UiJobReport[]) => void;
    readonly updatePanelOpen: (key: string, open: boolean) => void;
}

export interface AutoFinishState {
    readonly autoFinish: AutoFinishStatus | null;
    readonly autoFinishBusy: boolean;
    readonly autoFinishCanceling: boolean;
    readonly autoCompleteCountdown: number | null;
    /** Markets of the live or last Auto Finish run (`autoRunMarkets`). */
    readonly markets: readonly AutoFinishMarketResult[];
    /** Complete-unknown failures from the last AutoFinish report. */
    readonly unconfirmedFailures: readonly AutoFinishFailure[];
    /** Durable per-job Unknown projection, sorted for stable display. */
    readonly unknownJobs: readonly AutoFinishUnknownJob[];
    readonly unknownStateStatus: 'loaded' | 'partial' | 'unavailable';
    /** Market-scoped completion truth. */
    readonly completedJobsByMarket: import('../../../contracts/market-completed-jobs.js').MarketCompletedJobsState;
    /** Legacy jobId-only records; display/diagnostics only. */
    readonly legacyCompletedJobs: Readonly<Record<string, string>>;
    readonly completionStateStatus: 'not-loaded' | 'loaded' | 'unavailable';
    /** Run id used by the merged debug log query. */
    readonly logRunId: string | null;
    readonly loadAutoFinish: () => Promise<void>;
    readonly runAutoFinishNow: () => Promise<void>;
    readonly toggleAutoFinish: () => Promise<void>;
    readonly cancelAutoFinish: () => Promise<void>;
}

export function useAutoFinish(portal: PopupPortal, deps: AutoFinishDeps): AutoFinishState {
    const { tt, activePage, jobRunId, setJobStatus, setJobReport, updatePanelOpen } = deps;
    const [autoFinish, setAutoFinish] = useState<AutoFinishStatus | null>(null);
    const [autoFinishBusy, setAutoFinishBusy] = useState(false);
    const [autoFinishCanceling, setAutoFinishCanceling] = useState(false);
    const [autoCompleteCountdown, setAutoCompleteCountdown] = useState<number | null>(null);
    const autoFinishRequestSeq = useRef(0);
    const [finishPolling, setFinishPolling] = useState(false);
    const finishPollingRef = useRef(false);
    const setFinishPollingActive = useCallback((active: boolean) => {
        finishPollingRef.current = active;
        setFinishPolling(active);
    }, []);

    const autoRunMarkets = autoFinish?.live?.markets ?? autoFinish?.last?.markets ?? [];
    const unconfirmedFailures = (autoFinish?.last?.failures ?? []).filter((failure) => failure.unconfirmed === true && failure.marketKey !== undefined);
    const unknownJobs = sortUnknownJobs(autoFinish?.unknownJobs ?? []);
    const unknownStateStatus = autoFinish?.unknownStateStatus ?? 'unavailable';

    const loadAutoFinish = useCallback(async () => {
        const sequence = ++autoFinishRequestSeq.current;
        const response = await portal.autoFinishStatus();
        if (sequence !== autoFinishRequestSeq.current) return;
        if (response.ok) {
            setAutoFinish(response.value);
            if (response.value.enabled && response.value.last) {
                setJobReport(autoFinishMarketsToJobReport(response.value.last.markets));
            }
        } else {
            setJobStatus(tt('Auto Jobs status failed: {message}', { message: response.error.message }));
        }
    }, [portal, setJobReport, setJobStatus, tt]);

    useEffect(() => {
        void loadAutoFinish();
    }, [loadAutoFinish]);

    const pollFinishStatus = useCallback(async () => {
        if (!finishPollingRef.current) return;
        const status = await portal.autoFinishStatus();
        if (!finishPollingRef.current) return;
        if (status.ok) {
            setAutoFinish(status.value);
            if (!status.value.running) setFinishPollingActive(false);
        }
    }, [portal, setFinishPollingActive]);

    usePolling(pollFinishStatus, 1000, { enabled: finishPolling, pauseWhenHidden: false });

    const runAutoFinishNow = useCallback(async () => {
        setAutoFinishBusy(true);
        setJobStatus(tt('Auto Jobs running...'));
        setFinishPollingActive(true);
        const response = await portal.runAutoFinish(true);
        setFinishPollingActive(false);
        if (response.ok) {
            setJobReport(autoFinishMarketsToJobReport(response.value.markets));
            setJobStatus(response.value.stopped ? tt('Auto Jobs stopped.') : tt('Auto Jobs complete.'));
        } else {
            setJobStatus(response.error.message);
        }
        setAutoFinishBusy(false);
        await loadAutoFinish();
    }, [portal, loadAutoFinish, setFinishPollingActive, setJobReport, setJobStatus, tt]);

    const toggleAutoFinish = useCallback(async () => {
        if (autoFinishBusy || jobRunId !== null) return;
        setAutoFinishBusy(true);
        try {
            if (autoFinish?.enabled) {
                setAutoCompleteCountdown(null);
                const response = await portal.disableAutoFinish();
                if (!response.ok) setJobStatus(response.error.message);
                else setAutoFinish((current) => current ? { ...current, enabled: false } : current);
                await loadAutoFinish();
                return;
            }
            const response = await portal.enableAutoFinish();
            if (!response.ok) {
                setJobStatus(response.error.message);
                // The run may already be active from a previous panel session.
                // Refresh the real state so the switch reflects it.
                await loadAutoFinish();
                return;
            }
            setAutoFinish((current) => ({
                ...(current ?? {
                    running: false,
                    currentRunId: null,
                    live: null,
                    last: null,
                    progress: null,
                    nextRetryAt: null,
                    retryReason: null,
                    completedJobsByMarket: { byMarket: {} },
                    legacyCompletedJobs: {},
                    completionStateStatus: 'not-loaded',
                    unknownJobs: [],
                    unknownStateStatus: 'unavailable',
                }),
                enabled: true,
            }));
            updatePanelOpen('auto-complete', true);
            setAutoCompleteCountdown(5);
            await loadAutoFinish();
        } finally {
            setAutoFinishBusy(false);
        }
    }, [portal, autoFinish, autoFinishBusy, jobRunId, loadAutoFinish, setJobStatus, updatePanelOpen]);

    useEffect(() => {
        if (autoCompleteCountdown === null) return;
        if (autoCompleteCountdown <= 0) {
            setAutoCompleteCountdown(null);
            void runAutoFinishNow();
            return;
        }
        const timer = setTimeout(() => setAutoCompleteCountdown((value) => value === null ? null : value - 1), 1000);
        return () => clearTimeout(timer);
    }, [autoCompleteCountdown, runAutoFinishNow]);

    const cancelAutoFinish = useCallback(async () => {
        if (autoFinishCanceling) return;
        setAutoFinishCanceling(true);
        const response = await portal.cancelAutoFinish();
        setJobStatus(response.ok ? tt('Auto Finish cancellation requested') : response.error.message);
        if (!response.ok) setAutoFinishCanceling(false);
    }, [portal, autoFinishCanceling, setJobStatus, tt]);

    useEffect(() => {
        if (!autoFinish?.running) setAutoFinishCanceling(false);
    }, [autoFinish?.running]);

    usePolling(loadAutoFinish, 5000, {
        enabled: activePage === 'automation' && (autoFinish?.enabled ?? false),
        immediate: false,
    });

    const logRunId = autoFinish?.currentRunId ?? autoFinish?.last?.runId ?? null;

    return {
        autoFinish,
        autoFinishBusy,
        unconfirmedFailures,
        unknownJobs,
        unknownStateStatus,
        autoFinishCanceling,
        autoCompleteCountdown,
        markets: autoRunMarkets,
        completedJobsByMarket: autoFinish?.completedJobsByMarket ?? { byMarket: {} },
        legacyCompletedJobs: autoFinish?.legacyCompletedJobs ?? {},
        completionStateStatus: autoFinish?.completionStateStatus ?? 'not-loaded',
        logRunId,
        loadAutoFinish,
        runAutoFinishNow,
        toggleAutoFinish,
        cancelAutoFinish,
    };
}
