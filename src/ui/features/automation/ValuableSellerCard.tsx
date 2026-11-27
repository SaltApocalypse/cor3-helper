import { useEffect, useState } from 'preact/hooks';
import type { ValuableMaintenanceServer, ValuableProgress, ValuableReport, ValuableRunState, ValuableSellOptions } from '../../../application/popup/portal.js';
import { formatRemaining } from '../../format.js';
import { InfoTip } from '../../components/InfoTip.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { useT, type TranslateSource } from '../../i18n-context.js';

export interface ValuableSellerCardProps {
    readonly runId: string | null;
    readonly operation: ValuableRunState['operation'] | null;
    readonly status: string;
    readonly progress: ValuableProgress | null;
    readonly report: ValuableReport | null;
    readonly canceling: boolean;
    readonly now: number;
    readonly forceMaintenanceEnabled: boolean;
    readonly maintenanceServers: readonly ValuableMaintenanceServer[];
    readonly maintenanceLoading: boolean;
    readonly selectedMaintenanceIds: ReadonlySet<string>;
    readonly onSearch: () => void | Promise<void>;
    readonly onSell: (options?: ValuableSellOptions) => void | Promise<void>;
    readonly onCancel: () => void | Promise<void>;
    readonly onToggleForceMaintenance: (enabled: boolean) => void | Promise<void>;
    readonly onRefreshMaintenance: () => void | Promise<void>;
    readonly onToggleMaintenanceServer: (serverId: string) => void;
    readonly onSelectAllUpcoming: () => void;
    readonly onForceSelected: () => void | Promise<void>;
    readonly expanded: boolean;
    readonly onOpenChange: (open: boolean) => void;
}

function phaseLabel(progress: ValuableProgress, tr: TranslateSource): string {
    switch (progress.phase) {
        case 'server':
            return tr('Checking server');
        case 'download':
            return tr('Downloading');
        case 'market':
            return tr('Checking market');
        case 'sell':
            return tr('Selling item');
        case 'maintenance':
            return tr('Forcing maintenance');
    }
}

