import type { ValuableProgress, ValuableReport, ValuableRunState } from '../../../application/popup/portal.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { useT, type TranslateSource } from '../../i18n-context.js';

export interface ValuableSellerCardProps {
    readonly runId: string | null;
    readonly operation: 'search' | 'sell' | null;
    readonly status: string;
    readonly progress: ValuableProgress | null;
    readonly report: ValuableReport | null;
    readonly canceling: boolean;
    readonly onSearch: () => void | Promise<void>;
    readonly onSell: () => void | Promise<void>;
    readonly onCancel: () => void | Promise<void>;
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
    }
}

function formatReportTime(value: number | null, tr: TranslateSource): string {
    if (value === null) return tr('never');
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function defaultStatus(report: ValuableReport | null, operation: ValuableRunState['operation'] | null, tr: TranslateSource): string {
    if (operation === 'search') return tr('Searching all servers...');
    if (operation === 'sell') return tr('Selling downloaded valuables...');
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

export function ValuableSellerCard({
    runId,
    operation,
    status,
    progress,
    report,
    canceling,
    onSearch,
    onSell,
    onCancel,
    expanded,
    onOpenChange,
}: ValuableSellerCardProps) {
    const tr = useT();
    const running = runId !== null;
    const searchRunning = running && operation === 'search';
    const sellRunning = running && operation === 'sell';

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
                    </ul>
                </div>
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
                        onClick={() => void onSell()}
                    >
                        {tr('Sell downloads')}
                    </button>
                )}
            </div>

        </AutomationCard>
    );
}
