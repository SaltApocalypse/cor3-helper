import type { AutoJobsMarket, AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { AutoFinishLastRun, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import type { RawMarketSnapshot } from '../../../contracts/market.js';
import { JOB_MARKETS, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { mapMarketSnapshotJobs } from '../../../application/auto-job/market-mapper.js';
import { syncAllJobMarkets, syncJobMarket, type JobSnapshotSyncDeps } from './auto-jobs-sync.js';
import { mergeAutoJobsSnapshot } from '../../../application/auto-job/snapshot.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { AutomationLogger, EventPublisher, RunLogSink, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { AutoJobsSnapshotStore } from '../../../infrastructure/storage/auto-jobs-snapshot-store.js';
import { AUTO_JOBS_INFO_ALARM } from './alarm-ids.js';
import type { DismissFailedJobsSummary, FailedJobDismisser } from './dismiss-failed.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobMarketSync, JobMarketSyncEntry } from './job-market-sync.js';
import type { TabRequestPort } from './job-routing.js';

export type AutoJobsRefreshReason = 'interval' | 'reset' | 'fallback';

export type AutoReadyOutcome =
    | { readonly mode: 'info'; readonly jobs: number; readonly done: number; readonly failed: number }
    | { readonly mode: 'complete'; readonly jobs: number; readonly done: number; readonly failed: number };

export type AutoJobsCycleResult =
    | { readonly ok: true; readonly value: AutoReadyOutcome }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface AutoFinishPort {
    run(
        owner: string,
        force?: boolean,
        prefetched?: { readonly jobs: readonly import('../../../domains/jobs/model.js').JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] },
    ): Promise<AutoFinishRunResult | { readonly busy: true }>;
    lastRun(): AutoFinishLastRun | null;
    completedResetsSnapshot(): Readonly<Record<string, string>>;
    completedJobsSnapshot(): Readonly<Record<string, string>>;
}

export interface AutoJobsDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly events: EventPublisher;
    readonly logger: AutomationLogger;
    readonly runLogs: RunLogSink;
    readonly clock: { now(): number };
    readonly store: AutoJobsSnapshotStore;
    readonly locks: JobLockRegistry;
    readonly markets: JobMarketSync;
    readonly networkOps: Pick<NetworkOperationQueue, 'enqueue'>;
    readonly tabs: Pick<TabRequestPort, 'findCor3Tab'>;
    readonly isAutoRefreshRunning: () => boolean;
}

export interface AutoJobsStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly stage: string;
    readonly nextRefreshAt: number | null;
    readonly refreshReason: AutoJobsRefreshReason;
    readonly lastRefreshAt: number | null;
    readonly snapshotAt: number | null;
    /** Active minigame locks: job id -> expiry. */
    readonly locks: Readonly<Record<string, number>>;
    /** Per-job retry budget for the current reset. */
    readonly retryAttempts: Readonly<Record<string, { readonly count: number; readonly lastAttemptAt: number }>>;
}

const AUTO_JOBS_MIN_INTERVAL_MS = 15_000;
/** Idle per-market freshness window; a recent game push or refresh is reused. */
const AUTO_JOBS_MARKET_TTL_MS = 60_000;
/** Around a market reset, refresh more often so new claimable jobs appear fast. */
const AUTO_JOBS_RESET_WINDOW_MS = 2 * 60_000;
const AUTO_JOBS_RESET_TTL_MS = 15_000;
const AUTO_JOBS_RESET_GRACE_MS = 30_000;
const AUTO_JOBS_FALLBACK_REFRESH_MS = 2 * 60 * 60 * 1000;
/** When every known reset time is already past, poll sooner than the full interval. */
const AUTO_JOBS_STALE_RESET_MAX_WAIT_MS = 10 * 60_000;

function marketTtlMs(market: AutoJobsMarket, now: number): number {
    const reset = market.resetAt ? Date.parse(market.resetAt) : Number.NaN;
    if (Number.isFinite(reset) && Math.abs(reset - now) <= AUTO_JOBS_RESET_WINDOW_MS) return AUTO_JOBS_RESET_TTL_MS;
    return AUTO_JOBS_MARKET_TTL_MS;
}

export class AutoJobsCoordinator {
    private snapshot: AutoJobsSnapshot | null = null;
    private cycleRunning = false;
    private cancelRequested = false;
    private stage = 'idle';
    private nextRefreshAt: number | null = null;
    private refreshReason: AutoJobsRefreshReason = 'interval';
    private lastError: string | null = null;
    private lastSkipReason: string | null = null;
    private bootstrapAt = 0;
    private lastAttemptAt = 0;
    private pendingEnsure: { readonly reason: string; readonly tabIdHint?: number } | null = null;
    private autoFinish: AutoFinishPort | null = null;
    private dismisser: FailedJobDismisser | null = null;