function formatReportTime(value: number | null, tr: TranslateSource): string {
    if (value === null) return tr('never');
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function defaultStatus(report: ValuableReport | null, operation: ValuableRunState['operation'] | null, tr: TranslateSource): string {
    if (operation === 'search') return tr('Searching all servers...');
    if (operation === 'sell') return tr('Selling downloaded valuables...');
    if (operation === 'force-maintenance') return tr('Forcing server maintenance...');
    if (!report) return tr('Loading valuable report...');
    if (report.unsoldItems > 0) {
        return tr('Ready · {count} downloaded item(s) waiting to be sold.', { count: report.unsoldItems });
    }
    if (report.lastSearchAt !== null || report.lastSellAt !== null) {
        return tr('Ready · last search {search} · last sale {sale}.', {
            search: formatReportTime(report.lastSearchAt, tr),
            sale: formatReportTime(report.lastSellAt, tr),
        });
    }
    return tr('No search yet. Start with Search all servers, then sell the downloaded valuables.');
}

function maintenanceStatus(server: ValuableMaintenanceServer, now: number, tr: TranslateSource): string {
    if (server.active) {
        return server.endsAt ? `${tr('In maintenance')} · ${formatRemaining(server.endsAt, now)}` : tr('In maintenance');
    }
    return server.timeUntil ? `${tr('Upcoming')} · ${formatRemaining(server.timeUntil, now)}` : tr('Upcoming');
}

export function ValuableSellerCard({
    runId,
    operation,
    status,
    progress,
    report,
    canceling,
    now,
    forceMaintenanceEnabled,
    maintenanceServers,
    maintenanceLoading,
    selectedMaintenanceIds,
    onSearch,
    onSell,
    onCancel,
    onToggleForceMaintenance,
    onRefreshMaintenance,
    onToggleMaintenanceServer,
    onSelectAllUpcoming,
    onForceSelected,
    expanded,
    onOpenChange,
}: ValuableSellerCardProps) {
    const tr = useT();
    const running = runId !== null;
    const searchRunning = running && operation === 'search';
    const sellRunning = running && operation === 'sell';
    const forceRunning = running && operation === 'force-maintenance';
    const [maintenanceOpen, setMaintenanceOpen] = useState(false);

    const upcoming = maintenanceServers.filter((server) => !server.active && Boolean(server.timeUntil));
    const selectedUpcoming = upcoming.filter((server) => selectedMaintenanceIds.has(server.id));
    const sellOptions: ValuableSellOptions | undefined = forceMaintenanceEnabled && selectedUpcoming.length > 0
        ? { forceMaintenance: { serverIds: selectedUpcoming.map((server) => server.id), includeDownloads: true } }
        : undefined;

    useEffect(() => {
        if (!forceMaintenanceEnabled) setMaintenanceOpen(false);
    }, [forceMaintenanceEnabled]);

    const toggleForce = async () => {
        const next = !forceMaintenanceEnabled;
        await onToggleForceMaintenance(next);
        if (next) setMaintenanceOpen(true);
    };

    return (
        <AutomationCard
            title={tr('Valuable Search & Sale')}
            description={tr('Search every hackable server with the strongest owned SEARCH loadout, download valuable files, then sell them market by market.')}
            alwaysAvailable
            expanded={expanded}
            onOpenChange={onOpenChange}
        >
            <details class="v2-debug-console v2-status-console" open>
                <summary class="v2-status-toggle">
                    <span class="v2-status-title">{tr('Status and report')}</span>
                </summary>
                <div class="v2-status-body">
                    <p class="v2-muted v2-valuable-status">{status && status !== 'Idle' ? tr(status) : defaultStatus(report, operation, tr)}</p>
                    {progress ? (
                        <p class="v2-muted v2-valuable-progress">
                            {phaseLabel(progress, tr)}: {progress.target} ({progress.index}/{progress.total})
                        </p>
                    ) : null}
                    <ul class="v2-valuable-report">
                        <li>
                            <span class="v2-item-name">{tr('Downloaded')}</span>
                            <span>{tr('{files} files · {logs} logs', { files: report?.downloadedFiles ?? 0, logs: report?.downloadedLogs ?? 0 })}</span>
                        </li>
                        <li>
                            <span class="v2-item-name">{tr('Sold')}</span>
                            <span>{tr('{count} items', { count: report?.soldItems ?? 0 })}</span>
                        </li>
                        <li>
                            <span class="v2-item-name">{tr('Unsold downloads')}</span>
                            <span class={report && report.unsoldItems > 0 ? 'v2-tag v2-tag-warn' : ''}>
                                {tr('{count} items', { count: report?.unsoldItems ?? 0 })}
                            </span>
                        </li>
                        <li>
                            <span class="v2-item-name">{tr('Total earned')}</span>
                            <span>{Math.round(report?.credits ?? 0).toLocaleString()} cr · ⭐ {Math.round(report?.reputation ?? 0)}</span>
                        </li>
                        {report && (report.forcedServers > 0 || report.lastForceAt !== null) ? (
                            <li>
                                <span class="v2-item-name">{tr('Maintenance forced')}</span>
                                <span>
                                    {tr('{count} server(s)', { count: report.forcedServers })}
                                    {report.lastForceAt !== null ? ` · ${formatReportTime(report.lastForceAt, tr)}` : ''}
                                </span>
                            </li>
                        ) : null}
                    </ul>
                </div>
            </details>

            <details
                class={`v2-debug-console v2-status-console v2-valuable-maintenance${forceMaintenanceEnabled ? '' : ' v2-valuable-maintenance-disabled'}`}
                open={forceMaintenanceEnabled && maintenanceOpen}
                onToggle={(event) => {
                    if (forceMaintenanceEnabled) setMaintenanceOpen(event.currentTarget.open);
                }}
            >
                <summary
                    class="v2-status-toggle"
                    onClick={(event) => {
                        if (!forceMaintenanceEnabled) event.preventDefault();
                    }}
                >
                    <span class="v2-status-title v2-status-title-with-tip">
                        {tr('Server status & maintenance')}
                        <span onClick={(event) => event.stopPropagation()}>
                            <InfoTip text={tr('Select upcoming servers and force them into maintenance. Forcing makes them unavailable for jobs and markets.')} />
                        </span>
                    </span>
                    <button
                        type="button"
                        class="v2-switch"
                        role="switch"
                        aria-checked={forceMaintenanceEnabled}
                        aria-label={tr('Enable force maintenance')}
                        title={forceMaintenanceEnabled ? tr('Disable force maintenance') : tr('Enable force maintenance')}
                        disabled={running}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void toggleForce();
                        }}
                    >
                        <span />
                    </button>
                </summary>
                {forceMaintenanceEnabled ? (
                    <div class="v2-status-body">
                        <div class="v2-actions">
                            <button type="button" disabled={maintenanceLoading || running} onClick={() => void onRefreshMaintenance()}>
                                {maintenanceLoading ? tr('Refreshing...') : tr('Refresh maintenance')}
                            </button>
                            <button type="button" disabled={upcoming.length === 0 || running} onClick={onSelectAllUpcoming}>
                                {tr('Select all upcoming')}
                            </button>
                        </div>
                        {maintenanceLoading && maintenanceServers.length === 0 ? (
                            <p class="v2-muted">{tr('Loading maintenance...')}</p>
                        ) : maintenanceServers.length === 0 ? (
                            <p class="v2-muted">{tr('No upcoming maintenance detected.')}</p>
                        ) : (
                            <div class="v2-maintenance-list">
                                {maintenanceServers.map((server) => (
                                    <div key={server.id} class="v2-maintenance-row">
                                        <input
                                            type="checkbox"
                                            checked={selectedMaintenanceIds.has(server.id)}
                                            disabled={server.active || running}
                                            onChange={() => onToggleMaintenanceServer(server.id)}
                                            aria-label={server.name}
                                        />
                                        <span class="v2-maintenance-name">{server.name}</span>
                                        <span class={`v2-tag ${server.active ? 'v2-tag-error' : 'v2-tag-warn'}`}>
                                            {maintenanceStatus(server, now, tr)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div class="v2-actions">
                            <button
                                type="button"
                                disabled={selectedUpcoming.length === 0 || running}
                                onClick={() => void onForceSelected()}
                            >
                                {forceRunning
                                    ? tr('Forcing maintenance...')
                                    : tr('Force selected ({count})', { count: selectedUpcoming.length })}
                            </button>
                            {forceRunning ? (
                                <button type="button" class="v2-danger" disabled={canceling} onClick={() => void onCancel()}>
                                    {canceling ? tr('Cancelling…') : tr('Cancel force maintenance')}
                                </button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </details>

            <div class="v2-valuable-actions">
                {searchRunning ? (
                    <button
                        type="button"
                        class="v2-danger"
                        disabled={canceling}
                        onClick={() => void onCancel()}
                    >
                        {canceling ? tr('Cancelling…') : tr('Cancel search')}
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={running}
                        onClick={() => void onSearch()}
                    >
                        {tr('Search all servers')}
                    </button>
                )}
                {sellRunning ? (
                    <button
                        type="button"
                        class="v2-danger"
                        disabled={canceling}
                        onClick={() => void onCancel()}
                    >
                        {canceling ? tr('Cancelling…') : tr('Cancel sale')}
                    </button>
                ) : (
                    <button
                        type="button"
                        disabled={running}
                        onClick={() => void onSell(sellOptions)}
                    >
                        {tr('Sell downloads')}
                    </button>
                )}
            </div>

        </AutomationCard>
    );
}
