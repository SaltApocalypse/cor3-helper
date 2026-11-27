import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import type { Result } from '../../../kernel/result.js';
import { ok } from '../../../kernel/result.js';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { ValuableForceMaintenanceRequest, ValuableForceMaintenanceSummary, ValuableProgress, ValuableSaleSummary, ValuableSearchSummary, ValuableSellerService } from '../../../application/valuable/seller.js';
import type { MaintenanceSignalPort } from '../../../application/valuable/maintenance-monitor.js';
import { listMaintenanceServers, type ValuableMaintenanceServer } from '../../../application/valuable/maintenance.js';
import type { EventPublisher, RunLogSink } from '../../../application/automation/ports.js';

export type ValuableOperation = 'search' | 'sell' | 'force-maintenance';
export type ValuableRunStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface ValuableRunState {
    readonly runId: string;
    readonly operation: ValuableOperation;
    status: ValuableRunStatus;
    progress: ValuableProgress | null;
    error: string | null;
    updatedAt: number;
}

export interface ValuableStats {
    downloadedFiles: number;
    downloadedLogs: number;
    soldItems: number;
    credits: number;
    reputation: number;
    forcedServers: number;
    lastSearchAt: number | null;
    lastSellAt: number | null;
    lastForceAt: number | null;
}

export interface ValuableRunRequest {
    readonly runId: string;
    readonly owner: string;
}

export interface ValuableForceRunRequest extends ValuableForceMaintenanceRequest {
    readonly runId: string;
}

export interface ValuableDeps {
    readonly seller: ValuableSellerService;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly maintenance: MaintenanceSignalPort;
    readonly state: AutomationStateStore;
    readonly networkOps: NetworkOperationQueue;
    readonly events: EventPublisher;
    readonly runLogs: RunLogSink;
}

