import type { AutoFinishStatus, AutoJobsStatus, JobQueueProgress } from '../../../application/popup/portal.js';
import type { AutoJobsMarket } from '../../../contracts/auto-jobs.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { InfoTip } from '../../components/InfoTip.js';
import { RefreshButton } from '../../components/RefreshButton.js';
import { JobMarketList, type JobMarketView } from '../../components/JobMarketList.js';
import { formatAge, formatRemaining } from '../../format.js';
import { countCompletionRecords } from '../../app/view-models/job-report.js';
import { useT, type TranslateSource } from '../../i18n-context.js';

export interface AutoJobsReportRow {
    readonly marketKey: string;
    readonly label: string;
    readonly ok: boolean;
    readonly total: number;
    readonly success: number;
    readonly retry: number;
    readonly failed: number;
    readonly expired: number;
    readonly pending: number;
    readonly unknown?: number;
    readonly skipped?: number;
    readonly error?: string;
    readonly errorCode?: string;
}

function marketErrorLabel(code: string | undefined, hasError: string | undefined, tr: TranslateSource): string {
    switch (code) {
        case 'ROUTE_FAILED': return tr('Route failed');
        case 'MARKET_FETCH_FAILED': return tr('Market data fetch failed');
        case 'SNAPSHOT_FAILED': return tr('Network snapshot failed');
        default: return hasError ? tr('Data fetch failed') : tr('Market refresh failed');
    }
}

export interface AutoJobsCardProps {
    readonly autoJobs: AutoJobsStatus | null;
    readonly autoJobsBusy: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly toggleAutoJobs: () => void | Promise<void>;
    readonly jobStatusTone: (status: string) => string;
    readonly updatePanelOpen: (key: string, open: boolean) => void;
    readonly autoCompleteCountdown: number | null;
    readonly autoFinish: AutoFinishStatus | null;
    readonly autoFinishBusy: boolean;
    readonly autoFinishCanceling: boolean;
    readonly jobRunId: string | null;
    readonly toggleAutoFinish: () => void | Promise<void>;
    readonly autoCompleteOpen: boolean;
    readonly autoCompleteTypesSorted: readonly JobOffer['type'][];
    readonly autoCompleteTypes: readonly JobOffer['type'][];
    readonly toggleAutoCompleteType: (type: JobOffer['type']) => void | Promise<void>;
    readonly allAutoCompleteTypes: boolean;
    readonly toggleAllAutoCompleteTypes: () => void | Promise<void>;
    readonly autoDismissCountdown: number | null;
    readonly settings: SettingsV1 | null;
    readonly toggleAutoDismissFailed: () => void | Promise<void>;
    readonly jobMarketViews: readonly JobMarketView[];
    readonly marketKey: string;
    readonly now: number;
    readonly setMarketKey: (key: string) => void;
    readonly jobStatusById: Readonly<Record<string, string | undefined>>;
    readonly jobStatusReasonById: Readonly<Record<string, string | undefined>>;
    readonly selectedJobs: ReadonlySet<string>;
    readonly toggleJob: (marketKey: string, jobId: string) => void;
    readonly toggleSelectMarket: (jobs: readonly JobOffer[]) => void;
    readonly cancelAutoFinish: () => void | Promise<void>;
    readonly runAutoFinishNow: () => void | Promise<void>;
    readonly jobBusy: boolean;
    readonly syncJobs: (allMarkets: boolean) => void | Promise<void>;
    readonly currentMarketSelectedCount: number;
    readonly cancelJobQueue: () => void | Promise<void>;
    readonly runSelectedJobs: () => void | Promise<void>;
    readonly shownJobReport: readonly AutoJobsReportRow[];
    readonly jobStatus: string;
    readonly jobProgress: JobQueueProgress | null;
    readonly marketReport: readonly AutoJobsMarket[] | null;
}

