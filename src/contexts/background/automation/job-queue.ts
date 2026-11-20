import type { JobOffer } from '../../../domains/jobs/model.js';
import { jobActiveKey } from '../../../contracts/job-state.js';
import type { AutoJobProgress, AutoJobQueueFailure, AutoJobQueueService } from '../../../application/auto-job/queue.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { EventPublisher, RunLogSink, SettingsPort } from '../../../application/automation/ports.js';
import type { Result } from '../../../kernel/result.js';
import { humanDelay } from './delay.js';
import type { JobHistoryRecorder } from './job-outcome.js';
import { jobFailureView, jobLocation } from './job-outcome.js';
import type { JobMarketSync } from './job-market-sync.js';
import { buildServerPriority } from './server-priority.js';
import type { DismissFailedJobsSummary } from './dismiss-failed.js';

export type JobQueueRunStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface JobQueueRunState {
    readonly runId: string;
    status: JobQueueRunStatus;
    progress: AutoJobProgress | null;
    done: readonly string[];
    failed: readonly AutoJobQueueFailure[];
    error: string | null;
    updatedAt: number;
}

export interface JobQueueRunRequest {
    readonly runId: string;
    readonly jobs: readonly JobOffer[];
    readonly owner: string;
    readonly completedIds?: readonly string[];
    readonly supportedTypes?: readonly string[];
}

export interface JobQueueDeps {
    readonly settings: SettingsPort;
    readonly events: EventPublisher;
    readonly runLogs: RunLogSink;
    readonly clock: { now(): number };
    readonly networkOps: Pick<NetworkOperationQueue, 'enqueue'>;
    readonly queue: AutoJobQueueService;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly markets: Pick<JobMarketSync, 'refreshCachedOptions'>;
    readonly history: JobHistoryRecorder;
    readonly dismissFailedJobs?: DismissFailedJobsFn;
}

export type DismissFailedJobsFn = (
    owner: string,
    reason: string,
    marketKeys?: readonly string[],
    shouldStop?: () => boolean,
    runId?: string,
    skipIds?: ReadonlySet<string>,
) => Promise<DismissFailedJobsSummary>;

export interface JobQueueResult {
    readonly stopped: boolean;
    readonly done: readonly string[];
    readonly failed: readonly ReturnType<typeof jobFailureView>[];
}

/** Sole owner of job queue run state and cancellation. */
export class JobQueueCoordinator {
    private readonly runs = new Map<string, JobQueueRunState>();
    private readonly cancelled = new Set<string>();
    private dismisser: DismissFailedJobsFn | null = null;

    constructor(private readonly deps: JobQueueDeps) {}

    attachDismisser(dismisser: DismissFailedJobsFn): void {
        this.dismisser = dismisser;
    }

    activeCount(): number {
        return this.runs.size;
    }

    runningCount(): number {
        return [...this.runs.values()].filter((state) => state.status === 'running').length;
    }

    /** Active executions keyed by market + job id. */
    activeJobKeys(): ReadonlySet<string> {
        const keys = new Set<string>();
        for (const state of this.runs.values()) {
            if (state.status === 'running' && state.progress) {
                keys.add(jobActiveKey(state.progress.marketKey, state.progress.jobId));
            }
        }
        return keys;
    }

    cancel(runId: string): void {
        if (this.runs.get(runId)?.status === 'running') this.cancelled.add(runId);
    }

    hasPendingCancellation(): boolean {
        return this.cancelled.size > 0;
    }

    progress(runId: string) {
        const state = this.runs.get(runId) ?? null;
        return state ? {
            runId: state.runId,
            status: state.status,
            progress: state.progress,
            done: state.done,
            failed: state.failed.map(jobFailureView),
            error: state.error,
            updatedAt: state.updatedAt,
        } : null;
    }

