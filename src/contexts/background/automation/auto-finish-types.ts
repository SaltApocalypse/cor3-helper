import type { AutoFinishLastRun, AutoFinishMarketResult } from '../../../contracts/auto-finish.js';
import type { AutoJobsSnapshot } from '../../../contracts/auto-jobs.js';
import type { AutoJobProgress, AutoJobQueueService } from '../../../application/auto-job/queue.js';
import type { AutoFinishStateStore } from '../../../infrastructure/storage/auto-finish-state-store.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger, EventPublisher, RunLogSink, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { DismissFailedJobsSummary } from './dismiss-failed.js';
import type { JobHistoryRecorder } from './job-outcome.js';
import type { JobLockRegistry } from './job-locks.js';
import type { JobMarketSync } from './job-market-sync.js';

export interface AutoFinishLiveRun {
    readonly runId: string;
    readonly startedAt: number;
    readonly markets: readonly AutoFinishMarketResult[];
}

export interface AutoJobsSink {
    publishSnapshot(update: AutoJobsSnapshot): void;
    scheduleNextRefresh(): Promise<void>;
    dismissFailedJobs(
        owner: string,
        reason: string,
        marketKeys?: readonly string[],
        shouldStop?: () => boolean,
        runId?: string,
        skipIds?: ReadonlySet<string>,
    ): Promise<DismissFailedJobsSummary>;
}

export interface AutoFinishDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly events: EventPublisher;
    readonly logger: AutomationLogger;
    readonly runLogs: RunLogSink;
    readonly clock: { now(): number };
    readonly store: AutoFinishStateStore;
    readonly locks: JobLockRegistry;
    readonly history: JobHistoryRecorder;
    readonly queue: AutoJobQueueService;
    readonly markets: JobMarketSync;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly networkOps: Pick<import('../../../application/network/operation-queue.js').NetworkOperationQueue, 'enqueue'>;
    readonly humanDelay?: (minMs?: number, maxMs?: number) => Promise<void>;
}

export interface AutoFinishStatus {
    readonly enabled: boolean;
    readonly running: boolean;
    readonly currentRunId: string | null;
    readonly live: AutoFinishLiveRun | null;
    readonly last: AutoFinishLastRun | null;
    readonly progress: AutoJobProgress | null;
    readonly nextRetryAt: number | null;
    readonly retryReason: string | null;
}
