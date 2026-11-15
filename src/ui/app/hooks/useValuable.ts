import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PopupPortal, ValuableProgress, ValuableReport } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Valuable search/sell runs and their progress (H8 phase 7).
 */

export interface ValuableDeps {
    readonly activePage: PopupPage;
    readonly tt: TranslateSource;
    readonly reportDetail: (message: string) => void;
}

export interface ValuableState {
    readonly valuableStatus: string;
    readonly valuableReport: ValuableReport | null;
    readonly valuableRunId: string | null;
    readonly valuableOperation: 'search' | 'sell' | null;
    readonly valuableCanceling: boolean;
    readonly valuableProgress: ValuableProgress | null;
    readonly loadValuableReport: () => Promise<void>;
    readonly startValuableOperation: (operation: 'search' | 'sell') => Promise<void>;
    readonly cancelValuableOperation: () => Promise<void>;
}

export function useValuable(portal: PopupPortal, deps: ValuableDeps): ValuableState {
    const { activePage, tt, reportDetail } = deps;
    const [valuableStatus, setValuableStatus] = useState('Idle');
    const [valuableReport, setValuableReport] = useState<ValuableReport | null>(null);
    const [valuableRunId, setValuableRunId] = useState<string | null>(null);
    const [valuableOperation, setValuableOperation] = useState<'search' | 'sell' | null>(null);
    const [valuableCanceling, setValuableCanceling] = useState(false);
    const [valuableProgress, setValuableProgress] = useState<ValuableProgress | null>(null);
    const valuableStartLock = useRef(false);

    const loadValuableReport = useCallback(async () => {
        const response = await portal.valuableReport();
        if (!response.ok) {
            reportDetail(response.error.message);
            return;
        }
        setValuableReport(response.value);
        const active = response.value.active;
        if (active) {
            setValuableRunId(active.runId);
            setValuableOperation(active.operation);
            setValuableProgress(active.progress);
            setValuableStatus((current) => current === tt('Idle')
                ? active.operation === 'search' ? tt('Searching all servers...') : tt('Selling downloaded valuables...')
                : current);
        }
    }, [portal, reportDetail, tt]);

    useEffect(() => {
        void loadValuableReport();
    }, [loadValuableReport]);

    const startValuableOperation = useCallback(async (operation: 'search' | 'sell') => {
        if (valuableRunId !== null || valuableStartLock.current) return;
        valuableStartLock.current = true;
        const runId = crypto.randomUUID();
        setValuableRunId(runId);
        setValuableOperation(operation);
        setValuableProgress(null);
        setValuableCanceling(false);
        setValuableStatus(operation === 'search' ? tt('Searching all servers...') : tt('Selling downloaded valuables...'));
        try {
            if (operation === 'search') {
                const response = await portal.searchValuable(runId);
                if (!response.ok) {
                    setValuableStatus(response.error.message);
                    return;
                }
                const value = response.value;
                const failures = value.serverFailures.length > 0 ? ` · ${value.serverFailures.length} ${tt('failed')}` : '';
                setValuableStatus(value.stopped
                    ? `${tt('Search cancelled: downloaded {files} file(s), {logs} log(s)', { files: value.downloadedFiles, logs: value.downloadedLogs })}${failures}`
                    : `${tt('Downloaded {files} file(s) and {logs} log(s) from {servers} server(s)', { files: value.downloadedFiles, logs: value.downloadedLogs, servers: value.serversScanned })}${failures}`);
            } else {
                const response = await portal.sellValuable(runId);
                if (!response.ok) {
                    setValuableStatus(response.error.message);
                    return;
                }
                const value = response.value;
                const failures = value.marketFailures.length > 0 ? ` · ${value.marketFailures.length} ${tt('failed')}` : '';
                setValuableStatus(value.stopped
                    ? `${tt('Sale cancelled after {items} item(s) for {credits} credits', { items: value.soldItems, credits: Math.round(value.credits).toLocaleString() })}${failures}`
                    : `${tt('Sold {items} item(s) for {credits} credits and ⭐ {reputation}', { items: value.soldItems, credits: Math.round(value.credits).toLocaleString(), reputation: Math.round(value.reputation) })}${failures}`);
            }
        } catch (error) {
            setValuableStatus(error instanceof Error ? error.message : String(error));
        } finally {
            valuableStartLock.current = false;
            setValuableRunId((current) => current === runId ? null : current);
            setValuableOperation((current) => current === operation ? null : current);
            setValuableProgress(null);
            setValuableCanceling(false);
            await loadValuableReport();
        }
    }, [portal, valuableRunId, loadValuableReport, tt]);

    const cancelValuableOperation = useCallback(async () => {
        if (valuableRunId === null || valuableCanceling) return;
        setValuableCanceling(true);
        const response = await portal.cancelValuable(valuableRunId);
        if (response.ok) {
            setValuableStatus(tt('Cancellation requested...'));
        } else {
            setValuableStatus(response.error.message);
            setValuableCanceling(false);
        }
    }, [portal, valuableRunId, valuableCanceling, tt]);

    const pollValuableProgress = useCallback(async () => {
        if (valuableRunId === null) return;
        const response = await portal.valuableProgress(valuableRunId);
        if (response.ok && response.value) {
            setValuableProgress(response.value.progress);
            if (response.value.status !== 'running') {
                setValuableRunId(null);
                setValuableOperation(null);
                setValuableProgress(null);
                setValuableCanceling(false);
                await loadValuableReport();
            }
        }
    }, [portal, valuableRunId, loadValuableReport]);

    usePolling(pollValuableProgress, 1000, { enabled: valuableRunId !== null });
    usePolling(loadValuableReport, 5000, { enabled: activePage === 'automation' });

    return {
        valuableStatus,
        valuableReport,
        valuableRunId,
        valuableOperation,
        valuableCanceling,
        valuableProgress,
        loadValuableReport,
        startValuableOperation,
        cancelValuableOperation,
    };
}
