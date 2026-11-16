import type { ActivityState, OverviewState } from '../../application/popup/portal.js';
import type { GameReadiness } from '../../application/game/readiness.js';
import { isGameReady } from '../../application/game/readiness.js';
import { formatRemaining } from '../format.js';
import { useT, type TranslateSource } from '../i18n-context.js';
import {
    automationTone,
    extensionHealth,
    recentAutomationError,
    type ExtensionHealth,
    type StatusTone,
} from '../app/view-models/extension-status.js';

export interface ExtensionStatusCardProps {
    readonly activity: ActivityState | null;
    readonly overview: OverviewState | null;
    readonly now: number;
    readonly expanded: boolean;
    readonly onToggleExpanded: () => void;
}

function activityDetail(detail: string | undefined, tr: TranslateSource): string {
    if (!detail) return tr('No automation is running');
    const market = detail.match(/^Fetching market information \((\d+)\/(\d+)\)$/);
    if (market) return tr('Fetching market information ({index}/{total})', { index: market[1] ?? '', total: market[2] ?? '' });
    const completing = detail.match(/^Completing (.+) \((\d+)\/(\d+)\)$/);
    if (completing) return tr('Completing {job} ({index}/{total})', {
        job: completing[1] ?? '',
        index: completing[2] ?? '',
        total: completing[3] ?? '',
    });
    return tr(detail);
}

function formatAge(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '--';
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
}

function healthLabel(health: ExtensionHealth, tr: TranslateSource): string {
    switch (health) {
        case 'ok': return tr('Healthy');
        case 'warn': return tr('Attention');
        case 'error': return tr('Error');
        default: return tr('Idle');
    }
}

function errorSummary(message: string, tr: TranslateSource): string {
    if (/loadout|no plan|no software/i.test(message)) return tr('Loadout unavailable');
    if (/route|path|direct:/i.test(message)) return tr('Route failed');
    if (/websocket|socket|no game websocket/i.test(message)) return tr('Game WebSocket unavailable');
    if (/timeout|timed out/i.test(message)) return tr('Timeout');
    return tr('Data fetch failed');
}

function automationStatus(running: boolean, enabled: boolean, waiting: boolean, tone: StatusTone, tr: TranslateSource): string {
    if (tone === 'error') return tr('Error');
    if (waiting) return tr('Loading...');
    if (running) return tr('Running');
    return enabled ? tr('Enabled') : tr('Off');
}

function rowTone(condition: 'ok' | 'warn' | 'error' | 'muted'): string {
    return condition === 'ok' ? 'v2-text-ok' : condition === 'warn' ? 'v2-text-warn' : condition === 'error' ? 'v2-text-error' : 'v2-muted';
}