    constructor(private readonly deps: AutoJobsDeps) {}

    attachAutoFinish(autoFinish: AutoFinishPort): void {
        this.autoFinish = autoFinish;
    }

    attachDismisser(dismisser: FailedJobDismisser): void {
        this.dismisser = dismisser;
    }

    snapshotView(): AutoJobsSnapshot | null {
        return this.snapshot;
    }

    isRunning(): boolean {
        return this.cycleRunning;
    }

    isCancelRequested(): boolean {
        return this.cancelRequested;
    }

    stageName(): string {
        return this.stage;
    }

    lastErrorText(): string | null {
        return this.lastError;
    }

    lastSkipReasonText(): string | null {
        return this.lastSkipReason;
    }

    lastAttemptAtValue(): number {
        return this.lastAttemptAt;
    }

    bootstrapAtValue(): number {
        return this.bootstrapAt;
    }

    nextRefreshAtValue(): number | null {
        return this.nextRefreshAt;
    }

    refreshReasonValue(): AutoJobsRefreshReason {
        return this.refreshReason;
    }

    async status(): Promise<AutoJobsStatus> {
        const current = await this.deps.settings.get();
        return {
            enabled: current.autoJobsEnabled,
            intervalMinutes: current.autoJobsIntervalMinutes,
            running: this.cycleRunning,
            stage: this.stage,
            nextRefreshAt: this.nextRefreshAt,
            refreshReason: this.refreshReason,
            lastRefreshAt: this.snapshot?.at ?? null,
            snapshotAt: this.snapshot?.at ?? null,
            locks: this.deps.locks.locksSnapshot(),
            retryAttempts: Object.fromEntries(
                Object.entries(this.deps.locks.attemptsSnapshot()).map(([jobId, entry]) => [
                    jobId,
                    { count: entry.count, lastAttemptAt: entry.lastAttemptAt },
                ]),
            ),
        };
    }

    async syncAllMarkets(owner: string, reason: string): Promise<{ jobs: readonly import('../../../domains/jobs/model.js').JobOffer[]; markets: readonly JobMarketSyncEntry[] }> {
        return syncAllJobMarkets(this.snapshotSyncDeps(), owner, reason);
    }

