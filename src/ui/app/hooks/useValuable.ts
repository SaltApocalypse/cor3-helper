import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type {
    PopupPortal,
    ValuableMaintenanceServer,
    ValuableProgress,
    ValuableReport,
    ValuableRunState,
    ValuableSellOptions,
} from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Valuable search/sale runs, server maintenance selection and force runs
 * (H8 phase 7).
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
    readonly valuableOperation: ValuableRunState['operation'] | null;
    readonly valuableCanceling: boolean;
    readonly valuableProgress: ValuableProgress | null;
    readonly maintenanceServers: readonly ValuableMaintenanceServer[];
    readonly maintenanceLoading: boolean;
    readonly selectedMaintenanceIds: ReadonlySet<string>;
    readonly loadValuableReport: () => Promise<void>;
    readonly loadValuableMaintenance: (force?: boolean) => Promise<void>;
    readonly startValuableOperation: (operation: 'search' | 'sell', options?: ValuableSellOptions) => Promise<void>;
    readonly startForceMaintenance: (serverIds: readonly string[], includeDownloads?: boolean) => Promise<void>;
    readonly cancelValuableOperation: () => Promise<void>;
    readonly toggleForceMaintenance: (enabled: boolean) => Promise<void>;
    readonly toggleMaintenanceServer: (serverId: string) => void;
    readonly selectAllUpcoming: () => void;
}