    async run(request: JobQueueRunRequest): Promise<Result<JobQueueResult, { readonly code: string; readonly message: string }>> {
        const state: JobQueueRunState = {
            runId: request.runId,
            status: 'running',
            progress: null,
            done: [],
            failed: [],
            error: null,
            updatedAt: this.deps.clock.now(),
        };
        this.runs.set(request.runId, state);
        this.deps.runLogs.add(request.runId, 'info', 'job-queue', `Queue started with ${request.jobs.length} job(s)`);
        this.cancelled.delete(request.runId);
        while (this.runs.size > 20) {
            const oldest = this.runs.keys().next().value;
            if (!oldest) break;
            this.runs.delete(oldest);
        }
        const serverPriority = await buildServerPriority(this.deps.snapshots);
        const completedMarketIds = new Set<string>();
        const queued = await this.deps.networkOps.enqueue({ owner: request.owner, reason: `job-queue:${request.runId}`, priority: 90 }, async () => ({
            ok: true as const,
            value: await this.deps.queue.run(request.jobs, {
                owner: request.owner,
                ...(request.completedIds ? { completedIds: new Set(request.completedIds) } : {}),
                ...(request.supportedTypes ? { supportedTypes: new Set(request.supportedTypes) } : {}),
                serverPriority,
                shouldStop: () => this.cancelled.has(request.runId),
                betweenJobs: () => humanDelay(2000, 3500),
                onProgress: (progress) => {
                    state.progress = progress;
                    state.updatedAt = this.deps.clock.now();
                    this.deps.runLogs.add(request.runId, 'info', 'job-queue', `Running ${jobLocation(progress.jobName, progress.serverName)} (${progress.index}/${progress.total})`);
                    this.deps.events.publish('job.queue.progress', { runId: request.runId, progress });
                },
                onJobResult: (job, jobResult) => {
                    if (!jobResult.ok) return;
                    this.deps.runLogs.add(request.runId, 'info', 'job-queue', `Completed ${jobLocation(job.name, job.serverName)}`);
                    completedMarketIds.add(job.marketId);
                },
            }),
        }));
        if (!queued.ok) {
            state.status = 'error';
            state.error = queued.error.message;
            state.updatedAt = this.deps.clock.now();
            this.deps.runLogs.add(request.runId, 'error', 'job-queue', `Queue failed before running: ${queued.error.message}`);
            return { ok: false, error: { code: queued.error.code, message: queued.error.message } };
        }
        const result = queued.value;
        for (const [index, marketId] of [...completedMarketIds].entries()) {
            await this.deps.markets.refreshCachedOptions(marketId);
            if (index < completedMarketIds.size - 1) await humanDelay(350, 700);
        }
        for (const failure of result.failed) {
            this.deps.runLogs.add(request.runId, 'warn', 'job-queue', `${failure.job.name}: ${failure.error.code} — ${failure.error.message}`);
        }
        this.deps.runLogs.add(request.runId, 'info', 'job-queue', `Queue finished: ${result.done.length} done, ${result.failed.length} failed${result.stopped ? ' (stopped)' : ''}`);
        state.done = result.done.map((job) => job.id);
        state.failed = result.failed;
        state.status = result.stopped ? 'cancelled' : 'done';
        state.updatedAt = this.deps.clock.now();
        await this.deps.history.record(result.done, result.failed);
        const currentSettings = await this.deps.settings.get();
        if (currentSettings.autoDismissFailedJobsEnabled && !result.stopped) {
            if (!this.dismisser) {
                this.deps.runLogs.add(request.runId, 'warn', 'dismiss-failed', 'Auto dismiss is enabled but no dismisser is attached');
            } else {
                try {
                    const dismisser = this.dismisser;
                    const summary = await dismisser(request.owner, 'dismiss-failed', undefined, () => this.cancelled.has(request.runId), request.runId);
                    this.deps.runLogs.add(request.runId, 'info', 'dismiss-failed',
                        `Auto dismiss complete: ${summary.dismissed} dismissed, ${summary.failed} failed`);
                } catch (error) {
                    this.deps.runLogs.add(request.runId, 'error', 'dismiss-failed', `Auto dismiss crashed: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        this.cancelled.delete(request.runId);
        return {
            ok: true,
            value: {
                stopped: result.stopped,
                done: state.done,
                failed: result.failed.map(jobFailureView),
            },
        };
    }
}
