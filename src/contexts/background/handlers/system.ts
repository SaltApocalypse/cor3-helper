import { z } from 'zod';
import { summarizeNetworkSnapshot } from '../../../application/network/snapshot-summary.js';
import { ok } from '../../../kernel/result.js';
import { PHASE, VERSION, isFreshLogEvent, type CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';
import { jobLocation } from '../automation/job-outcome.js';
import { isAutoDailyLoading, isAutoDailyWaiting } from '../automation/auto-daily.js';

export interface SystemHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

function autoJobsStageDetail(stage: string): { detail: string; progress: { index: number; total: number; label: string } | null } {
    if (stage === 'queued') return { detail: 'Queued', progress: null };
    if (stage === 'fetching-markets') return { detail: 'Fetching market information', progress: null };
    if (stage === 'publishing') return { detail: 'Publishing market snapshot', progress: null };
    if (stage === 'completing') return { detail: 'Completing jobs', progress: null };
    const marketMatch = /^market:(\d+)\/(\d+)$/.exec(stage);
    if (marketMatch) {
        const index = Number(marketMatch[1]);
        const total = Number(marketMatch[2]);
        return { detail: `Fetching market information (${index}/${total})`, progress: { index, total, label: 'Markets' } };
    }
    return { detail: stage === 'idle' ? 'Preparing' : stage, progress: null };
}

function buildActivityState(deps: SystemHandlerDeps) {
    const { automation } = deps;
    if (automation.autoFinish.isRunning()) {
        const progress = automation.autoFinish.progressValue();
        return {
            key: 'auto-finish' as const,
            label: 'Auto complete all jobs',
            detail: progress
                ? `Completing ${jobLocation(progress.jobName, progress.serverName)} (${progress.index}/${progress.total})`
                : 'Preparing job run',
            running: true,
            progress: progress ? { index: progress.index, total: progress.total, label: 'Jobs' } : null,
        };
    }
    if (automation.autoJobs.isRunning()) {
        const stage = autoJobsStageDetail(automation.autoJobs.stageName());
        return {
            key: 'auto-jobs' as const,
            label: 'Auto Jobs',
            detail: stage.detail,
            running: true,
            progress: stage.progress,
        };
    }
    if (automation.daily.isRunning()) {
        return { key: 'auto-daily' as const, label: 'Auto Daily', detail: 'Running daily task', running: true, progress: null };
    }
    if (automation.drone.isRunning()) {
        return { key: 'auto-drone' as const, label: 'Auto Drone', detail: 'Managing drone mission', running: true, progress: null };
    }
    if (automation.expedition.isRunning()) {
        return { key: 'auto-expedition' as const, label: 'Auto Expedition', detail: 'Managing expeditions', running: true, progress: null };
    }
    if (automation.mail.isRunning()) {
        return { key: 'auto-mail' as const, label: 'Mailbox collect', detail: 'Claiming mailbox rewards', running: true, progress: null };
    }
    const valuable = automation.valuable.activity();
    if (valuable) {
        return {
            key: 'valuable-seller' as const,
            label: valuable.operation === 'search' ? 'Valuable Search' : 'Valuable Sale',
            detail: valuable.progress
                ? `${valuable.progress.phase} (${valuable.progress.index}/${valuable.progress.total})`
                : valuable.operation === 'search' ? 'Searching valuable files' : 'Selling valuable files',
            running: true,
            progress: valuable.progress
                ? { index: valuable.progress.index, total: valuable.progress.total, label: valuable.operation === 'search' ? 'Servers' : 'Market items' }
                : null,
        };
    }
    const queue = deps.core.networkOps.status();
    if (queue.running) {
        return {
            key: 'network' as const,
            label: 'Network operation',
            detail: `${queue.running.owner}: ${queue.running.reason}`,
            running: true,
            progress: null,
        };
    }
    if (automation.autoRefresh.isRunning()) {
        return { key: 'auto-refresh' as const, label: 'Internal refresh', detail: 'Refreshing network map', running: true, progress: null };
    }
    return { key: 'idle' as const, label: 'Idle', detail: 'No automation is running', running: false, progress: null };
}

export async function buildSystemDiagnostics(deps: SystemHandlerDeps): Promise<Record<string, unknown>> {
    const { core, game, automation } = deps;
    const currentSettings = await core.settings.get();
    const snapshot = await game.snapshots.get();
    const authStatus = await core.auth.status();
    const dailyStatus = await automation.daily.status();
    return {
        version: VERSION,
        phase: PHASE,
        auth: authStatus,
        settings: currentSettings,
        network: snapshot.ok ? summarizeNetworkSnapshot(snapshot.value) : null,
        jobs: {
            queues: automation.queue.activeCount(),
            running: automation.queue.runningCount(),
        },
        autoFinish: { running: automation.autoFinish.isRunning(), last: automation.autoFinish.lastRun() },
        autoRefresh: { running: automation.autoRefresh.isRunning(), last: automation.autoRefresh.lastRun() },
        autoDrone: { running: automation.drone.isRunning(), last: automation.drone.lastRun() },
        autoExpedition: { running: automation.expedition.isRunning(), last: automation.expedition.lastRun() },
        autoMail: { running: automation.mail.isRunning(), last: automation.mail.lastRun() },
        autoDaily: {
            enabled: currentSettings.dailyHackEnabled,
            intervalMinutes: currentSettings.dailyHackIntervalMinutes,
            running: automation.daily.isRunning(),
            last: automation.daily.lastRun(),
            state: automation.daily.dailyState(),
            nextRunAt: automation.daily.nextRun().at,
            nextRunReason: automation.daily.nextRun().reason,
            alarmAt: dailyStatus.alarmAt,
        },
        autoJobs: {
            enabled: currentSettings.autoJobsEnabled,
            autoComplete: currentSettings.autoFinishEnabled,
            running: automation.autoJobs.isRunning(),
            stage: automation.autoJobs.stageName(),
            snapshotAt: automation.autoJobs.snapshotView()?.at ?? null,
            snapshotJobs: automation.autoJobs.snapshotView()?.jobs.length ?? 0,
            snapshotMarkets: automation.autoJobs.snapshotView()?.markets.length ?? 0,
            lastAttemptAt: automation.autoJobs.lastAttemptAtValue(),
            lastError: automation.autoJobs.lastErrorText(),
            lastSkipReason: automation.autoJobs.lastSkipReasonText(),
            marketDetails: automation.autoJobs.snapshotView()?.markets.map((market) => ({
                marketKey: market.marketKey,
                label: market.label,
                ok: market.ok,
                skipped: market.skipped,
                resetAt: market.resetAt ?? null,
                error: market.error ?? null,
                jobs: automation.autoJobs.snapshotView()?.jobs.filter((job) => job.marketKey === market.marketKey).length ?? 0,
            })) ?? [],
            bootstrapAt: automation.autoJobs.bootstrapAtValue(),
        },
        networkQueue: core.networkOps.status(),
        readiness: automation.readiness.summary(),
    };
}

export function registerSystemHandlers(server: CoreRuntime['server'], deps: SystemHandlerDeps): void {
    server.register('system.ping', z.object({}).strict(), async () => {
        void deps.automation.autoJobs.ensureInfo('popup-open');
        return ok({ version: VERSION, phase: PHASE });
    });
    server.register('system.updateCheck', z.object({}).strict(), async () => {
        const result = await deps.core.updateChecker.check(deps.core.appVersion());
        return result.ok ? ok(result.value) : { ok: false, error: result.error };
    });
    server.register('automation.logs', z.object({
        runId: z.string().min(1),
        limit: z.number().int().positive().max(500).default(300),
    }).strict(), async ({ runId, limit }) => {
        return ok(deps.core.runLogs.list(runId, limit));
    });
    server.register('system.diagnostics', z.object({}).strict(), async () => ok(await buildSystemDiagnostics(deps)));
    server.register('network.queueStatus', z.object({}).strict(), async () => ok(deps.core.networkOps.status()));
    server.register('network.readiness', z.object({}).strict(), async () => ok(deps.automation.readiness.summary()));
    server.register('activity.state', z.object({}).strict(), async () => ok(buildActivityState(deps)));
    server.register('overview.state', z.object({}).strict(), async () => {
        const { core, game, automation } = deps;
        const currentSettings = await core.settings.get();
        const snapshot = await game.snapshots.get();
        const authStatus = await core.auth.status();
        const autoFinishLast = automation.autoFinish.lastRun();
        const autoJobsStatus = await automation.autoJobs.status();
        const autoJobsLastAttemptAt = automation.autoJobs.lastAttemptAtValue();
        const droneLast = automation.drone.lastRun();
        const dailyLast = automation.daily.lastRun();
        const droneViewedAt = automation.drone.lastViewedAt();
        const expeditionLast = automation.expedition.lastRun();
        const expeditionViewedAt = automation.expedition.lastViewedAt();
        const valuable = automation.valuable;
        const timers = [
            ...(snapshot.ok
                ? [...snapshot.value.servers.values()]
                    .filter((server) => server.maintenance.active && server.maintenance.endsAt)
                    .map((server) => ({ kind: 'maintenance' as const, name: server.name, endsAt: server.maintenance.endsAt }))
                : []),
            ...((autoFinishLast?.markets ?? [])
                .filter((market) => market.ok && market.resetAt)
                .map((market) => ({ kind: 'jobs-reset' as const, name: market.label, endsAt: market.resetAt ?? null }))),
        ];
        return ok({
            auth: authStatus,
            network: snapshot.ok ? summarizeNetworkSnapshot(snapshot.value) : null,
            networkAgeMs: game.snapshots.getCachedAgeMs(),
            queue: core.networkOps.status(),
            readiness: automation.readiness.summary(),
            helperMode: currentSettings.helperMode,
            autoJobs: {
                nextRefreshAt: autoJobsStatus.nextRefreshAt,
                refreshReason: autoJobsStatus.refreshReason,
                scheduleState: autoJobsStatus.scheduleState,
                repairAt: autoJobsStatus.repairAt,
                lastRefreshAt: autoJobsStatus.lastRefreshAt,
                lastError: automation.autoJobs.lastErrorText(),
                lastSkipReason: automation.autoJobs.lastSkipReasonText(),
                lastAttemptAt: autoJobsLastAttemptAt,
            },
            automations: [
                {
                    key: 'auto-jobs',
                    label: 'Auto Jobs',
                    enabled: currentSettings.autoJobsEnabled,
                    running: automation.autoJobs.isRunning() || automation.autoFinish.isRunning(),
                    lastAt: autoJobsLastAttemptAt || autoFinishLast?.finishedAt || null,
                    lastError: automation.autoJobs.lastErrorText() ?? autoFinishLast?.failures[0]?.message ?? null,
                },
                {
                    key: 'auto-drone',
                    label: 'Auto Drone',
                    enabled: currentSettings.autoDroneEnabled,
                    running: automation.drone.isRunning(),
                    lastAt: droneLast?.at ?? null,
                    lastError: droneLast?.status === 'error' && droneLast.at > droneViewedAt ? droneLast.message : null,
                    waiting: droneLast?.status === 'waiting',
                },
                {
                    key: 'auto-expedition',
                    label: 'Auto Expedition',
                    enabled: currentSettings.autoExpeditionEnabled,
                    running: automation.expedition.isRunning(),
                    lastAt: expeditionLast?.at ?? null,
                    lastError: expeditionLast?.error && expeditionLast.at > expeditionViewedAt ? expeditionLast.error : null,
                },
                { key: 'auto-mail', label: 'Mailbox collect', enabled: currentSettings.mailAutoClaimEnabled, running: automation.mail.isRunning(), lastAt: automation.mail.lastRun()?.at ?? null, lastError: automation.mail.lastRun()?.error ?? null },
                { key: 'auto-daily', label: 'Auto Daily', enabled: currentSettings.dailyHackEnabled, running: automation.daily.isRunning(), lastAt: dailyLast?.at ?? null, lastError: dailyLast && !dailyLast.solved && !isAutoDailyWaiting(dailyLast) && !isAutoDailyLoading(dailyLast) ? dailyLast.message : null, waiting: isAutoDailyLoading(dailyLast) },
                { key: 'seller', label: 'Valuable Search & Sale', enabled: false, running: valuable.isRunning(), lastAt: null, lastError: valuable.lastError() },
            ],
            timers,
            jobReport: autoFinishLast,
        });
    });
    server.register('devtools.snapshot', z.object({}).strict(), async () => ok({
        diagnostics: await buildSystemDiagnostics(deps),
        logs: deps.core.logger.events().filter(isFreshLogEvent),
        bridgeLogs: deps.core.bridgeAudits.slice(-200),
    }));
}
