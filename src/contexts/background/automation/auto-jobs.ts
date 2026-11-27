import type { AutoJobsMarket, AutoJobsMarketSelection, AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { AutoFinishLastRun, AutoFinishRunResult } from '../../../contracts/auto-finish.js';
import type { SettingsV1 } from '../../../contracts/storage.js';
import type { RawMarketSnapshot } from '../../../contracts/market.js';
import { JOB_MARKETS, type JobMarketDefinition } from '../../../domains/jobs/markets.js';
import { mapMarketSnapshotJobs } from '../../../application/auto-job/market-mapper.js';
import { syncAllJobMarkets, syncJobMarket, type JobSnapshotSyncDeps } from './auto-jobs-sync.js';
import { mergeAutoJobsSnapshot } from '../../../application/auto-job/snapshot.js';
import { isCompletedForMarketReset } from '../../../application/auto-job/market-completion.js';
import type { MarketCompletedJobsState } from '../../../contracts/market-completed-jobs.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { AutomationLogger, EventPublisher, RunLogSink, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { AutoJobsSnapshotStore } from '../../../infrastructure/storage/auto-jobs-snapshot-store.js';
import { AUTO_JOBS_INFO_ALARM, AUTO_JOBS_INFO_REPAIR_ALARM } from './alarm-ids.js';
import type { DismissFailedJobsSummary, FailedJobDismisser } from './dismiss-failed.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobMarketSync, JobMarketSyncEntry } from './job-market-sync.js';
import type { TabRequestPort } from './job-routing.js';

export type AutoJobsRefreshReason = 'interval' | 'reset' | 'fallback';
export type AutoJobsScheduleState = 'scheduled' | 'repair-pending' | 'repairing' | 'schedule-unavailable' | 'disabled';

export type AutoReadyOutcome =
    | { readonly mode: 'info'; readonly jobs: number; readonly done: number; readonly failed: number }
    | { readonly mode: 'complete'; readonly jobs: number; readonly done: number; readonly failed: number };

export type AutoJobsCycleResult =
    | { readonly ok: true; readonly value: AutoReadyOutcome }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export interface AutoFinishPort {
    run(
        owner: string,
        options: import('./auto-finish-options.js').AutoFinishRunOptions,
        prefetched?: { readonly jobs: readonly import('../../../domains/jobs/model.js').JobOffer[]; readonly markets: readonly JobMarketSyncEntry[] },
    ): Promise<AutoFinishRunResult | { readonly busy: true }>;
    lastRun(): AutoFinishLastRun | null;
    completedResetsSnapshot(): Readonly<Record<string, string>>;
    completedJobsByMarketSnapshot(): MarketCompletedJobsState;
    completionsAvailable(): boolean;
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
    readonly scheduleState: AutoJobsScheduleState;
    readonly repairAt: number | null;
    readonly lastRefreshAt: number | null;
    readonly snapshotAt: number | null;
    /** Active minigame locks: job id -> expiry. */
    readonly locks: Readonly<Record<string, number>>;
    /** Per-job retry budget for the current reset. */
    readonly retryAttempts: Readonly<Record<string, { readonly count: number; readonly lastAttemptAt: number }>>;
    /** Due/forced decision for every known market on the next refresh. */
    readonly marketSelection: readonly AutoJobsMarketSelection[];
    readonly lastSkipReason: string | null;
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
/** Hard cap: a market whose jobs were not observed for this long is forced. */
const AUTO_JOBS_STALE_JOBS_FORCE_MS = 10 * 60_000;
/** Bounded recovery backoff for past/missing/invalid/stale markets. */
const AUTO_JOBS_RECOVERY_BASE_MS = 60_000;
const AUTO_JOBS_RECOVERY_MAX_MS = AUTO_JOBS_STALE_RESET_MAX_WAIT_MS;
const AUTO_JOBS_REPAIR_DELAYS_MS = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000] as const;

function repairDelayMs(attempts: number): number {
    return AUTO_JOBS_REPAIR_DELAYS_MS[Math.min(Math.max(attempts, 0), AUTO_JOBS_REPAIR_DELAYS_MS.length - 1)]!;
}

type MarketResetState = 'future' | 'past' | 'missing' | 'invalid' | 'stale' | 'unavailable';

function resetSignature(snapshot: AutoJobsSnapshot | null): string {
    return JSON.stringify((snapshot?.markets ?? [])
        .map((market) => [market.marketKey, market.ok, market.stale === true, market.resetAt ?? null])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function recoveryDelayMs(attempts: number): number {
    return Math.min(AUTO_JOBS_RECOVERY_MAX_MS, AUTO_JOBS_RECOVERY_BASE_MS * 2 ** Math.min(Math.max(attempts - 1, 0), 4));
}

function classifyMarketReset(
    entry: AutoJobsMarket | undefined,
    now: number,
): MarketResetState {
    if (!entry || !entry.ok) return 'unavailable';
    if (entry.stale === true) return 'stale';
    if (entry.resetAt === null || entry.resetAt === undefined || entry.resetAt.length === 0) return 'missing';
    const at = Date.parse(entry.resetAt);
    if (!Number.isFinite(at)) return 'invalid';
    return at > now ? 'future' : 'past';
}

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
    private scheduleState: AutoJobsScheduleState = 'disabled';
    private repairAt: number | null = null;
    private repairAttempts = 0;
    private lastError: string | null = null;
    private lastSkipReason: string | null = null;
    private warnedMissingMarketSource = false;
    private bootstrapAt = 0;
    private lastAttemptAt = 0;
    private pendingEnsure: { readonly reason: string; readonly tabIdHint?: number; readonly forceAll?: boolean } | null = null;
    private autoFinish: AutoFinishPort | null = null;
    private dismisser: FailedJobDismisser | null = null;
    private readonly recoveryByMarket = new Map<string, { attempts: number; lastAttemptAt: number }>();
    private scheduleGeneration = 0;
    private scheduleQueue: Promise<void> = Promise.resolve();

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

    scheduleStateValue(): AutoJobsScheduleState {
        return this.scheduleState;
    }

    repairAtValue(): number | null {
        return this.repairAt;
    }

    async status(): Promise<AutoJobsStatus> {
        const current = await this.deps.settings.get();
        const now = this.deps.clock.now();
        const selection = this.marketSelection(now, current.autoJobsIntervalMinutes);
        return {
            enabled: current.autoJobsEnabled,
            intervalMinutes: current.autoJobsIntervalMinutes,
            running: this.cycleRunning,
            stage: this.stage,
            nextRefreshAt: this.nextRefreshAt,
            refreshReason: this.refreshReason,
            scheduleState: this.scheduleState,
            repairAt: this.repairAt,
            lastRefreshAt: this.snapshot?.at ?? null,
            snapshotAt: this.snapshot?.at ?? null,
            locks: this.deps.locks.locksSnapshot(),
            retryAttempts: Object.fromEntries(
                Object.entries(this.deps.locks.attemptsSnapshot()).map(([jobId, entry]) => [
                    jobId,
                    { count: entry.count, lastAttemptAt: entry.lastAttemptAt },
                ]),
            ),
            marketSelection: selection.detail,
            lastSkipReason: this.lastSkipReason,
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

    /** Drop in-memory freshness after a page reload; the WS/cache is new. */
    resetAfterPageReload(): void {
        this.snapshot = null;
        this.lastAttemptAt = 0;
        this.bootstrapAt = 0;
        this.pendingEnsure = null;
        this.lastSkipReason = null;
        this.lastError = null;
        this.recoveryByMarket.clear();
    }

    publishSnapshot(update: AutoJobsSnapshot): void {
        const previousResetSignature = resetSignature(this.snapshot);
        const snapshot = mergeAutoJobsSnapshot(this.snapshot, update);
        this.snapshot = snapshot;
        this.deps.events.publish('auto.jobs.snapshot', snapshot);
        void this.deps.store.set(snapshot).catch((error: unknown) => {
            this.deps.logger.warn('auto-jobs', 'Failed to persist Auto Jobs snapshot', { message: error instanceof Error ? error.message : String(error) });
        });
        // Only reset-relevant changes should rebuild the alarm. Ordinary job
        // updates must not churn the scheduler.
        if (previousResetSignature !== resetSignature(snapshot)) {
            const now = this.deps.clock.now();
            for (const market of snapshot.markets) {
                if (classifyMarketReset(market, now) === 'future') this.recoveryByMarket.delete(market.marketKey);
            }
            void this.scheduleNextRefresh();
        }
    }

    private warnMissingMarketSource(marketId: string): void {
        if (this.warnedMissingMarketSource) return;
        this.warnedMissingMarketSource = true;
        this.deps.logger.warn('auto-jobs', 'Market cache push without source; ignoring for jobs freshness', { marketId });
    }

    applyMarketCacheSnapshot(marketId: string, snapshot: RawMarketSnapshot, source?: 'jobs' | 'options' | 'lots'): void {        const market = JOB_MARKETS.find((entry) => entry.marketId === marketId);
        if (!market) return;
        // Keep the persisted market cache in sync with game-pushed refreshes so
        // the Progress page does not depend on a second network round trip.
        // This is safe for every component: options update credits/reputation,
        // jobs update the job list inside the cached view.
        void this.deps.markets.cacheSnapshotView(marketId, snapshot).catch(() => undefined);
        // Only a `get.jobs` response proves that the job list is fresh.
        // Options/lots pushes reuse the previously cached jobs, so treating
        // them as a full market sync kept the freshness clock moving and made
        // the scheduler skip the market forever (HOME not refreshing).
        // Pushes without `source` come from a pre-313 content script; ignore
        // them for freshness (the next Auto Jobs cycle fetches jobs directly)
        // and warn once so a mixed deployment is visible in the log.
        if (source !== 'jobs') {
            if (source === undefined) this.warnMissingMarketSource(marketId);
            return;
        }
        const mapped = mapMarketSnapshotJobs(snapshot, marketId, market.key, market.completionServerId ?? market.routeServerId);
        const previous = this.snapshot;
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
                const completion = await this.autoFinish!.run(owner, {}, synced);
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

    async ensureInfo(reason: string, force = false, tabIdHint?: number, forceAll = false): Promise<void> {
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
            this.pendingEnsure = {
                reason,
                ...(tabIdHint !== undefined ? { tabIdHint } : {}),
                ...(forceAll ? { forceAll } : {}),
            };
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
        // Full refreshes are reserved for explicit runs and recovery paths
        // (for example after a page reload). Ordinary scheduled/ready passes
        // keep the per-market TTL so we do not hammer every market every time.
        const fullRefresh = manual || forceAll === true;
        // The selection detail is logged every cycle so a starved market is
        // diagnosable from an exported log (HOME skip reports). The stale-jobs
        // watchdog forces a market that has not been observed for too long.
        const selection = fullRefresh ? undefined : this.marketSelection(now, current.autoJobsIntervalMinutes);
        const targets = selection?.targets;
        if (selection) {
            this.deps.logger.debug('auto-jobs', 'Auto Jobs market selection', {
                reason,
                force,
                intervalMinutes: current.autoJobsIntervalMinutes,
                markets: selection.detail,
            });
            for (const entry of selection.detail) {
                if (!entry.forced) continue;
                this.deps.logger.debug('auto-jobs', 'Market forced after stale jobs window', {
                    market: entry.marketKey,
                    state: entry.state,
                    ageMs: entry.ageMs,
                });
            }
        }
        if (!fullRefresh && targets !== undefined && targets.length === 0) {
            this.lastSkipReason = 'snapshot-fresh';
            // A one-shot reset alarm must still schedule the next wake-up even
            // when a recent push already made the snapshot fresh.
            if (reason === 'scheduled') await this.scheduleNextRefresh();
            return;
        }
        if (!fullRefresh && reason !== 'scheduled' && this.snapshot && now - this.lastAttemptAt < AUTO_JOBS_MIN_INTERVAL_MS) {
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
                forceAll ? 80 : current.autoFinishEnabled || force ? 50 : 35,
                tabId,
                targets,
            );
            this.lastAttemptAt = this.deps.clock.now();
            this.lastError = result.ok ? null : `${result.error.code}: ${result.error.message}`;
            this.noteRefreshAttempts(targets ?? JOB_MARKETS, this.deps.clock.now());
            await this.scheduleNextRefresh();
        } finally {
            const pending = this.pendingEnsure;
            this.pendingEnsure = null;
            if (pending) {
                // Re-enter once; the freshness check makes this a no-op when
                // the cycle that just finished already refreshed the market.
                void this.ensureInfo(pending.reason, true, pending.tabIdHint, pending.forceAll === true);
            }
        }
    }

    /**
     * Due/forced decision for every known market. A market is fresh when it
     * synced successfully within its TTL; near a reset the TTL shrinks. The
     * stale-jobs watchdog overrides the TTL/recovery decision so a market
     * (notably HOME) cannot be starved while other markets keep the cycle
     * alive. The scheduler's interval still decides when a cycle runs.
     */
    private marketSelection(now: number, intervalMinutes: number, selectAll = false): {
        readonly targets: readonly JobMarketDefinition[];
        readonly detail: readonly AutoJobsMarketSelection[];
    } {
        const snapshot = this.snapshot;
        const staleLimitMs = Math.max(
            AUTO_JOBS_MARKET_TTL_MS * 2,
            Math.min(intervalMinutes * 60_000, AUTO_JOBS_STALE_JOBS_FORCE_MS),
        );
        const targets: JobMarketDefinition[] = [];
        const detail: AutoJobsMarketSelection[] = [];
        for (const market of JOB_MARKETS) {
            const entry = snapshot?.markets.find((candidate) => candidate.marketKey === market.key);
            const state = classifyMarketReset(entry, now);
            const ageMs = entry?.updatedAt !== undefined ? now - entry.updatedAt : null;
            const due = selectAll || !snapshot
                ? true
                : state === 'future'
                    ? entry === undefined || entry.updatedAt === undefined || now - entry.updatedAt >= marketTtlMs(entry, now)
                    : this.recoveryDue(market.key, entry, now);
            const forced = !selectAll && snapshot !== null && (ageMs === null || ageMs >= staleLimitMs);
            const selected = due || forced;
            if (selected) targets.push(market);
            detail.push({ marketKey: market.key, state, ageMs, due, forced, selected });
        }
        return { targets, detail };
    }

    private recoveryDue(marketKey: string, entry: AutoJobsMarket | undefined, now: number): boolean {
        const state = this.recoveryByMarket.get(marketKey);
        const attempts = state?.attempts ?? 0;
        const anchor = state?.lastAttemptAt ?? entry?.updatedAt ?? 0;
        if (anchor <= 0) return true;
        return now >= anchor + recoveryDelayMs(attempts);
    }

    private noteRefreshAttempts(markets: readonly JobMarketDefinition[], now: number): void {
        for (const market of markets) {
            const entry = this.snapshot?.markets.find((candidate) => candidate.marketKey === market.key);
            const state = classifyMarketReset(entry, now);
            if (state === 'future' && entry?.stale !== true) {
                this.recoveryByMarket.delete(market.key);
                continue;
            }
            const previous = this.recoveryByMarket.get(market.key);
            this.recoveryByMarket.set(market.key, {
                attempts: (previous?.attempts ?? 0) + 1,
                lastAttemptAt: now,
            });
        }
    }

    private recoveryAt(marketKey: string, now: number): number {
        const state = this.recoveryByMarket.get(marketKey);
        const attempts = state?.attempts ?? 0;
        const anchor = state?.lastAttemptAt ?? 0;
        return anchor > 0 ? anchor + recoveryDelayMs(attempts) : now + recoveryDelayMs(0);
    }

    async scheduleNextRefresh(): Promise<void> {
        const generation = ++this.scheduleGeneration;
        const run = this.scheduleQueue.then(
            () => this.applySchedule(generation),
            () => this.applySchedule(generation),
        );
        this.scheduleQueue = run.catch(() => undefined);
        await run;
    }

    private computeSchedule(current: SettingsV1, now: number): {
        readonly nextAt: number;
        readonly reason: AutoJobsRefreshReason;
        readonly when?: number;
        readonly delayInMinutes?: number;
        readonly periodInMinutes?: number;
        readonly markets: Readonly<Record<string, MarketResetState>>;
    } {
        const entries = JOB_MARKETS.map((market) => {
            const entry = this.snapshot?.markets.find((candidate) => candidate.marketKey === market.key);
            return { market, entry, state: classifyMarketReset(entry, now) };
        });
        const futureResetTimes = entries
            .filter(({ entry, state }) => state === 'future' && entry?.stale !== true)
            .map(({ entry }) => Date.parse(entry!.resetAt!))
            .filter((value) => Number.isFinite(value) && value > now);
        const recovery = entries.filter(({ state }) => state !== 'future');
        const intervalAt = now + current.autoJobsIntervalMinutes * 60_000;
        const futureResetAt = futureResetTimes.length > 0
            ? Math.min(...futureResetTimes) + AUTO_JOBS_RESET_GRACE_MS
            : null;
        const recoveryAt = recovery.length > 0
            ? Math.max(now + 1_000, Math.min(...recovery.map(({ market }) => this.recoveryAt(market.key, now))))
            : null;
        const marketStates = Object.fromEntries(entries.map(({ market, state }) => [market.key, state]));

        if (current.autoFinishEnabled && this.allMarketsCompletedForCurrentReset()) {
            return futureResetAt !== null
                ? { nextAt: futureResetAt, reason: 'reset', when: futureResetAt, markets: marketStates }
                : { nextAt: now + AUTO_JOBS_FALLBACK_REFRESH_MS, reason: 'fallback', when: now + AUTO_JOBS_FALLBACK_REFRESH_MS, markets: marketStates };
        }

        if (futureResetAt !== null && (recoveryAt === null || futureResetAt <= recoveryAt)) {
            if (futureResetAt <= intervalAt) {
                return { nextAt: futureResetAt, reason: 'reset', when: futureResetAt, markets: marketStates };
            }
            return {
                nextAt: intervalAt,
                reason: 'interval',
                delayInMinutes: current.autoJobsIntervalMinutes,
                periodInMinutes: current.autoJobsIntervalMinutes,
                markets: marketStates,
            };
        }
        if (recoveryAt !== null) {
            if (recoveryAt <= intervalAt) {
                return { nextAt: recoveryAt, reason: 'fallback', when: recoveryAt, markets: marketStates };
            }
            return {
                nextAt: intervalAt,
                reason: 'interval',
                delayInMinutes: current.autoJobsIntervalMinutes,
                periodInMinutes: current.autoJobsIntervalMinutes,
                markets: marketStates,
            };
        }
        return {
            nextAt: intervalAt,
            reason: 'interval',
            delayInMinutes: current.autoJobsIntervalMinutes,
            periodInMinutes: current.autoJobsIntervalMinutes,
            markets: marketStates,
        };
    }

    private async clearRepairAlarm(generation?: number): Promise<void> {
        if (generation !== undefined && generation !== this.scheduleGeneration) return;
        try {
            await this.deps.scheduler.clear(AUTO_JOBS_INFO_REPAIR_ALARM);
        } catch (error) {
            this.deps.logger.warn('auto-jobs', 'Failed to clear Auto Jobs repair alarm', {
                generation,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async scheduleRepairAlarm(generation: number): Promise<void> {
        if (generation !== this.scheduleGeneration) return;
        const now = this.deps.clock.now();
        const delay = repairDelayMs(this.repairAttempts);
        const repairAt = now + delay;
        this.nextRefreshAt = null;
        this.repairAt = repairAt;
        this.scheduleState = 'repair-pending';
        try {
            this.deps.scheduler.create(AUTO_JOBS_INFO_REPAIR_ALARM, { when: repairAt });
        } catch (error) {
            this.scheduleState = 'schedule-unavailable';
            this.repairAt = null;
            this.deps.logger.error('auto-jobs', 'Failed to create Auto Jobs repair alarm', {
                generation,
                attempt: this.repairAttempts + 1,
                repairAt,
                message: error instanceof Error ? error.message : String(error),
            });
            this.deps.events.publish('auto.jobs.schedule', {
                nextRefreshAt: null,
                reason: 'fallback',
                scheduleState: this.scheduleState,
                repairAt: null,
                generation,
            });
            return;
        }
        let confirmed = true;
        try {
            confirmed = (await this.deps.scheduler.get(AUTO_JOBS_INFO_REPAIR_ALARM)) !== null;
        } catch (error) {
            confirmed = false;
            this.deps.logger.warn('auto-jobs', 'Failed to confirm Auto Jobs repair alarm', {
                generation,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        if (!confirmed) {
            if (generation !== this.scheduleGeneration) return;
            this.scheduleState = 'schedule-unavailable';
            this.repairAt = null;
            this.deps.logger.error('auto-jobs', 'Auto Jobs repair alarm was not confirmed', { generation, repairAt });
            this.deps.events.publish('auto.jobs.schedule', {
                nextRefreshAt: null,
                reason: 'fallback',
                scheduleState: this.scheduleState,
                repairAt: null,
                generation,
            });
            return;
        }
        if (generation !== this.scheduleGeneration) return;
        this.repairAttempts += 1;
        this.deps.logger.warn('auto-jobs', 'Auto Jobs alarm repair scheduled', {
            generation,
            attempt: this.repairAttempts,
            repairAt,
            delayMs: delay,
        });
        this.deps.events.publish('auto.jobs.schedule', {
            nextRefreshAt: null,
            reason: 'fallback',
            scheduleState: this.scheduleState,
            repairAt,
            generation,
        });
    }

    async repairSchedule(): Promise<void> {
        if (this.scheduleState === 'scheduled') {
            await this.clearRepairAlarm();
            return;
        }
        this.scheduleState = 'repairing';
        this.repairAt = null;
        await this.scheduleNextRefresh();
    }

    private async applySchedule(generation: number): Promise<void> {
        try {
            const current = await this.deps.settings.get();
            if (generation !== this.scheduleGeneration) return;
            const now = this.deps.clock.now();
            if (current.helperMode || !current.autoJobsEnabled) {
                try {
                    await this.deps.scheduler.clear(AUTO_JOBS_INFO_ALARM);
                } catch (error) {
                    this.deps.logger.warn('auto-jobs', 'Failed to clear Auto Jobs alarm', {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
                if (generation !== this.scheduleGeneration) return;
                await this.clearRepairAlarm(undefined);
                this.nextRefreshAt = null;
                this.refreshReason = 'interval';
                this.scheduleState = 'disabled';
                this.repairAt = null;
                this.repairAttempts = 0;
                this.deps.events.publish('auto.jobs.schedule', { nextRefreshAt: null, reason: this.refreshReason, scheduleState: this.scheduleState, generation });
                return;
            }
            const plan = this.computeSchedule(current, now);
            if (generation !== this.scheduleGeneration) return;
            try {
                await this.deps.scheduler.clear(AUTO_JOBS_INFO_ALARM);
            } catch (error) {
                this.deps.logger.warn('auto-jobs', 'Failed to clear Auto Jobs alarm', {
                    generation,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            if (generation !== this.scheduleGeneration) return;
            const timing = plan.when !== undefined
                ? { when: plan.when }
                : { delayInMinutes: plan.delayInMinutes!, periodInMinutes: plan.periodInMinutes! };
            let created = false;
            for (let attempt = 1; attempt <= 2 && !created; attempt++) {
                if (generation !== this.scheduleGeneration) return;
                try {
                    this.deps.scheduler.create(AUTO_JOBS_INFO_ALARM, timing);
                    created = true;
                } catch (error) {
                    const level = attempt === 2 ? 'error' : 'warn';
                    this.deps.logger[level]('auto-jobs', 'Failed to create Auto Jobs alarm', {
                        generation,
                        attempt,
                        nextRefreshAt: plan.nextAt,
                        reason: plan.reason,
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            if (!created) {
                await this.scheduleRepairAlarm(generation);
                return;
            }
            let confirmed = true;
            try {
                confirmed = (await this.deps.scheduler.get(AUTO_JOBS_INFO_ALARM)) !== null;
            } catch (error) {
                confirmed = false;
                this.deps.logger.warn('auto-jobs', 'Failed to confirm Auto Jobs alarm', {
                    generation,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            if (!confirmed) {
                this.deps.logger.error('auto-jobs', 'Auto Jobs alarm was not confirmed', { generation, nextRefreshAt: plan.nextAt });
                await this.scheduleRepairAlarm(generation);
                return;
            }
            await this.clearRepairAlarm(generation);
            if (generation !== this.scheduleGeneration) return;
            this.nextRefreshAt = plan.nextAt;
            this.refreshReason = plan.reason;
            this.scheduleState = 'scheduled';
            this.repairAt = null;
            this.repairAttempts = 0;
            this.deps.events.publish('auto.jobs.schedule', {
                nextRefreshAt: this.nextRefreshAt,
                reason: this.refreshReason,
                scheduleState: this.scheduleState,
                generation,
                markets: plan.markets,
            });
        } catch (error) {
            this.deps.logger.error('auto-jobs', 'Failed to schedule Auto Jobs refresh', {
                generation,
                message: error instanceof Error ? error.message : String(error),
            });
            this.nextRefreshAt = null;
            await this.scheduleRepairAlarm(generation);
        }
    }

    allMarketsCompletedForCurrentReset(): boolean {
        const now = this.deps.clock.now();
        const snapshot = this.snapshot;
        if (!snapshot || snapshot.markets.length !== JOB_MARKETS.length) return false;
        const active = snapshot.markets.filter((market) =>
            market.ok && market.stale !== true && market.resetAt !== null && market.resetAt !== undefined
            && new Date(market.resetAt).getTime() > now,
        );
        if (active.length !== snapshot.markets.length) return false;
        if (this.autoFinish && !this.autoFinish.completionsAvailable()) return false;
        const completedByMarket = this.autoFinish?.completedJobsByMarketSnapshot() ?? { byMarket: {} };
        // Completion is tracked per market/job, not per job id alone. A market
        // can gain new jobs inside the same reset; those must still be processed.
        return active.every((market) => {
            const jobs = snapshot.jobs.filter((job) => job.marketKey === market.marketKey);
            return jobs.length > 0 && jobs.every((job) =>
                isCompletedForMarketReset(completedByMarket, market.marketKey, job.id, market.resetAt ?? null));
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