export function ExtensionStatusCard({
    activity,
    overview,
    now,
    expanded,
    onToggleExpanded,
}: ExtensionStatusCardProps) {
    const tr = useT();
    const health = extensionHealth({ overview, activity, now });
    const progress = activity?.progress ?? null;
    const recentError = recentAutomationError(overview, now);
    const readyEntry: { readonly tabId: number; readonly readiness: GameReadiness } | null =
        overview?.readiness.find((entry) => isGameReady(entry.readiness)) ?? overview?.readiness[0] ?? null;
    const gameReady = readyEntry !== null && isGameReady(readyEntry.readiness);

    const sessionTone: 'ok' | 'warn' | 'error' | 'muted' = !overview
        ? 'muted'
        : overview.auth.authenticated ? 'ok' : overview.auth.source === 'none' ? 'error' : 'warn';
    const sessionValue = !overview
        ? tr('Loading...')
        : overview.auth.authenticated ? tr('Connected') : overview.auth.source === 'none' ? tr('No session') : tr('Needs refresh');

    const gameTone: 'ok' | 'warn' | 'error' | 'muted' = !readyEntry ? 'warn' : gameReady ? 'ok' : 'warn';
    const gameValue = !readyEntry
        ? tr('No game tab')
        : gameReady ? tr('Ready') : readyEntry.readiness.socketOpen ? tr('Socket open') : tr('Not ready');
    const gameFlags = readyEntry
        ? [
            readyEntry.readiness.socketOpen ? tr('Socket') : null,
            readyEntry.readiness.mapLoaded ? tr('Map') : null,
            readyEntry.readiness.marketLoaded ? tr('Market') : null,
            readyEntry.readiness.loadoutLoaded ? tr('Loadout') : null,
        ].filter((value): value is string => value !== null).join(' · ')
        : '';

    const networkTone: 'ok' | 'warn' | 'error' | 'muted' = !overview?.network
        ? 'muted'
        : overview.networkAgeMs !== null && overview.networkAgeMs > 5 * 60_000 ? 'warn' : 'ok';
    const networkValue = overview?.network
        ? `${overview.network.endpoint ?? '--'} · ${tr('{count} servers', { count: overview.network.serverCount })} · ${formatAge(overview.networkAgeMs)}`
        : '--';

    const queueWaiting = overview?.queue.waiting.length ?? 0;
    const queueTone: 'ok' | 'warn' | 'error' | 'muted' = !overview
        ? 'muted'
        : queueWaiting > 0 ? 'warn' : overview.queue.running ? 'ok' : 'muted';
    const queueValue = !overview
        ? '--'
        : `${overview.queue.running ? tr('Running') : tr('Idle')}${queueWaiting > 0 ? ` · ${tr('{count} waiting', { count: queueWaiting })}` : ''}`;

    const autoJobs = overview?.automations.find((entry) => entry.key === 'auto-jobs') ?? null;
    const autoJobsTone: 'ok' | 'warn' | 'error' | 'muted' = !autoJobs
        ? 'muted'
        : autoJobs.enabled ? (recentError?.automation.key === 'auto-jobs' ? 'error' : 'ok') : 'muted';
    const autoJobsValue = !overview
        ? '--'
        : !autoJobs?.enabled
            ? tr('Off')
            : `${tr('Next refresh')} ${overview.autoJobs.nextRefreshAt !== null ? formatRemaining(new Date(overview.autoJobs.nextRefreshAt).toISOString(), now) : '--'} · ${tr('Last sync')} ${overview.autoJobs.lastRefreshAt !== null ? formatAge(now - overview.autoJobs.lastRefreshAt) : tr('Never')}`;

    return (
        <section class="v2-card v2-overview-card v2-activity-panel v2-extension-status">
            <div class="v2-extension-status-head">
                <h2 class="v2-activity-title">{tr('Extension Status')}</h2>
                <span class={`v2-status-badge is-${overview ? health : 'idle'}`}>
                    {overview ? healthLabel(health, tr) : tr('Loading...')}
                </span>
                <button
                    type="button"
                    class="v2-collapse-button"
                    aria-expanded={expanded}
                    aria-label={expanded ? tr('Hide details') : tr('Show details')}
                    title={expanded ? tr('Hide details') : tr('Show details')}
                    onClick={onToggleExpanded}
                >
                    <span>{expanded ? '▲' : '▼'}</span>
                </button>
            </div>
            <div class="v2-activity-head">
                <span class={`v2-activity-dot ${activity?.running ? 'active' : ''}`} />
                <span class="v2-activity-label">{tr(activity?.label ?? 'Idle')}</span>
            </div>
            <p class="v2-activity-detail">
                {activity?.key === 'network' ? tr('Network operation') : activityDetail(activity?.detail, tr)}
            </p>
            {progress ? (
                <div class="v2-activity-progress">
                    <div class="v2-activity-progress-bar">
                        <div
                            class="v2-activity-progress-fill"
                            style={{ width: `${Math.min(100, (progress.index / Math.max(1, progress.total)) * 100)}%` }}
                        />
                    </div>
                    <span class="v2-muted">{progress.index}/{progress.total} {progress.label}</span>
                </div>
            ) : null}

            {expanded ? (
                overview ? (
                    <div class="v2-extension-status-details">
                        <div class="v2-status-grid">
                            <div class="v2-status-row">
                                <span>{tr('Session')}</span>
                                <strong class={rowTone(sessionTone)}>{sessionValue}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Game tab')}</span>
                                <strong class={rowTone(gameTone)}>{gameValue}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Game data')}</span>
                                <strong class={rowTone(gameReady ? 'ok' : 'warn')}>{gameFlags || tr('Not ready')}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Network')}</span>
                                <strong class={rowTone(networkTone)}>{networkValue}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Queue')}</span>
                                <strong class={rowTone(queueTone)}>{queueValue}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Helper Mode')}</span>
                                <strong class={overview.helperMode ? 'v2-text-warn' : 'v2-muted'}>{overview.helperMode ? tr('On') : tr('Off')}</strong>
                            </div>
                            <div class="v2-status-row">
                                <span>{tr('Auto Jobs')}</span>
                                <strong class={rowTone(autoJobsTone)}>{autoJobsValue}</strong>
                            </div>
                        </div>

                        <div class="v2-status-automations">
                            <span class="v2-status-section-title">{tr('Automations')}</span>
                            <div class="v2-status-chips">
                                {overview.automations.map((entry) => {
                                    const tone = automationTone(entry, now);
                                    return (
                                        <span key={entry.key} class={`v2-status-chip is-${tone}`} title={tr(entry.label)}>
                                            <span class="v2-status-dot" />
                                            <span>{tr(entry.label)}</span>
                                            <span class="v2-status-chip-state">{automationStatus(entry.running, entry.enabled, entry.waiting === true, tone, tr)}</span>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div class="v2-status-last-error">
                            {recentError ? (
                                <>
                                    <span class="v2-muted">{tr('Last error')}: {tr(recentError.automation.label)} · {formatAge(recentError.ageMs)}</span>
                                    <strong class="v2-text-error">{errorSummary(recentError.automation.lastError ?? '', tr)}</strong>
                                </>
                            ) : (
                                <span class="v2-muted">{tr('No recent errors')}</span>
                            )}
                        </div>
                    </div>
                ) : (
                    <p class="v2-muted">{tr('Status data is not loaded yet.')}</p>
                )
            ) : null}
        </section>
    );
}
