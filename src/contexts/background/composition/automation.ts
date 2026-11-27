import { JobExecutionService } from '../../../application/auto-job/execution-service.js';
import { AutoJobRunner } from '../../../application/auto-job/runner.js';
import { AutoJobQueueService } from '../../../application/auto-job/queue.js';
import { decryptFileType } from '../../../domains/jobs/model.js';
import { err, ok } from '../../../kernel/result.js';
import type { CoreRuntime } from './core.js';
import type { GameRuntime } from './game.js';
import { ChromeScheduler } from './chrome-scheduler.js';
import { JobLockRegistry } from '../automation/job-locks.js';
import { JobHistoryRecorder } from '../automation/job-outcome.js';
import { JobStateRecorder } from '../../../application/auto-job/job-state-recorder.js';
import { JobStateReconciler } from '../../../application/auto-job/job-state-reconciler.js';
import { jobActiveKey } from '../../../contracts/job-state.js';
import { JobRouting } from '../automation/job-routing.js';
import { JobPreflight } from '../automation/job-preflight.js';
import { JobMarketSync } from '../automation/job-market-sync.js';
import { ValuableCoordinator } from '../automation/valuable.js';
import { AutoRefreshCoordinator } from '../automation/auto-refresh.js';
import { AutoJobsCoordinator } from '../automation/auto-jobs.js';
import { AutoFinishCoordinator } from '../automation/auto-finish.js';
import { FailedJobDismisser } from '../automation/dismiss-failed.js';
import { JobQueueCoordinator } from '../automation/job-queue.js';
import { AutoMailCoordinator } from '../automation/auto-mail.js';
import { AutoDroneCoordinator } from '../automation/auto-drone.js';
import { AutoExpeditionCoordinator } from '../automation/auto-expedition.js';
import { DailyOpsCacheService } from '../automation/daily-cache.js';
import { AutoDailyCoordinator } from '../automation/auto-daily.js';
import { ReadinessRegistry } from '../automation/readiness.js';
import { PageReloadCoordinator } from '../automation/page-reload.js';
import { InventorySortLock } from '../automation/inventory-lock.js';
import { humanDelay } from '../automation/delay.js';

export interface AutomationRuntime {
    readonly scheduler: ChromeScheduler;
    readonly locks: JobLockRegistry;
    readonly history: JobHistoryRecorder;
    readonly jobStates: JobStateRecorder;
    readonly routing: JobRouting;
    readonly preflight: JobPreflight;
    readonly markets: JobMarketSync;
    readonly valuable: ValuableCoordinator;
    readonly autoRefresh: AutoRefreshCoordinator;
    readonly queue: JobQueueCoordinator;
    readonly autoJobs: AutoJobsCoordinator;
    readonly autoFinish: AutoFinishCoordinator;
    readonly mail: AutoMailCoordinator;
    readonly drone: AutoDroneCoordinator;
    readonly expedition: AutoExpeditionCoordinator;
    readonly dailyCache: DailyOpsCacheService;
    readonly daily: AutoDailyCoordinator;
    readonly readiness: ReadinessRegistry;
    readonly pageReload: PageReloadCoordinator;
    readonly inventoryLock: InventorySortLock;
    readonly autoJobsRunner: AutoJobRunner;
    readonly autoJobsQueue: AutoJobQueueService;
}