    async syncMarket(request: {
        readonly marketId: string;
        readonly marketKey: string;
        readonly serverId: string;
        readonly owner: string;
        readonly reason: string;
    }): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }> {
        return syncJobMarket(this.snapshotSyncDeps(), request);
    }

    private snapshotSyncDeps(): JobSnapshotSyncDeps {
        return {
            markets: this.deps.markets,
            snapshot: () => this.snapshot,
            publishSnapshot: (update) => this.publishSnapshot(update),
            now: () => this.deps.clock.now(),
        };
    }
    async restore(): Promise<void> {
        const snapshot = await this.deps.store.get();
        if (snapshot && (!this.snapshot || snapshot.at > this.snapshot.at)) this.snapshot = snapshot;
        await this.scheduleNextRefresh();
    }

    async enable(): Promise<SettingsV1> {
        const next = await this.deps.settings.update({ autoJobsEnabled: true });
        void this.ensureInfo('manual-enable', true);
        void this.scheduleNextRefresh();
        return next;
    }

    async disable(): Promise<SettingsV1> {
        this.cancelRequested = true;
        const next = await this.deps.settings.update({ autoJobsEnabled: false });
        void this.scheduleNextRefresh();
        return next;
    }

    cancel(): void {
        this.cancelRequested = true;
    }

    publishSnapshot(update: AutoJobsSnapshot): void {
        const snapshot = mergeAutoJobsSnapshot(this.snapshot, update);
        this.snapshot = snapshot;
        this.deps.events.publish('auto.jobs.snapshot', snapshot);
        void this.deps.store.set(snapshot).catch((error: unknown) => {
            this.deps.logger.warn('auto-jobs', 'Failed to persist Auto Jobs snapshot', { message: error instanceof Error ? error.message : String(error) });
        });
    }

    applyMarketCacheSnapshot(marketId: string, snapshot: RawMarketSnapshot): void {
        const market = JOB_MARKETS.find((entry) => entry.marketId === marketId);
        if (!market) return;
        const mapped = mapMarketSnapshotJobs(snapshot, marketId, market.key, market.completionServerId ?? market.routeServerId);
        const previous = this.snapshot;
        // Keep the persisted market cache in sync with game-pushed refreshes so
        // the Progress page does not depend on a second network round trip.
        void this.deps.markets.cacheSnapshotView(marketId, snapshot).catch(() => undefined);
        this.publishSnapshot({
            at: this.deps.clock.now(),
            jobs: [
                ...(previous?.jobs.filter((job) => job.marketKey !== market.key) ?? []),
                ...mapped.jobs,
            ],
            markets: [
                ...(previous?.markets.filter((entry) => entry.marketKey !== market.key) ?? []),
                {
                    marketKey: market.key,
                    label: market.label,
                    ok: true,
                    skipped: mapped.skipped,
                    failed: mapped.failed,
                    expired: mapped.expired,
                    skippedJobs: mapped.skippedJobs,
                    resetAt: mapped.resetAt ?? null,
                    updatedAt: this.deps.clock.now(),
                    stale: false,
                },
            ],
        });
    }

    async runCycle(
        owner: string,
        reason: string,
        priority: number,
        tabId?: number,
        targets?: readonly JobMarketDefinition[],
    ): Promise<AutoJobsCycleResult> {
        const current = await this.deps.settings.get();
        // Helper Mode and a disabled Auto Jobs switch must not trigger market
        // traffic. Market data is only refreshed for an active Auto Jobs run;
        // explicit manual sync still goes through the dedicated bridge handler.
        if (current.helperMode || !current.autoJobsEnabled) {
            return { ok: true, value: { mode: 'info', jobs: 0, done: 0, failed: 0 } };
        }
        if (this.cycleRunning) {
            return { ok: true, value: { mode: 'info', jobs: 0, done: 0, failed: 0 } };
        }
        this.cycleRunning = true;
        this.cancelRequested = false;
        this.stage = 'queued';
        void this.deps.locks.persist('running');
        this.deps.events.publish('auto.jobs.cycle', { running: true, owner, reason, stage: this.stage });
        try {
            const result = await this.deps.networkOps.enqueue<AutoReadyOutcome, { readonly code: string; readonly message: string }>({
                owner,
                reason,
                priority,
            }, async () => {
                this.stage = 'fetching-markets';
                this.deps.events.publish('auto.jobs.cycle', { running: true, owner, reason, stage: this.stage });
                const expectedMarkets = targets?.length ?? JOB_MARKETS.length;
                const synced = await this.deps.markets.syncAll(owner, reason, targets, (partial) => {
                    this.publishSnapshot({ at: this.deps.clock.now(), jobs: partial.jobs, markets: partial.markets });
                    this.stage = `market:${partial.markets.length}/${expectedMarkets}`;
                    this.deps.events.publish('auto.jobs.cycle', { running: true, owner, reason, stage: this.stage });
                }, () => this.cancelRequested);
                this.publishSnapshot({ at: this.deps.clock.now(), jobs: synced.jobs, markets: synced.markets });
                this.stage = 'publishing';
                this.deps.logger.info('auto-jobs', 'Market information fetch complete', { owner, reason, jobs: synced.jobs.length });
                if (this.cancelRequested) {
                    return { ok: true as const, value: { mode: 'info' as const, jobs: synced.jobs.length, done: 0, failed: 0 } };
                }

                const current = await this.deps.settings.get();
                if (!current.autoJobsEnabled || !current.autoFinishEnabled) {
                    return { ok: true as const, value: { mode: 'info' as const, jobs: synced.jobs.length, done: 0, failed: 0 } };
                }

                this.stage = 'completing';
                this.deps.events.publish('auto.jobs.cycle', { running: true, owner, reason, stage: this.stage });
                if (tabId !== undefined) this.deps.events.publish('auto.start', { tabId, status: 'running' });
                const completion = await this.autoFinish!.run(owner, false, synced);
                if ('busy' in completion) {
                    return {
                        ok: false as const,
                        error: { code: 'AUTO_FINISH_BUSY', message: 'Auto Finish is already running' },
                    };
                }
                return { ok: true as const, value: { mode: 'complete' as const, jobs: completion.jobs, done: completion.done, failed: completion.failed } };
            });
            if (!result.ok) {
                this.deps.logger.warn('auto-jobs', 'Auto Jobs cycle failed', { owner, reason, code: result.error.code, message: result.error.message });
                if (tabId !== undefined) this.deps.events.publish('auto.start', { tabId, status: 'error', error: result.error.message });
                return { ok: false, error: result.error };
            }
            if (tabId !== undefined && result.value.mode === 'complete') {
                this.deps.events.publish('auto.start', {
                    tabId,
                    status: 'done',
                    done: result.value.done,
                    failed: result.value.failed,
                });
            }
            return { ok: true, value: result.value };
        } finally {
            this.cycleRunning = false;
            this.stage = 'idle';
            void this.deps.locks.persist('idle');
            this.deps.events.publish('auto.jobs.cycle', { running: false, owner, reason, stage: this.stage });
        }
    }

    async ensureInfo(reason: string, force = false, tabIdHint?: number): Promise<void> {
        const current = await this.deps.settings.get();
        if (current.helperMode) {
            this.lastSkipReason = 'helper-mode';
            return;
        }
        if (!current.autoJobsEnabled) {
            this.lastSkipReason = 'auto-jobs-disabled';
            return;
        }
        if (this.cycleRunning) {
            // Do not lose a trigger that arrives while a cycle is running.
            // Coalesce it and re-check freshness afterwards.
            this.pendingEnsure = { reason, ...(tabIdHint !== undefined ? { tabIdHint } : {}) };
            this.lastSkipReason = 'cycle-running';
            return;
        }
        if (this.deps.isAutoRefreshRunning()) {
            this.lastSkipReason = 'data-refresh-running';
            if (reason === 'scheduled') await this.scheduleNextRefresh();
            return;
        }
        if (!force && this.snapshot && (reason === 'popup-open' || reason === 'startup')) {
            this.lastSkipReason = 'snapshot-present';
            return;
        }
        const now = this.deps.clock.now();
        const manual = reason === 'manual-enable';
        // Manual enable is a user request and always refreshes every market.
        // Everything else only refreshes markets whose data is older than
        // their TTL; a recent game push therefore makes the pass a no-op.
        const targets = manual ? undefined : this.marketsToRefresh(now);
        if (!manual && targets !== undefined && targets.length === 0) {
            this.lastSkipReason = 'snapshot-fresh';
            // A one-shot reset alarm must still schedule the next wake-up even
            // when a recent push already made the snapshot fresh.
            if (reason === 'scheduled') await this.scheduleNextRefresh();
            return;
        }
        if (!manual && this.snapshot && now - this.lastAttemptAt < AUTO_JOBS_MIN_INTERVAL_MS) {
            this.lastSkipReason = 'recently-refreshed';
            if (reason === 'scheduled') await this.scheduleNextRefresh();
            return;
        }
        const tabId = tabIdHint ?? await this.deps.tabs.findCor3Tab();
        if (tabId === null) {
            this.lastSkipReason = 'no-tab';
            if (reason === 'scheduled') await this.scheduleNextRefresh();
            return;
        }
        this.lastAttemptAt = now;
        this.bootstrapAt = now;
        this.lastSkipReason = null;
        try {
            const result = await this.runCycle(
                `auto-jobs-${reason}:${tabId}`,
                reason,
                current.autoFinishEnabled || force ? 50 : 35,
                tabId,
                targets,
            );
            this.lastAttemptAt = this.deps.clock.now();
            this.lastError = result.ok ? null : `${result.error.code}: ${result.error.message}`;
            await this.scheduleNextRefresh();
        } finally {
            const pending = this.pendingEnsure;
            this.pendingEnsure = null;
            if (pending) {
                // Re-enter once; the freshness check makes this a no-op when
                // the cycle that just finished already refreshed the market.
                void this.ensureInfo(pending.reason, true, pending.tabIdHint);
            }
        }
    }

    /**
     * Markets that need a network refresh. A market is fresh when it synced
     * successfully within its TTL. The TTL shrinks near a known reset so new
     * claimable jobs appear quickly.
     */
    private marketsToRefresh(now: number): readonly JobMarketDefinition[] {
        const snapshot = this.snapshot;
        if (!snapshot) return [...JOB_MARKETS];
        return JOB_MARKETS.filter((market) => {
            const entry = snapshot.markets.find((candidate) => candidate.marketKey === market.key);
            if (!entry || !entry.ok || entry.updatedAt === undefined) return true;
            return now - entry.updatedAt >= marketTtlMs(entry, now);
        });
    }

    async scheduleNextRefresh(): Promise<void> {
        const current = await this.deps.settings.get();
        await this.deps.scheduler.clear(AUTO_JOBS_INFO_ALARM);
        const now = this.deps.clock.now();
        if (current.helperMode || !current.autoJobsEnabled) {
            this.nextRefreshAt = null;
            this.refreshReason = 'interval';
            this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: null, reason: this.refreshReason });
            return;
        }
        const resetTimes = (this.snapshot?.markets ?? [])
            .filter((market) => market.ok && market.resetAt)
            .map((market) => new Date(market.resetAt!).getTime())
            .filter((value) => Number.isFinite(value) && value > now);
        if (current.autoFinishEnabled && this.allMarketsCompletedForCurrentReset()) {
            if (resetTimes.length > 0) {
                this.refreshReason = 'reset';
                this.nextRefreshAt = Math.min(...resetTimes) + AUTO_JOBS_RESET_GRACE_MS;
                this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, { when: this.nextRefreshAt });
            } else {
                this.refreshReason = 'fallback';
                this.nextRefreshAt = now + AUTO_JOBS_FALLBACK_REFRESH_MS;
                this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, { when: this.nextRefreshAt });
            }
            this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: this.nextRefreshAt, reason: this.refreshReason });
            return;
        }
        if (resetTimes.length > 0) {
            // Wake when the earliest market reset countdown reaches zero, but
            // never later than the normal polling interval.
            const intervalAt = now + current.autoJobsIntervalMinutes * 60_000;
            const resetAt = Math.min(...resetTimes) + AUTO_JOBS_RESET_GRACE_MS;
            this.refreshReason = resetAt <= intervalAt ? 'reset' : 'interval';
            this.nextRefreshAt = Math.min(resetAt, intervalAt);
            if (this.refreshReason === 'interval') {
                this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, {
                    delayInMinutes: current.autoJobsIntervalMinutes,
                    periodInMinutes: current.autoJobsIntervalMinutes,
                });
            } else {
                this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, { when: this.nextRefreshAt });
            }
            this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: this.nextRefreshAt, reason: this.refreshReason });
            return;
        }
        const resetMarkets = (this.snapshot?.markets ?? []).filter((market) => market.ok && market.resetAt);
        const staleResets = resetMarkets.length > 0 && resetMarkets.every((market) => {
            const at = Date.parse(market.resetAt!);
            return Number.isFinite(at) && at <= now;
        });
        if (staleResets) {
            // The game has not published the next reset time yet. Waiting the
            // full (often 60-minute) interval leaves new jobs invisible after a
            // reset; poll at a bounded short interval until a future reset or
            // new job appears.
            const waitMs = Math.min(current.autoJobsIntervalMinutes * 60_000, AUTO_JOBS_STALE_RESET_MAX_WAIT_MS);
            this.refreshReason = 'fallback';
            this.nextRefreshAt = now + waitMs;
            this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, { when: this.nextRefreshAt });
            this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: this.nextRefreshAt, reason: this.refreshReason });
            return;
        }
        this.refreshReason = 'interval';
        this.nextRefreshAt = now + current.autoJobsIntervalMinutes * 60_000;
        this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, {
            delayInMinutes: current.autoJobsIntervalMinutes,
            periodInMinutes: current.autoJobsIntervalMinutes,
        });
        this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: this.nextRefreshAt, reason: this.refreshReason });
    }

    allMarketsCompletedForCurrentReset(): boolean {
        const now = this.deps.clock.now();
        const snapshot = this.snapshot;
        if (!snapshot || snapshot.markets.length === 0) return false;
        const active = snapshot.markets.filter((market) =>
            market.ok && market.resetAt !== null && market.resetAt !== undefined
            && new Date(market.resetAt).getTime() > now,
        );
        if (active.length !== snapshot.markets.length) return false;
        const completedJobs = this.autoFinish?.completedJobsSnapshot() ?? {};
        // Completion is tracked per job, not per market. A market can gain new
        // jobs inside the same reset; those must still be processed. Empty
        // markets are not considered finished so the next interval can find
        // newly generated work.
        return active.every((market) => {
            const jobs = snapshot.jobs.filter((job) => job.marketKey === market.marketKey);
            return jobs.length > 0 && jobs.every((job) => completedJobs[job.id] === market.resetAt);
        });
    }

    dismissFailedJobs(
        owner: string,
        reason: string,
        marketKeys?: readonly string[],
        shouldStop?: () => boolean,
        runId?: string,
        skipIds?: ReadonlySet<string>,
    ): Promise<DismissFailedJobsSummary> {
        return this.dismisser!.run(owner, reason, marketKeys, shouldStop, runId, skipIds);
    }
}
