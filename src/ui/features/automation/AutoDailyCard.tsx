import type { AutoDailyStatus } from '../../../application/popup/portal.js';
import type { DailyOpsState } from '../../../domains/daily-ops/model.js';
import { formatRemaining } from '../../format.js';
import { AutomationCard } from '../../components/AutomationCard.js';
import { useT, type TranslateSource } from '../../i18n-context.js';

function nextRunReasonLabel(reason: string, tr: TranslateSource): string {
    switch (reason) {
        case 'state-unavailable': return tr('State unavailable');
        case 'unclaimed': return tr('Unclaimed reward');
        case 'next-task': return tr('Next task');
        case 'unknown-reset': return tr('Unknown reset');
        default: return tr(reason);
    }
}

export interface AutoDailyCardProps {
    readonly status: AutoDailyStatus | null;
    readonly enabled: boolean;
    readonly daily: DailyOpsState | null;
    readonly now: number;
    readonly busy: boolean;
    readonly expanded: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onToggle: () => void | Promise<void>;
    readonly onRun: () => void | Promise<void>;
}

export function AutoDailyCard({ status, enabled, daily, now, busy, expanded, onOpenChange, onToggle, onRun }: AutoDailyCardProps) {
    const tr = useT();
    return (
        <AutomationCard
            title={tr('Auto Daily Actions')}
            description={tr('Check Daily Ops, solve the daily hack when needed, and wait for the next reset.')}
            enabled={enabled}
            expanded={expanded}
            onOpenChange={onOpenChange}
            persistentSwitch
            busy={busy || (status?.running ?? false)}
            onEnable={() => void onToggle()}
            onDisable={() => void onToggle()}
        >
            {enabled ? (
                <p class="v2-muted">
                    {tr('Next auto check:')}{' '}
                    <strong>
                        {status?.alarmAt !== null && status?.alarmAt !== undefined
                            ? formatRemaining(new Date(status.alarmAt).toISOString(), now)
                            : status?.nextRunAt !== null && status?.nextRunAt !== undefined
                                ? formatRemaining(new Date(status.nextRunAt).toISOString(), now)
                                : tr('not scheduled')}
                    </strong>
                    {status?.nextRunReason ? ` · ${nextRunReasonLabel(status.nextRunReason, tr)}` : ''}
                </p>
            ) : null}
            <div class="v2-market-summary-grid">
                <article class="v2-market-summary-card">
                    <div class="v2-market-summary-head"><strong>{tr('Today')}</strong><span>{daily?.hasClaimedToday ? tr('claimed') : tr('unclaimed')}</span></div>
                </article>
                <article class="v2-market-summary-card">
                    <div class="v2-market-summary-head"><strong>{tr('Streak')}</strong><span>{daily?.currentStreak ?? '--'}</span></div>
                </article>
                <article class="v2-market-summary-card">
                    <div class="v2-market-summary-head"><strong>{tr('Today reward')}</strong><span>{daily?.streakBonus !== null && daily?.streakBonus !== undefined ? `+${daily.streakBonus}` : '--'}</span></div>
                </article>
                <article class="v2-market-summary-card">
                    <div class="v2-market-summary-head">
                        <strong>{tr('Next task')}</strong>
                        <span>{daily?.nextTaskTime ? formatRemaining(daily.nextTaskTime, now) : '--'}</span>
                    </div>
                </article>
            </div>
            <div class="v2-actions">
                <button type="button" disabled={busy || (status?.running ?? false)} onClick={() => void onRun()}>{tr('Run once')}</button>
            </div>
        </AutomationCard>
    );
}