export function AutoJobsCard(props: AutoJobsCardProps) {
    const {
    autoJobs,
    autoJobsBusy,
    panelOpen,
    toggleAutoJobs,
    jobStatusTone,
    updatePanelOpen,
    autoCompleteCountdown,
    autoFinish,
    autoFinishBusy,
    autoFinishCanceling,
    jobRunId,
    toggleAutoFinish,
    autoCompleteOpen,
    autoCompleteTypesSorted,
    autoCompleteTypes,
    toggleAutoCompleteType,
    allAutoCompleteTypes,
    toggleAllAutoCompleteTypes,
    autoDismissCountdown,
    settings,
    toggleAutoDismissFailed,
    jobMarketViews,
    marketKey,
    now,
    setMarketKey,
    jobStatusById,
    jobStatusReasonById,
    selectedJobs,
    toggleJob,
    toggleSelectMarket,
    cancelAutoFinish,
    runAutoFinishNow,
    jobBusy,
    syncJobs,
    currentMarketSelectedCount,
    cancelJobQueue,
    runSelectedJobs,
    shownJobReport,
    jobStatus,
    jobProgress,
    marketReport,
    } = props;
    const tr = useT();
    const syncRows: readonly AutoJobsReportRow[] = (marketReport ?? []).map((market) => ({
        marketKey: market.marketKey,
        label: market.label,
        ok: market.ok,
        total: 0,
        success: 0,
        retry: 0,
        failed: market.failed ?? 0,
        expired: 0,
        pending: 0,
        unknown: 0,
        ...(market.ok ? {} : { error: market.error }),
        ...(market.ok ? {} : (market.errorCode ? { errorCode: market.errorCode } : {})),
    }));
    const reportRows = shownJobReport.length > 0 ? shownJobReport : syncRows;
    return (
        <>
            <AutomationCard
                title={tr('Auto Jobs')}
                description={tr('Refresh all markets, then complete jobs manually or automatically.')}
                enabled={settings?.autoJobsEnabled ?? autoJobs?.enabled ?? false}
                expanded={panelOpen['auto-jobs'] ?? false}
                onOpenChange={(open) => updatePanelOpen('auto-jobs', open)}
                persistentSwitch
                busy={autoJobsBusy || (autoJobs?.running ?? false)}
                onEnable={() => void toggleAutoJobs()}
                onDisable={() => void toggleAutoJobs()}
            >
                <p class="v2-muted">
                    {tr('Next refresh')} {autoJobs?.nextRefreshAt != null && Number.isFinite(autoJobs.nextRefreshAt)
                        ? formatRemaining(new Date(autoJobs.nextRefreshAt).toISOString(), now)
                        : '--'}
                    {' · '}
                    {tr('Last sync')} {autoJobs?.lastRefreshAt != null ? formatAge(now - autoJobs.lastRefreshAt) : tr('Never')}
                </p>
                <div class="v2-auto-complete">
                    <div class="v2-auto-complete-header">
                        <span class="v2-auto-complete-title">
                            {tr('Auto complete all jobs')}
                            <InfoTip text={tr('This feature automatically handles the selected job types across all markets.')} />
                            {autoCompleteCountdown !== null ? <span class="v2-countdown">{tr('Starts in {seconds}s', { seconds: autoCompleteCountdown })}</span> : null}
                        </span>
                        <button
                            type="button"
                            class="v2-switch"
                            role="switch"
                            aria-checked={autoFinish?.enabled ?? false}
                            aria-label={tr('Auto complete all jobs')}
                            title={autoFinish?.enabled ? tr('Disable auto complete') : tr('Enable auto complete')}
                            disabled={autoFinishBusy || jobRunId !== null}
                            onClick={() => void toggleAutoFinish()}
                        >
                            <span />
                        </button>
                        <button
                            type="button"
                            class="v2-collapse-button"
                            aria-expanded={autoCompleteOpen}
                            aria-label={autoCompleteOpen ? tr('Collapse auto complete options') : tr('Expand auto complete options')}
                            onClick={() => updatePanelOpen('auto-complete', !autoCompleteOpen)}
                        >
                            <span>{autoCompleteOpen ? '▲' : '▼'}</span>
                        </button>
                    </div>
                    {autoCompleteOpen ? (
                        <div class="v2-auto-complete-body">
                            {autoCompleteTypesSorted.map((type) => (
                                <label key={type}>
                                    <input
                                        type="checkbox"
                                        checked={autoCompleteTypes.includes(type)}
                                        onChange={() => void toggleAutoCompleteType(type)}
                                    />
                                    {type}
                                </label>
                            ))}
                            <label class="v2-auto-complete-selectall">
                                <input
                                    type="checkbox"
                                    checked={allAutoCompleteTypes}
                                    onChange={() => void toggleAllAutoCompleteTypes()}
                                />
                                {tr('Select all')}
                            </label>
                        </div>
                    ) : null}
                </div>

                <div class="v2-automation-mode">
                    <span class="v2-auto-complete-title">
                        {tr('Auto submit failed / expired jobs')}
                        <InfoTip text={tr('Submitting a failed or expired job applies its reputation penalty, if any.')} />
                        {autoDismissCountdown !== null ? <span class="v2-countdown">{tr('Starts in {seconds}s', { seconds: autoDismissCountdown })}</span> : null}
                    </span>
                    <button
                        type="button"
                        class="v2-switch"
                        role="switch"
                        aria-checked={settings?.autoDismissFailedJobsEnabled ?? false}
                        aria-label={tr('Auto submit failed / expired jobs')}
                        title={settings?.autoDismissFailedJobsEnabled ? tr('Disable auto submit') : tr('Enable auto submit')}
                        onClick={() => void toggleAutoDismissFailed()}
                    >
                        <span />
                    </button>
                </div>

                <section class="v2-job-section">
                    <JobMarketList
                        markets={jobMarketViews}
                        activeKey={marketKey}
                        now={now}
                        onSelect={setMarketKey}
                        statusById={jobStatusById}
                        statusReasonById={jobStatusReasonById}
                        selectable={!autoFinish?.enabled}
                        selectionDisabled={jobRunId !== null}
                        selectedIds={selectedJobs}
                        onToggleJob={toggleJob}
                        onToggleMarket={toggleSelectMarket}
                        emptyText={tr('No jobs loaded yet. Waiting for the live market snapshot.')}
                    />
                    <div class="v2-actions v2-job-actions">
                        {autoFinish?.enabled ? (
                            autoFinish.running ? (
                                <button type="button" class="v2-danger" disabled={autoFinishCanceling} onClick={() => void cancelAutoFinish()}>
                                    {autoFinishCanceling ? tr('Canceling...') : tr('Cancel')}
                                </button>
                            ) : (
                                <button type="button" disabled={autoFinishBusy} onClick={() => void runAutoFinishNow()}>
                                    {autoFinishBusy ? tr('Starting...') : tr('Force run now')}
                                </button>
                            )
                        ) : (
                            <>
                                <RefreshButton label={tr('Refresh all jobs')} disabled={jobBusy || jobRunId !== null} onClick={() => syncJobs(true)} />
                                {jobRunId !== null ? (
                                    <button type="button" class="v2-danger" onClick={() => void cancelJobQueue()}>{tr('Cancel')}</button>
                                ) : (
                                    <button type="button" disabled={jobBusy || currentMarketSelectedCount === 0} onClick={() => void runSelectedJobs()}>
                                        {tr('Start selected ({count})', { count: currentMarketSelectedCount })}
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                    {autoFinish?.enabled ? (
                        <>
                            <p class="v2-muted">
                                {tr('Status:')} <strong>{autoFinishBusy || autoFinish.running ? tr('running') : tr('scheduled')}</strong>
                                {autoFinish.last ? ` · ${tr('last {time}', { time: new Date(autoFinish.last.finishedAt).toLocaleTimeString() })}` : ''}
                            </p>
                            {autoFinish.progress ? (
                                <p class="v2-muted">
                                    {autoFinish.progress.jobName}{autoFinish.progress.serverName ? ` @ ${autoFinish.progress.serverName}` : ''} ({autoFinish.progress.index}/{autoFinish.progress.total})
                                </p>
                            ) : null}
                            {autoFinish.nextRetryAt !== null ? (
                                <p class="v2-muted">
                                    {tr('Retry in {time}', { time: formatRemaining(new Date(autoFinish.nextRetryAt).toISOString(), now) })}
                                    {autoFinish.retryReason ? ` · ${autoFinish.retryReason}` : ''}
                                </p>
                            ) : null}
                        </>
                    ) : null}
                </section>

                <details class="v2-debug-console v2-status-console" open>
                    <summary class="v2-status-toggle">
                        <span class="v2-status-title">{tr('Status and report')}</span>
                    </summary>
                    <div class="v2-status-body">
                    <p class={`v2-muted ${jobStatusTone(jobStatus)}`}>{tr(jobStatus)}</p>
                    {autoJobs && (Object.keys(autoJobs.locks).length > 0 || Object.keys(autoJobs.retryAttempts).length > 0 || autoFinish?.completionStateStatus === 'unavailable' || Object.values(autoFinish?.completedJobsByMarket.byMarket ?? {}).some((jobs) => Object.keys(jobs).length > 0) || Object.keys(autoFinish?.legacyCompletedJobs ?? {}).length > 0) ? (
                        <p class="v2-muted">
                            {autoFinish?.completionStateStatus === 'unavailable'
                                ? tr('Completion state unavailable')
                                : tr('Locks: {locks} · retry budgets: {retry} · completed: {completed} · legacy unknown: {legacy}', {
                                    locks: Object.keys(autoJobs.locks).length,
                                    retry: Object.keys(autoJobs.retryAttempts).length,
                                    completed: countCompletionRecords(autoFinish?.completedJobsByMarket ?? { byMarket: {} }, autoFinish?.legacyCompletedJobs ?? {}).marketScoped,
                                    legacy: countCompletionRecords(autoFinish?.completedJobsByMarket ?? { byMarket: {} }, autoFinish?.legacyCompletedJobs ?? {}).legacyUnknown,
                                })}
                        </p>
                    ) : null}
                    {jobProgress ? (
                        <p class="v2-muted v2-job-current">
                            {tr('Current: {job}{server} ({index}/{total})', {
                                job: jobProgress.jobName,
                                server: jobProgress.serverName ? ` @ ${jobProgress.serverName}` : '',
                                index: jobProgress.index,
                                total: jobProgress.total,
                            })}
                        </p>
                    ) : null}
                    {reportRows.length > 0 ? (
                        <ul class="v2-job-report">
                            {reportRows.map((market) => market.ok ? (
                                <li key={market.marketKey}>
                                    <span class="v2-item-name">{market.label}</span>
                                    <span class="v2-tag v2-tag-ok">{tr('{count} success', { count: market.success })}</span>
                                    {market.retry > 0 ? <span class="v2-tag v2-tag-warn">{tr('{count} retry', { count: market.retry })}</span> : null}
                                    {(market.unknown ?? 0) > 0 ? <span class="v2-tag v2-tag-warn">{tr('{count} unknown', { count: market.unknown ?? 0 })}</span> : null}
                                    <span class="v2-tag v2-tag-warn">{tr('{count} pending', { count: market.pending })}</span>
                                    {(market.skipped ?? 0) > 0 ? <span class="v2-tag">{tr('{count} skipped', { count: market.skipped ?? 0 })}</span> : null}
                                    {market.expired > 0 ? <span class="v2-tag v2-tag-warn">{tr('{count} expired', { count: market.expired })}</span> : null}
                                    <span class={`v2-tag ${market.failed > 0 ? 'v2-tag-error' : ''}`}>{tr('{count} failed', { count: market.failed })}</span>
                                    <span class="v2-muted">{tr('{count} total', { count: market.total })}</span>
                                </li>
                            ) : (
                                <li key={market.marketKey}>
                                    <span class="v2-item-name">{market.label}</span>
                                    <span class="v2-tag v2-tag-error">{tr('failed')}</span>
                                    <span class="v2-muted">{marketErrorLabel(market.errorCode, market.error, tr)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p class="v2-muted">{tr('No job report yet.')}</p>}
                    </div>
                </details>
            </AutomationCard>        </>
    );
}
