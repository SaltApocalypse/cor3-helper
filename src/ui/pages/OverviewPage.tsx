import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import type { SpecialistState } from '../../domains/specialists/model.js';
import type {
    ActivityState,
    JobHistoryEntry,
    NetworkDiagnostics,
    OverviewState,
} from '../../application/popup/portal.js';
import { formatRemaining } from '../format.js';
import { ExtensionStatusCard } from '../components/ExtensionStatusCard.js';
import { GameSection } from '../components/GameSection.js';
import { InfoPanel } from '../components/InfoPanel.js';
import { PanelCard } from '../components/PanelCard.js';
import { SortablePanelGroup, type SortablePanelItem } from '../components/SortablePanelGroup.js';
import { MARKET_SYMBOL } from '../market-icons.js';
import type { JobMarketView } from '../components/JobMarketList.js';
import { jobIdentityKey } from '../../contracts/jobs.js';
import { useT } from '../i18n-context.js';

export interface OverviewPageProps {
    readonly jobHistory: readonly JobHistoryEntry[];
    readonly markets: readonly JobMarketView[];
    readonly statusById: Readonly<Record<string, string | undefined>>;
    readonly now: number;
    readonly autoJobsRunning: boolean;
    readonly autoJobsStage: string;
    readonly autoJobsEnabled: boolean;
    readonly hasSnapshot: boolean;
    readonly nextMarketRefreshAt: number | null;
    readonly marketRefreshReason: 'interval' | 'reset' | 'fallback' | null;
    readonly activity: ActivityState | null;
    readonly overview: OverviewState | null;
    readonly credits: number | null;
    readonly daily: DailyOpsState | null;
    readonly specialists: SpecialistState | null;
    readonly networkDiag: NetworkDiagnostics | null;
    readonly hasTimerData: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
    readonly panelOrder: Readonly<Record<string, readonly string[]>>;
    readonly onReorderPanels: (pageKey: string, ids: readonly string[]) => void;
}

