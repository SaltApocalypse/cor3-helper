import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import type { SpecialistState } from '../../domains/specialists/model.js';
import type { ActivityState, JobHistoryEntry, NetworkDiagnostics } from '../../application/popup/portal.js';
import { formatRemaining } from '../format.js';
import { GameSection } from '../components/GameSection.js';
import { InfoPanel } from '../components/InfoPanel.js';
import { MARKET_SYMBOL } from '../market-icons.js';
import type { JobMarketView } from '../components/JobMarketList.js';
import { useT, type TranslateSource } from '../i18n-context.js';

function activityDetail(detail: string | undefined, tr: TranslateSource): string {
    if (!detail) return tr('No automation is running');
    const match = detail.match(/^Fetching market information \((\d+)\/(\d+)\)$/);
    if (match) return tr('Fetching market information ({index}/{total})', { index: match[1] ?? '', total: match[2] ?? '' });
    return tr(detail);
}

export interface OverviewPageProps {
    readonly jobHistory: readonly JobHistoryEntry[];
    readonly markets: readonly JobMarketView[];
    readonly statusById: Readonly<Record<string, string | undefined>>;
    readonly now: number;
    readonly autoJobsRunning: boolean;
    readonly autoJobsStage: string;
    readonly hasSnapshot: boolean;
    readonly nextMarketRefreshAt: number | null;
    readonly marketRefreshReason: 'interval' | 'reset' | 'fallback' | null;
    readonly activity: ActivityState | null;
    readonly credits: number | null;
    readonly daily: DailyOpsState | null;
    readonly specialists: SpecialistState | null;
    readonly networkDiag: NetworkDiagnostics | null;
    readonly hasTimerData: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
}