export function useValuable(portal: PopupPortal, deps: ValuableDeps): ValuableState {
    const { activePage, tt, reportDetail } = deps;
    const [valuableStatus, setValuableStatus] = useState('Idle');
    const [valuableReport, setValuableReport] = useState<ValuableReport | null>(null);
    const [valuableRunId, setValuableRunId] = useState<string | null>(null);
    const [valuableOperation, setValuableOperation] = useState<ValuableRunState['operation'] | null>(null);
    const [valuableCanceling, setValuableCanceling] = useState(false);
    const [valuableProgress, setValuableProgress] = useState<ValuableProgress | null>(null);
    const [maintenanceServers, setMaintenanceServers] = useState<readonly ValuableMaintenanceServer[]>([]);
    const [maintenanceLoading, setMaintenanceLoading] = useState(false);
    const [selectedMaintenanceIds, setSelectedMaintenanceIds] = useState<ReadonlySet<string>>(new Set());
    const valuableStartLock = useRef(false);
    const maintenanceRequestSeq = useRef(0);

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
            setValuableStatus((current) => active.operation === 'force-maintenance'
                ? tt('Forcing server maintenance...')
                : current === tt('Idle')
                    ? active.operation === 'search'
                        ? tt('Searching all servers...')
                        : tt('Selling downloaded valuables...')
                    : current);
        }
    }, [portal, reportDetail, tt]);

    const loadValuableMaintenance = useCallback(async (force = false) => {
        const sequence = ++maintenanceRequestSeq.current;
        setMaintenanceLoading(true);
        try {
            const response = await portal.valuableMaintenance(force);
            if (sequence !== maintenanceRequestSeq.current) return;
            if (!response.ok) {
                reportDetail(response.error.message);
                return;
            }
            setMaintenanceServers(response.value);
            const selectable = new Set(response.value
                .filter((server) => !server.active && Boolean(server.timeUntil))
                .map((server) => server.id));
            setSelectedMaintenanceIds((current) => {
                const next = new Set([...current].filter((id) => selectable.has(id)));
                return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
            });
        } finally {
            if (sequence === maintenanceRequestSeq.current) setMaintenanceLoading(false);
        }
    }, [portal, reportDetail]);

    useEffect(() => {
        void loadValuableReport();
    }, [loadValuableReport]);

    useEffect(() => {
        if (activePage === 'automation') void loadValuableMaintenance();
    }, [activePage, loadValuableMaintenance]);

    const startValuableOperation = useCallback(async (operation: 'search' | 'sell', options?: ValuableSellOptions) => {
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
                // The background may start an automatic force-maintenance run
                // right after the sale. `loadValuableReport` below adopts it.
                const response = await portal.sellValuable(runId, options);
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
            await Promise.all([loadValuableReport(), loadValuableMaintenance()]);
        }
    }, [portal, valuableRunId, loadValuableReport, loadValuableMaintenance, tt]);

    const startForceMaintenance = useCallback(async (serverIds: readonly string[], includeDownloads = true) => {
        if (valuableRunId !== null || valuableStartLock.current || serverIds.length === 0) return;
        valuableStartLock.current = true;
        const runId = crypto.randomUUID();
        setValuableRunId(runId);
        setValuableOperation('force-maintenance');
        setValuableProgress(null);
        setValuableCanceling(false);
        setValuableStatus(tt('Forcing server maintenance...'));
        try {
            const response = await portal.startForceValuableMaintenance(runId, serverIds, includeDownloads);
            if (!response.ok) {
                setValuableStatus(response.error.message);
                setValuableRunId(null);
                setValuableOperation(null);
                return;
            }
            // The run continues in the background; `pollValuableProgress`
            // clears the run state when it finishes.
        } catch (error) {
            setValuableStatus(error instanceof Error ? error.message : String(error));
            setValuableRunId(null);
            setValuableOperation(null);
        } finally {
            valuableStartLock.current = false;
        }
    }, [portal, valuableRunId, tt]);

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
                const finishedOperation = valuableOperation;
                valuableStartLock.current = false;
                setValuableRunId(null);
                setValuableOperation(null);
                setValuableProgress(null);
                setValuableCanceling(false);
                await Promise.all([loadValuableReport(), loadValuableMaintenance(finishedOperation === 'force-maintenance')]);
                if (finishedOperation === 'force-maintenance') {
                    if (response.value.status === 'error') {
                        setValuableStatus(response.value.error ?? tt('Force maintenance failed.'));
                    } else if (response.value.status === 'cancelled') {
                        setValuableStatus(tt('Force maintenance cancelled.'));
                    } else {
                        setValuableStatus(tt('Force maintenance finished.'));
                    }
                }
            }
        }
    }, [portal, valuableRunId, valuableOperation, loadValuableReport, loadValuableMaintenance, tt]);

    const toggleForceMaintenance = useCallback(async (enabled: boolean) => {
        const response = await portal.updateSettings({ valuableForceMaintenanceEnabled: enabled });
        if (!response.ok) {
            reportDetail(response.error.message);
            return;
        }
        if (enabled) await loadValuableMaintenance(true);
        else setSelectedMaintenanceIds(new Set());
    }, [portal, reportDetail, loadValuableMaintenance]);

    const toggleMaintenanceServer = useCallback((serverId: string) => {
        setSelectedMaintenanceIds((current) => {
            const next = new Set(current);
            if (next.has(serverId)) next.delete(serverId);
            else next.add(serverId);
            return next;
        });
    }, []);

    const selectAllUpcoming = useCallback(() => {
        setSelectedMaintenanceIds(new Set(maintenanceServers
            .filter((server) => !server.active && Boolean(server.timeUntil))
            .map((server) => server.id)));
    }, [maintenanceServers]);

    usePolling(pollValuableProgress, 1000, { enabled: valuableRunId !== null });
    usePolling(loadValuableReport, 5000, { enabled: activePage === 'automation' });

    return {
        valuableStatus,
        valuableReport,
        valuableRunId,
        valuableOperation,
        valuableCanceling,
        valuableProgress,
        maintenanceServers,
        maintenanceLoading,
        selectedMaintenanceIds,
        loadValuableReport,
        loadValuableMaintenance,
        startValuableOperation,
        startForceMaintenance,
        cancelValuableOperation,
        toggleForceMaintenance,
        toggleMaintenanceServer,
        selectAllUpcoming,
    };
}
