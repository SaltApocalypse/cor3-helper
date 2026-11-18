import type { AutoJobsSkippedJob } from '../../contracts/auto-jobs.js';
import type { JobMarketDefinition } from '../../domains/jobs/markets.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import { useT } from '../i18n-context.js';

export interface JobMarketView {
    readonly market: JobMarketDefinition;
    readonly jobs: readonly JobOffer[];
    readonly skipped: number;
    readonly failed: number;
    readonly expired: number;
    readonly skippedJobs: readonly AutoJobsSkippedJob[];
    readonly resetAt: string | null;
    readonly ok: boolean;
    readonly updatedAt?: number;
    readonly stale?: boolean;
    readonly error?: string;
}

export interface JobMarketListProps {
    readonly markets: readonly JobMarketView[];
    readonly activeKey: string;
    readonly now: number;
    readonly onSelect: (key: string) => void;
    readonly statusById?: Readonly<Record<string, string | undefined>>;
    readonly statusReasonById?: Readonly<Record<string, string | undefined>>;
    readonly selectedIds?: ReadonlySet<string>;
    readonly onToggleJob?: (id: string) => void;
    readonly onToggleMarket?: (jobs: readonly JobOffer[]) => void;
    readonly selectable?: boolean;
    readonly selectionDisabled?: boolean;
    readonly emptyText?: string;
}

const MARKET_META: Record<string, { readonly icon: string; readonly name: string; readonly iconClass?: string }> = {
    home: { icon: '🏠', name: 'CORE' },
    dark: { icon: '🌑', name: 'D4RK' },
    soyuz: { icon: '☭', name: 'SOYUZ', iconClass: 'v2-market-icon-soyuz' },
    usol: { icon: '☮', name: 'USOL', iconClass: 'v2-market-icon-usol' },
};

function formatRemaining(timestamp: string | null, now: number): string {
    if (!timestamp) return '';
    const target = new Date(timestamp).getTime();
    if (!Number.isFinite(target)) return '';
    const remaining = Math.max(0, target - now);
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
}

function statusRank(status: string | undefined): number {
    if (status === 'running') return 0;
    if (status === 'pending') return 1;
    if (status === 'ready') return 2;
    if (status === 'retry') return 3;
    if (status === 'failed') return 4;
    if (status === 'expired') return 5;
    if (status === 'done') return 6;
    if (status === 'skipped') return 7;
    return 1;
}

function statusClass(status: string | undefined): string {
    if (status === 'failed') return 'v2-tag-error';
    if (status === 'done') return 'v2-tag-ok';
    if (status === 'ready' || status === 'running' || status === 'pending' || status === 'retry' || status === 'expired') return 'v2-tag-warn';
    return '';
}