export function createAutomationRuntime(core: CoreRuntime, game: GameRuntime): AutomationRuntime {
    const { logger, runLogs, events, settings, stores, networkOps, tabs } = core;
    const clock = { now: () => Date.now() };
    const scheduler = new ChromeScheduler();
    const locks = new JobLockRegistry(stores.automationState, () => clock.now());
    const history = new JobHistoryRecorder(stores.jobHistory);
    let autoFinishRef: AutoFinishCoordinator | null = null;
    let queueRef: JobQueueCoordinator | null = null;
    let autoJobsRef: AutoJobsCoordinator | null = null;
    let autoJobsRunnerRef: AutoJobRunner | null = null;
    const resetAtForMarket = (marketKey: string): string | null => {
        const market = autoJobsRef?.snapshotView()?.markets.find((entry) => entry.marketKey === marketKey);
        return market?.ok && market.stale !== true && typeof market.resetAt === 'string' && market.resetAt.length > 0
            ? market.resetAt
            : null;
    };
    const jobStates = new JobStateRecorder({
        store: stores.jobState,
        logger,
        now: () => clock.now(),
        resetAtForMarket,
    });
    const jobStateReconciler = new JobStateReconciler({
        store: stores.jobState,
        writer: jobStates,
        completions: stores.marketCompletedJobs,
        logger,
        now: () => clock.now(),
        isActive: (key) => {
            const activeKey = jobActiveKey(key.marketKey, key.jobId);
            const progress = autoFinishRef?.progressValue();
            return autoJobsRunnerRef?.activeJobKeys().has(activeKey) === true
                || queueRef?.activeJobKeys().has(activeKey) === true
                || (progress !== null && progress !== undefined && jobActiveKey(progress.marketKey, progress.jobId) === activeKey);
        },
    });

    const routing = new JobRouting({
        snapshots: game.snapshots,
        endpointCommands: game.endpointCommands,
        endpointMutex: game.endpointMutex,
        routeExecutor: game.routeExecutor,
        serverAccess: game.serverAccess,
        tabs,
        logger,
    });
    const preflight = new JobPreflight({
        snapshots: game.snapshots,
        loadout: game.loadout,
        locks,
        access: game.serverAccess,
        logger,
        now: () => clock.now(),
    });
    const markets = new JobMarketSync({
        snapshots: game.snapshots,
        marketSync: game.marketSync,
        marketCache: stores.marketCache,
        routing,
        tabs,
        events,
        logger,
        reconciler: jobStateReconciler,
        completions: stores.marketCompletedJobs,
        onCompletionsChanged: (state) => autoFinishRef?.applyCompletedByMarket(state),
        now: () => clock.now(),
        humanDelay,
    });

    const valuable = new ValuableCoordinator({
        seller: game.valuableSeller,
        snapshots: game.snapshots,
        maintenance: game.maintenanceMonitor,
        state: stores.automationState,
        networkOps,
        events,
        runLogs,
        logger,
    });

    const autoRefresh = new AutoRefreshCoordinator({
        snapshots: game.snapshots,
        networkOps,
        settings,
        clock,
    });

    const inventoryLock = new InventorySortLock();
    const mail = new AutoMailCoordinator({
        settings,
        scheduler,
        logger,
        clock,
        state: stores.automationState,
        mail: game.mailService,
        isInventorySorting: () => inventoryLock.isSorting(),
    });


    const drone = new AutoDroneCoordinator({
        settings,
        scheduler,
        logger,
        clock,
        state: stores.automationState,
        droneAuto: game.droneAuto,
        featureAvailability: stores.featureAvailability,
        runAutoMail: () => mail.run(),
    });

    const expedition = new AutoExpeditionCoordinator({
        settings,
        scheduler,
        logger,
        clock,
        events,
        state: stores.automationState,
        snapshots: game.snapshots,
        service: game.expeditionService,
        configCache: stores.expeditionConfigCache,
        marketCache: stores.marketCache,
        marketSync: markets,
        routing,
        runAutoMail: () => mail.run(),
    });

    const dailyCache = new DailyOpsCacheService({
        adapter: game.dailyOpsAdapter,
        store: stores.dailyOpsCache,
        clock,
    });
    const daily = new AutoDailyCoordinator({
        settings,
        scheduler,
        events,
        logger,
        clock,
        state: stores.automationState,
        adapter: game.dailyOpsAdapter,
        cache: dailyCache,
        networkOps,
    });

    const jobExecution = new JobExecutionService(
        game.jobActions,
        (job) => routing.routeJobToMarket(job, 'complete'),
        async (job, file, requiredPower = 0) => {
            const target = decryptFileType(job, file.name, { preferFileName: true });
            if (!target) return ok(undefined);
            // Target is known, so use the same targeted best-power plan as the
            // Loadout page. `fallbackToAnyAbility` is intentionally not used:
            // a DECRYPT module that does not list `.xvct` cannot decrypt it.
            const result = await game.loadout.ensure({
                ability: 'DECRYPT',
                target,
                requiredPower,
                strategy: 'best',
                // A failed analysis tells us the current power, not the real
                // requirement. Select the strongest attainable plan instead of
                // keeping hardware that merely satisfies `requiredPower`.
                requirement: 'unknown',
            });
            if (result.ok) {
                logger.info('auto-job', 'Decrypt loadout ready', {
                    target,
                    requiredPower,
                    requirementSource: requiredPower === undefined ? 'unknown' : 'derived-from-current',
                    power: result.value.power,
                    feasible: result.value.feasible,
                    switchCost: result.value.switchCost,
                    software: result.value.software.name,
                    cpu: result.value.hardware.cpu.name,
                    gpu: result.value.hardware.gpu.name,
                    psu: result.value.hardware.psu.name,
                });
                return ok(undefined);
            }
            logger.warn('loadout', `Decrypt loadout failed for ${target} (${result.error.code}): ${result.error.message}`, {
                target,
                requiredPower,
                code: result.error.code,
                message: result.error.message,
            });
            if (result.error.code === 'NO_PLAN' || result.error.code === 'INFEASIBLE') {
                return err({ code: 'DECRYPT_POWER_INSUFFICIENT', message: result.error.message, stage: 'loadout' });
            }
            return err({
                code: 'ACTION_FAILED',
                message: `Decrypt loadout: ${result.error.message}`,
                retryable: true,
                stage: 'loadout',
            });
        },
        game.minigames,
        (job) => routing.routeJobToMarket(job, 'take'),
        (job) => routing.routeJobToTarget(job),
        (job) => routing.refreshJobAfterTake(job),
        (job) => preflight.preflight(job),
        () => autoFinishRef?.isCancelRequested() === true || queueRef?.hasPendingCancellation() === true,
        () => humanDelay(),
        (message, data) => logger.info('auto-job', message, data),
        undefined,
        jobStates,
        undefined,
        stores.marketCompletedJobs,
        stores.jobState,
        resetAtForMarket,
    );
    const autoJobsRunner = new AutoJobRunner(jobExecution);
    autoJobsRunnerRef = autoJobsRunner;
    const autoJobsQueue = new AutoJobQueueService(autoJobsRunner);

    const queue = new JobQueueCoordinator({
        settings,
        events,
        runLogs,
        clock,
        networkOps,
        queue: autoJobsQueue,
        snapshots: game.snapshots,
        markets,
        history,
    });
    queueRef = queue;

    const autoFinish = new AutoFinishCoordinator({
        settings,
        scheduler,
        events,
        logger,
        runLogs,
        clock,
        store: stores.autoFinish,
        completions: stores.marketCompletedJobs,
        jobStates: stores.jobState,
        locks,
        history,
        queue: autoJobsQueue,
        markets,
        snapshots: game.snapshots,
        networkOps,
        humanDelay,
    });
    autoFinishRef = autoFinish;

    const autoJobs = new AutoJobsCoordinator({
        settings,
        scheduler,
        events,
        logger,
        runLogs,
        clock,
        store: stores.autoJobsSnapshot,
        locks,
        markets,
        networkOps,
        tabs,
        isAutoRefreshRunning: () => autoRefresh.isRunning(),
    });
    autoJobs.attachAutoFinish(autoFinish);
    autoFinish.attachAutoJobs(autoJobs);
    autoJobsRef = autoJobs;

    const dismisser = new FailedJobDismisser({
        snapshots: game.snapshots,
        marketSync: game.marketSync,
        service: game.dismissFailedJobs,
        publishSnapshot: (update) => autoJobs.publishSnapshot(update),
        runLogs,
        now: () => clock.now(),
    });
    autoJobs.attachDismisser(dismisser);
    queue.attachDismisser((owner, reason, marketKeys, shouldStop, runId, skipIds) =>
        autoJobs.dismissFailedJobs(owner, reason, marketKeys, shouldStop, runId, skipIds));

    const pageReload = new PageReloadCoordinator({
        tabs,
        settings,
        state: stores.automationState,
        autoJobs,
        autoFinish,
        logger,
        events,
        clock,
    });

    const readiness = new ReadinessRegistry({
        adapter: game.gameReadinessAdapter,
        tabs,
        settings,
        events,
        autoJobs,
        syncAutoSolvers: core.syncAutoSolvers,
        onReady: (tabId) => {
            game.loadout.invalidate();
            void pageReload.handleGameReady(tabId);
        },
    });

    return {
        scheduler,
        locks,
        history,
        jobStates,
        routing,
        preflight,
        markets,
        valuable,
        autoRefresh,
        queue,
        autoJobs,
        autoFinish,
        mail,
        drone,
        expedition,
        dailyCache,
        daily,
        readiness,
        pageReload,
        inventoryLock,
        autoJobsRunner,
        autoJobsQueue,
    };
}