function numberFromPayload(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function runView(state: ValuableRunState) {
    return {
        runId: state.runId,
        operation: state.operation,
        status: state.status,
        progress: state.progress,
        error: state.error,
        updatedAt: state.updatedAt,
    };
}

export class ValuableCoordinator {
    private readonly runs = new Map<string, ValuableRunState>();
    private readonly cancelled = new Set<string>();
    private activeRunId: string | null = null;
    private stats: ValuableStats | null = null;

    constructor(private readonly deps: ValuableDeps) {}

    async runSearch(request: ValuableRunRequest): Promise<Result<ValuableSearchSummary, { readonly code: string; readonly message: string }>> {
        const begun = this.begin(request, 'search');
        if ('ok' in begun) return begun;
        const state = begun;
        this.deps.runLogs.add(request.runId, 'info', 'valuable-seller', 'Starting valuable search on every hackable server');
        try {
            const queued = await this.deps.networkOps.enqueue({ owner: request.owner, reason: 'valuable-search', priority: 60 }, async () => this.deps.seller.search({
                owner: request.owner,
                reason: 'valuable-search',
            }, this.runControl(request.runId, state)));
            if (!queued.ok) {
                state.status = 'error';
                state.error = queued.error.message;
                state.updatedAt = Date.now();
                this.deps.runLogs.add(request.runId, 'error', 'valuable-seller', `Valuable search failed: ${queued.error.message}`);
                return { ok: false, error: { code: queued.error.code, message: queued.error.message } };
            }
            const summary = queued.value as ValuableSearchSummary;
            state.status = summary.stopped ? 'cancelled' : 'done';
            state.updatedAt = Date.now();
            const stats = await this.loadStats();
            await this.saveStats({
                ...stats,
                downloadedFiles: stats.downloadedFiles + summary.downloadedFiles,
                downloadedLogs: stats.downloadedLogs + summary.downloadedLogs,
                lastSearchAt: Date.now(),
            });
            this.deps.runLogs.add(request.runId, 'info', 'valuable-seller', `Search finished: ${summary.downloadedFiles} file(s), ${summary.downloadedLogs} log(s), ${summary.serverFailures.length} server failure(s)${summary.stopped ? ' (stopped)' : ''}`);
            return { ok: true, value: summary };
        } finally {
            this.cancelled.delete(request.runId);
            if (this.activeRunId === request.runId) this.activeRunId = null;
        }
    }

    async runSell(request: ValuableRunRequest): Promise<Result<ValuableSaleSummary, { readonly code: string; readonly message: string }>> {
        const begun = this.begin(request, 'sell');
        if ('ok' in begun) return begun;
        const state = begun;
        this.deps.runLogs.add(request.runId, 'info', 'valuable-seller', 'Starting valuable sale across unlocked markets');
        try {
            const queued = await this.deps.networkOps.enqueue({ owner: request.owner, reason: 'valuable-sell', priority: 60 }, async () => this.deps.seller.sell({
                markets: this.markets(),
                owner: request.owner,
                reason: 'valuable-sell',
            }, this.runControl(request.runId, state)));
            if (!queued.ok) {
                state.status = 'error';
                state.error = queued.error.message;
                state.updatedAt = Date.now();
                this.deps.runLogs.add(request.runId, 'error', 'valuable-seller', `Valuable sale failed: ${queued.error.message}`);
                return { ok: false, error: { code: queued.error.code, message: queued.error.message } };
            }
            const summary = queued.value as ValuableSaleSummary;
            state.status = summary.stopped ? 'cancelled' : 'done';
            state.updatedAt = Date.now();
            const stats = await this.loadStats();
            await this.saveStats({
                ...stats,
                soldItems: stats.soldItems + summary.soldItems,
                credits: stats.credits + summary.credits,
                reputation: stats.reputation + summary.reputation,
                lastSellAt: Date.now(),
            });
            this.deps.runLogs.add(request.runId, 'info', 'valuable-seller', `Sale finished: sold ${summary.soldItems} item(s) for ${summary.credits} credits, ${summary.marketFailures.length} market failure(s)${summary.stopped ? ' (stopped)' : ''}`);
            return { ok: true, value: summary };
        } finally {
            this.cancelled.delete(request.runId);
            if (this.activeRunId === request.runId) this.activeRunId = null;
        }
    }

    cancel(runId: string): void {
        if (this.runs.get(runId)?.status === 'running') this.cancelled.add(runId);
    }

    /** Maintenance rows for the valuable-seller panel. */
    async maintenanceServers(force = false): Promise<Result<readonly ValuableMaintenanceServer[], { readonly code: string; readonly message: string }>> {
        const snapshot = await this.deps.snapshots.get(force);
        if (!snapshot.ok) return { ok: false, error: { code: snapshot.error.code, message: snapshot.error.message } };
        return ok(listMaintenanceServers(snapshot.value));
    }

    /** Called by the background messaging layer when the game reports maintenance. */
    recordMaintenance(serverId: string): void {
        this.deps.maintenance.record(serverId);
        this.deps.events.publish('valuable.maintenance', { serverId, at: Date.now() });
    }

    /**
     * Start a force-maintenance run and return immediately. The force loop can
     * take longer than a normal bridge request, so the UI follows progress via
     * `valuable.progress`/`valuable.report`.
     */
    async startForceMaintenance(
        request: ValuableForceRunRequest,
    ): Promise<Result<{ readonly runId: string }, { readonly code: string; readonly message: string }>> {
        const begun = this.begin(request, 'force-maintenance');
        if ('ok' in begun) return begun;
        const state = begun;
        this.deps.runLogs.add(request.runId, 'info', 'valuable-seller', `Starting force maintenance on ${request.serverIds.length} selected server(s)`);
        void this.executeForce(request, state);
        return ok({ runId: request.runId });
    }

    private async executeForce(request: ValuableForceRunRequest, state: ValuableRunState): Promise<void> {
        try {
            const queued = await this.deps.networkOps.enqueue(
                { owner: request.owner, reason: 'valuable-force-maintenance', priority: 60 },
                async () => this.deps.seller.forceMaintenance({
                    owner: request.owner,
                    reason: 'valuable-force-maintenance',
                    serverIds: request.serverIds,
                    includeDownloads: request.includeDownloads,
                }, this.runControl(request.runId, state)),
            );
            if (!queued.ok) {
                state.status = 'error';
                state.error = queued.error.message;
                state.updatedAt = Date.now();
                this.deps.runLogs.add(request.runId, 'error', 'valuable-seller', `Force maintenance failed: ${queued.error.message}`);
                return;
            }
            const summary = queued.value as ValuableForceMaintenanceSummary;
            const stats = await this.loadStats();
            await this.saveStats({
                ...stats,
                downloadedFiles: stats.downloadedFiles + summary.downloadedFiles,
                downloadedLogs: stats.downloadedLogs + summary.downloadedLogs,
                forcedServers: stats.forcedServers + summary.forcedServers,
                lastForceAt: Date.now(),
            });
            state.status = summary.stopped
                ? 'cancelled'
                : summary.forcedServers === 0 && summary.failedServers.length > 0 ? 'error' : 'done';
            if (state.status === 'error') {
                state.error = summary.failedServers[0]?.message ?? 'No selected server entered maintenance';
            }
            state.updatedAt = Date.now();
            this.deps.runLogs.add(
                request.runId,
                summary.failedServers.length > 0 ? 'warn' : 'info',
                'valuable-seller',
                `Force maintenance finished: ${summary.forcedServers} server(s) forced, ${summary.failedServers.length} failed${summary.stopped ? ' (stopped)' : ''}`,
            );
        } catch (error) {
            state.status = 'error';
            state.error = error instanceof Error ? error.message : String(error);
            state.updatedAt = Date.now();
            this.deps.runLogs.add(request.runId, 'error', 'valuable-seller', `Force maintenance error: ${state.error}`);
        } finally {
            this.cancelled.delete(request.runId);
            if (this.activeRunId === request.runId) this.activeRunId = null;
        }
    }

    progress(runId: string) {
        const state = this.runs.get(runId);
        return state ? runView(state) : null;
    }

    async report() {
        const stats = await this.loadStats();
        const downloaded = stats.downloadedFiles + stats.downloadedLogs;
        return {
            ...stats,
            unsoldItems: Math.max(0, downloaded - stats.soldItems),
            active: this.activeView(),
        };
    }

    activity(): { readonly operation: ValuableOperation; readonly progress: ValuableProgress | null } | null {
        if (!this.activeRunId) return null;
        const state = this.runs.get(this.activeRunId);
        if (!state || state.status !== 'running') return null;
        return { operation: state.operation, progress: state.progress };
    }

    isRunning(): boolean {
        return this.activeRunId !== null;
    }

    lastError(): string | null {
        return [...this.runs.values()].find((state) => state.error)?.error ?? null;
    }

    private activeView(): ReturnType<typeof runView> | null {
        if (!this.activeRunId) return null;
        const state = this.runs.get(this.activeRunId);
        return state && state.status === 'running' ? runView(state) : null;
    }

    private markets() {
        return [...JOB_MARKETS].reverse().map((market) => ({
            label: market.label,
            marketId: market.marketId,
            routeServerId: market.routeServerId,
        }));
    }

    private begin(request: ValuableRunRequest, operation: ValuableOperation): ValuableRunState | { ok: false; error: { code: string; message: string } } {
        if (this.activeRunId !== null) {
            const active = this.runs.get(this.activeRunId);
            return {
                ok: false,
                error: {
                    code: 'VALUABLE_BUSY',
                    message: active ? `Valuable ${active.operation} is already running` : 'Another valuable operation is already running',
                },
            };
        }
        const state: ValuableRunState = {
            runId: request.runId,
            operation,
            status: 'running',
            progress: null,
            error: null,
            updatedAt: Date.now(),
        };
        this.runs.set(request.runId, state);
        this.cancelled.delete(request.runId);
        this.activeRunId = request.runId;
        while (this.runs.size > 20) {
            const oldest = this.runs.keys().next().value;
            if (!oldest || oldest === this.activeRunId) break;
            this.runs.delete(oldest);
        }
        return state;
    }

    private runControl(runId: string, state: ValuableRunState) {
        return {
            shouldStop: () => this.cancelled.has(runId),
            onProgress: (progress: ValuableProgress) => {
                state.progress = progress;
                state.updatedAt = Date.now();
                this.deps.events.publish('valuable.progress', { runId, progress });
            },
        };
    }

    private async loadStats(): Promise<ValuableStats> {
        if (this.stats) return this.stats;
        const state = await this.deps.state.get('valuable-stats');
        const payload = state.payload;
        this.stats = {
            downloadedFiles: numberFromPayload(payload.downloadedFiles),
            downloadedLogs: numberFromPayload(payload.downloadedLogs),
            soldItems: numberFromPayload(payload.soldItems),
            credits: numberFromPayload(payload.credits),
            reputation: numberFromPayload(payload.reputation),
            forcedServers: numberFromPayload(payload.forcedServers),
            lastSearchAt: typeof payload.lastSearchAt === 'number' ? payload.lastSearchAt : null,
            lastSellAt: typeof payload.lastSellAt === 'number' ? payload.lastSellAt : null,
            lastForceAt: typeof payload.lastForceAt === 'number' ? payload.lastForceAt : null,
        };
        return this.stats;
    }

    private async saveStats(stats: ValuableStats): Promise<void> {
        this.stats = stats;
        await this.deps.state.set('valuable-stats', { payload: { ...stats } });
    }
}