export function OverviewPage({
    jobHistory,
    markets,
    statusById,
    now,
    autoJobsRunning,
    autoJobsStage,
    autoJobsEnabled,
    hasSnapshot,
    nextMarketRefreshAt,
    marketRefreshReason,
    activity,
    overview,
    credits,
    daily,
    specialists,
    networkDiag,
    hasTimerData,
    panelOpen,
    onPanelOpenChange,
    panelOrder,
    onReorderPanels,
}: OverviewPageProps) {
    const tr = useT();
    const extensionStatusExpanded = panelOpen['overview.extension-status.more'] ?? false;
    const panels: SortablePanelItem[] = [
        {
            id: 'overview.extension-status',
            node: (
                <ExtensionStatusCard
                    activity={activity}
                    overview={overview}
                    now={now}
                    expanded={extensionStatusExpanded}
                    onToggleExpanded={() =>
                        onPanelOpenChange('overview.extension-status.more', !extensionStatusExpanded)
                    }
                />
            ),
        },
        {
            id: 'overview.job-history',
            node: (
                <GameSection
                    title={tr('Recent jobs')}
                    description={tr('Persisted automation job history.')}
                    className="v2-overview-card"
                    expanded={panelOpen['overview.job-history'] ?? panelOpen['progress.job-history'] ?? true}
                    onOpenChange={(open) => onPanelOpenChange('overview.job-history', open)}
                >
                    {jobHistory.length === 0 ? (
                        <p class="v2-muted">{tr('No job history yet.')}</p>
                    ) : (
                        <ul class="v2-job-report v2-job-history-list">
                            {jobHistory
                                .slice(-30)
                                .reverse()
                                .map((entry, index) => (
                                    <li key={`${entry.jobId}-${entry.at}-${index}`}>
                                        <span class="v2-item-name">{entry.name}</span>
                                        <span
                                            class={`v2-tag ${entry.status === 'done' ? 'v2-tag-ok' : entry.status === 'retry' ? 'v2-tag-warn' : 'v2-tag-error'}`}
                                        >
                                            {tr(entry.status)}
                                        </span>
                                        <span class="v2-muted">
                                            {new Date(entry.at).toLocaleString()}
                                            {entry.error ? ` · ${entry.error}` : ''}
                                        </span>
                                    </li>
                                ))}
                        </ul>
                    )}
                </GameSection>
            ),
        },
        {
            id: 'overview.credits',
            node: (
                <PanelCard title={tr('Credits')} className="v2-overview-card v2-credits-panel" collapsible={false}>
                    <span class="v2-credits-value">
                        <span class="v2-credits-badge">CR</span>
                        <strong class="v2-credits-amount">{credits !== null ? credits.toLocaleString() : '--'}</strong>
                    </span>
                </PanelCard>
            ),
        },
    ];

    if (autoJobsEnabled) {
        panels.push({
            id: 'overview.market-jobs',
            node: (
                <PanelCard
                    title={tr('Market jobs')}
                    className="v2-overview-card"
                    headerClassName="v2-card-header"
                    badge={
                        <span class={`v2-muted ${autoJobsRunning ? 'v2-text-warn' : hasSnapshot ? 'v2-text-ok' : ''}`}>
                            {autoJobsRunning
                                ? autoJobsStage === 'idle'
                                    ? tr('Syncing...')
                                    : tr('Syncing · {stage}', { stage: autoJobsStage })
                                : hasSnapshot
                                  ? tr('Synced')
                                  : tr('Waiting...')}
                        </span>
                    }
                    collapsible={false}
                >
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
                            const failed =
                                entry.failed +
                                entry.jobs.filter(
                                    (job) => statusById[jobIdentityKey(entry.market.key, job.id)] === 'failed',
                                ).length;
                            return (
                                <article key={entry.market.key} class="v2-market-summary-card">
                                    <div class="v2-market-summary-head">
                                        <div class="v2-market-summary-title">
                                            <span class="v2-market-summary-symbol">
                                                {MARKET_SYMBOL[entry.market.key] ?? '◈'}
                                            </span>
                                            <strong>{entry.market.label}</strong>
                                        </div>
                                        <span>{entry.resetAt ? formatRemaining(entry.resetAt, now) : '--'}</span>
                                    </div>
                                    <div class="v2-market-summary-stats">
                                        <span>{tr('{count} jobs', { count: entry.jobs.length })}</span>
                                        <span>{tr('{count} skipped', { count: entry.skipped })}</span>
                                        <span class={failed > 0 ? 'v2-text-error' : ''}>
                                            {tr('{count} failed', { count: failed })}
                                        </span>
                                        {entry.stale ? <span class="v2-tag v2-tag-warn">{tr('stale')}</span> : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </PanelCard>
            ),
        });
    }

    if (hasTimerData) {
        panels.push({
            id: 'overview.timers',
            node: (
                <PanelCard title={tr('Timers')} className="v2-overview-card" collapsible={false}>
                    {daily?.nextTaskTime ? (
                        <InfoPanel title={tr('Next daily task')} meta={formatRemaining(daily.nextTaskTime, now)}>
                            <p class="v2-muted">
                                {tr('Scheduled at {date}', { date: new Date(daily.nextTaskTime).toLocaleString() })}
                            </p>
                        </InfoPanel>
                    ) : null}
                    {specialists?.expansions[0]?.expiresAt ? (
                        <InfoPanel
                            title={tr('Stash expansion')}
                            meta={formatRemaining(specialists.expansions[0].expiresAt, now)}
                        >
                            <p class="v2-muted">
                                {tr('+{slots} slots · {status} · ends {date}', {
                                    slots: specialists.expansions[0].bonusSlots,
                                    status: specialists.expansions[0].status,
                                    date: new Date(specialists.expansions[0].expiresAt).toLocaleString(),
                                })}
                            </p>
                        </InfoPanel>
                    ) : null}
                    {networkDiag?.maintenance.map((maintenance) =>
                        maintenance.endsAt ? (
                            <InfoPanel
                                key={`maintenance-${maintenance.id}`}
                                title={tr('Maintenance · {name}', { name: maintenance.name })}
                                meta={formatRemaining(maintenance.endsAt, now)}
                            >
                                <p class="v2-muted">
                                    {tr('Ends at {date}', { date: new Date(maintenance.endsAt).toLocaleString() })}
                                </p>
                            </InfoPanel>
                        ) : null,
                    )}
                </PanelCard>
            ),
        });
    }

    return (
        <SortablePanelGroup
            pageKey="overview"
            items={panels}
            order={panelOrder.overview}
            onReorder={(ids) => onReorderPanels('overview', ids)}
        />
    );
}