function formatAge(updatedAt: number | undefined, now: number): string {
    if (updatedAt === undefined || !Number.isFinite(updatedAt)) return '';
    const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m`;
}

function MarketTab({ market }: { readonly market: JobMarketDefinition }) {
    const meta = MARKET_META[market.key] ?? { icon: '', name: market.label };
    return (
        <span class="v2-market-tab-main">
            {meta.icon ? <span class={`v2-market-icon ${meta.iconClass ?? ''}`}>{meta.icon}</span> : null}
            <span>{meta.name}</span>
        </span>
    );
}

/**
 * Shared four-market job list used by both Overview and the Auto Jobs card.
 * It deliberately renders the same snapshot data in both places; automation
 * status is overlaid by the caller through `statusById`.
 */
export function JobMarketList({
    markets,
    activeKey,
    now,
    onSelect,
    statusById,
    statusReasonById,
    selectedIds,
    onToggleJob,
    onToggleMarket,
    selectable = false,
    selectionDisabled = false,
    emptyText,
}: JobMarketListProps) {
    const tr = useT();
    const active = markets.find((entry) => entry.market.key === activeKey) ?? null;
    if (!active) return <p class="v2-muted">{emptyText ?? tr('No jobs loaded for this market.')}</p>;

    const sortedJobs = [...active.jobs].sort((left, right) => {
        const rank = statusRank(statusById?.[left.id]) - statusRank(statusById?.[right.id]);
        return rank !== 0 ? rank : left.name.localeCompare(right.name);
    });
    const allSelected = sortedJobs.length > 0 && sortedJobs.every((job) => selectedIds?.has(job.id));
    const failedCount = active.failed + sortedJobs.filter((job) => statusById?.[job.id] === 'failed').length;
    const expiredCount = active.expired + sortedJobs.filter((job) => statusById?.[job.id] === 'expired').length;
    const retryCount = sortedJobs.filter((job) => statusById?.[job.id] === 'retry').length;
    const resetLabel = formatRemaining(active.resetAt, now);

    return (
        <>
            <div class="v2-job-market-block">
                <div class="v2-job-market-tabs">
                    {markets.map((entry) => (
                        <button
                            key={entry.market.key}
                            type="button"
                            class={entry.market.key === activeKey ? 'active' : ''}
                            onClick={() => onSelect(entry.market.key)}
                        >
                            <MarketTab market={entry.market} />
                        </button>
                    ))}
                </div>
                <p class="v2-muted v2-job-market-meta">
                    {tr('{count} job(s)', { count: sortedJobs.length })} · {tr('{count} skipped', { count: active.skipped })} · {tr('{count} failed', { count: failedCount })}
                    {retryCount > 0 ? ` · ${tr('{count} retry', { count: retryCount })}` : ''}
                    {expiredCount > 0 ? ` · ${tr('{count} expired', { count: expiredCount })}` : ''}
                    {resetLabel ? ` · ${tr('reset {time}', { time: resetLabel })}` : ` · ${tr('reset unknown')}`}
                    {active.updatedAt !== undefined ? ` · ${tr('updated {time} ago', { time: formatAge(active.updatedAt, now) })}` : ''}
                    {active.stale ? <span class="v2-tag v2-tag-warn">{tr('stale')}</span> : null}
                    {!active.ok && active.error ? ` · ${active.error}` : ''}
                </p>
            </div>
            {sortedJobs.length > 0 || active.skippedJobs.length > 0 ? (
                <ul class="v2-job-list">
                    {sortedJobs.map((job) => {
                        const status = statusById?.[job.id];
                        const selected = selectedIds?.has(job.id) ?? false;
                        const content = (
                            <span class="v2-job-main">
                                <strong>{job.name} — {job.serverName ?? tr('N/A')}</strong>
                                <span>
                                    💰 {job.rewardCredits} · ⭐ {job.rewardReputation}
                                    {job.alreadyTaken ? ` · ${job.canComplete ? tr('ready to claim') : tr('taken')}` : ''}
                                </span>
                            </span>
                        );
                        return (
                            <li key={job.id} class={selected ? 'v2-job-selected' : ''}>
                                {selectable && onToggleJob ? (
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            disabled={selectionDisabled}
                                            onChange={() => onToggleJob(job.id)}
                                        />
                                        {content}
                                    </label>
                                ) : content}
                                {status ? (
                                    <span
                                        class={`v2-tag ${statusClass(status)}`}
                                        title={statusReasonById?.[job.id]}
                                    >
                                        {tr(status)}
                                    </span>
                                ) : null}
                            </li>
                        );
                    })}
                    {active.skippedJobs.map((job) => {
                        const displayStatus = job.expired ? 'expired' : job.status;
                        return (
                            <li key={`skipped-${job.id}`} class="v2-job-skipped">
                                <span class="v2-job-main">
                                    <strong>{job.name} — {job.serverName ?? tr('N/A')}</strong>
                                    <span>
                                        {job.reason}
                                        {job.status === 'failed' && (job.reputationPenalty ?? 0) > 0
                                            ? ` · ⭐ -${job.reputationPenalty}`
                                            : job.status === 'failed' && (job.deposit ?? 0) > 0
                                                ? ` · 💰 -${job.deposit}`
                                                : ''}
                                    </span>
                                </span>
                                <span class={`v2-tag ${statusClass(displayStatus)}`}>{tr(displayStatus)}</span>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <p class="v2-muted">{emptyText ?? tr('No jobs loaded for this market.')}</p>
            )}
            {selectable && onToggleMarket && sortedJobs.length > 0 ? (
                <div class="v2-job-summary">
                    <label class="v2-inline-check">
                        <input
                            type="checkbox"
                            checked={allSelected}
                            disabled={selectionDisabled}
                            onChange={() => onToggleMarket(sortedJobs)}
                        />
                        {tr('Select all {market}', { market: active.market.label })}
                    </label>
                    <span class="v2-muted">{tr('Total: {count}', { count: sortedJobs.length })}</span>
                </div>
            ) : null}
        </>
    );
}