export function OverviewPage({
    jobHistory,
    markets,
    statusById,
    now,
    autoJobsRunning,
    autoJobsStage,
    hasSnapshot,
    nextMarketRefreshAt,
    marketRefreshReason,
    activity,
    credits,
    daily,
    specialists,
    networkDiag,
    hasTimerData,
    panelOpen,
    onPanelOpenChange,
}: OverviewPageProps) {
    const tr = useT();
    const activityProgress = activity?.progress ?? null;
    return (
        <>
            <section class="v2-card v2-overview-card v2-activity-panel">
                <h2 class="v2-activity-title">{tr('Extension Status')}</h2>
                <div class="v2-activity-head">
                    <span class={`v2-activity-dot ${activity?.running ? 'active' : ''}`} />
                    <span class="v2-activity-label">{tr(activity?.label ?? 'Idle')}</span>
                </div>
                <p class="v2-activity-detail">{activityDetail(activity?.detail, tr)}</p>
                {activityProgress ? (
                    <div class="v2-activity-progress">
                        <div class="v2-activity-progress-bar">
                            <div
                                class="v2-activity-progress-fill"
                                style={{ width: `${Math.min(100, (activityProgress.index / Math.max(1, activityProgress.total)) * 100)}%` }}
                            />
                        </div>
                        <span class="v2-muted">{activityProgress.index}/{activityProgress.total} {activityProgress.label}</span>
                    </div>
                ) : null}
            </section>

            <GameSection
                title={tr('Recent jobs')}
                description={tr('Persisted automation job history.')}
                className="v2-overview-card"
                expanded={panelOpen['overview.job-history'] ?? panelOpen['progress.job-history'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('overview.job-history', open)}
            >
                {jobHistory.length === 0 ? <p class="v2-muted">{tr('No job history yet.')}</p> : (
                    <ul class="v2-job-report v2-job-history-list">
                        {jobHistory.slice(-30).reverse().map((entry, index) => (
                            <li key={`${entry.jobId}-${entry.at}-${index}`}>
                                <span class="v2-item-name">{entry.name}</span>
                                <span class={`v2-tag ${entry.status === 'done' ? 'v2-tag-ok' : entry.status === 'retry' ? 'v2-tag-warn' : 'v2-tag-error'}`}>{tr(entry.status)}</span>
                                <span class="v2-muted">{new Date(entry.at).toLocaleString()}{entry.error ? ` · ${entry.error}` : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </GameSection>

            <section class="v2-card v2-overview-card v2-credits-panel">
                <span class="v2-credits-label">{tr('Credits')}</span>
                <span class="v2-credits-value">
                    <span class="v2-credits-badge">CR</span>
                    <strong class="v2-credits-amount">{credits !== null ? credits.toLocaleString() : '--'}</strong>
                </span>
            </section>

            <section class="v2-card v2-overview-card">
                <div class="v2-card-header">
                    <h2>{tr('Market jobs')}</h2>
                    <span class={`v2-muted ${autoJobsRunning ? 'v2-text-warn' : hasSnapshot ? 'v2-text-ok' : ''}`}>
                        {autoJobsRunning
                            ? (autoJobsStage === 'idle' ? tr('Syncing...') : tr('Syncing · {stage}', { stage: autoJobsStage }))
                            : hasSnapshot ? tr('Synced') : tr('Waiting...')}
                    </span>
                </div>
                <div class="v2-market-refresh-line">
                    <span class="v2-muted">
                        {marketRefreshReason === 'reset'
                            ? tr('Waiting for market reset')
                            : marketRefreshReason === 'fallback'
                                ? tr('All markets complete · fallback refresh')
                                : tr('Next market refresh')}
                    </span>
                    <span class="v2-muted">
                        {nextMarketRefreshAt !== null
                            ? formatRemaining(new Date(nextMarketRefreshAt).toISOString(), now)
                            : '--'}
                    </span>
                </div>
                <div class="v2-market-summary-grid">
                    {markets.map((entry) => {
                        const failed = entry.failed + entry.jobs.filter((job) => statusById[job.id] === 'failed').length;
                        return (
                            <article key={entry.market.key} class="v2-market-summary-card">
                                <div class="v2-market-summary-head">
                                    <div class="v2-market-summary-title">
                                        <span class="v2-market-summary-symbol">{MARKET_SYMBOL[entry.market.key] ?? '◈'}</span>
                                        <strong>{entry.market.label}</strong>
                                    </div>
                                    <span>{entry.resetAt ? formatRemaining(entry.resetAt, now) : '--'}</span>
                                </div>
                                <div class="v2-market-summary-stats">
                                    <span>{tr('{count} jobs', { count: entry.jobs.length })}</span>
                                    <span>{tr('{count} skipped', { count: entry.skipped })}</span>
                                    <span class={failed > 0 ? 'v2-text-error' : ''}>{tr('{count} failed', { count: failed })}</span>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>

            {hasTimerData ? (
                <section class="v2-card v2-overview-card">
                    <h2>{tr('Timers')}</h2>
                    {daily?.nextTaskTime ? (
                        <InfoPanel title={tr('Next daily task')} meta={formatRemaining(daily.nextTaskTime, now)}>
                            <p class="v2-muted">{tr('Scheduled at {date}', { date: new Date(daily.nextTaskTime).toLocaleString() })}</p>
                        </InfoPanel>
                    ) : null}
                    {specialists?.expansions[0]?.expiresAt ? (
                        <InfoPanel title={tr('Stash expansion')} meta={formatRemaining(specialists.expansions[0].expiresAt, now)}>
                            <p class="v2-muted">
                                {tr('+{slots} slots · {status} · ends {date}', {
                                    slots: specialists.expansions[0].bonusSlots,
                                    status: specialists.expansions[0].status,
                                    date: new Date(specialists.expansions[0].expiresAt).toLocaleString(),
                                })}
                            </p>
                        </InfoPanel>
                    ) : null}
                    {networkDiag?.maintenance.map((maintenance) => maintenance.endsAt ? (
                        <InfoPanel key={`maintenance-${maintenance.id}`} title={tr('Maintenance · {name}', { name: maintenance.name })} meta={formatRemaining(maintenance.endsAt, now)}>
                            <p class="v2-muted">{tr('Ends at {date}', { date: new Date(maintenance.endsAt).toLocaleString() })}</p>
                        </InfoPanel>
                    ) : null)}
                </section>
            ) : null}
        </>
    );
}
