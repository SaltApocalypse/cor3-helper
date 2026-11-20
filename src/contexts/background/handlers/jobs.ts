import { z } from 'zod';
import { jobOfferSchema } from '../../../contracts/jobs.js';
import { JOB_MARKETS } from '../../../domains/jobs/markets.js';
import { ok } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { GameRuntime } from '../composition/game.js';
import type { AutomationRuntime } from '../composition/automation.js';

export interface JobsHandlerDeps {
    readonly core: CoreRuntime;
    readonly game: GameRuntime;
    readonly automation: AutomationRuntime;
}

const jobCommandSchema = z.object({ marketId: z.string().min(1), jobId: z.string().min(1) }).strict();

const dismissFailedSchema = z.object({
    marketKey: z.enum(['home', 'dark', 'soyuz', 'usol']).optional(),
    owner: z.string().min(1).default('auto-dismiss'),
}).strict();

const jobMarketSchema = z.object({
    marketId: z.string().min(1),
    marketKey: z.string().min(1),
    serverId: z.string().min(1),
    owner: z.string().min(1).default('auto-job'),
    reason: z.string().min(1).default('job-market-sync'),
}).strict();

const allMarketsSchema = z.object({
    owner: z.string().min(1).default('auto-job'),
    reason: z.string().min(1).default('job-market-sync-all'),
}).strict();

const autoJobSchema = z.object({
    job: jobOfferSchema,
    owner: z.string().min(1).default('auto-job'),
}).strict();

const autoJobQueueSchema = z.object({
    runId: z.string().min(1),
    jobs: z.array(jobOfferSchema).max(200),
    owner: z.string().min(1).default('auto-job'),
    completedIds: z.array(z.string().min(1)).optional(),
    supportedTypes: z.array(z.string().min(1)).optional(),
}).strict();

export function registerJobHandlers(server: CoreRuntime['server'], deps: JobsHandlerDeps): void {
    const { core, game, automation } = deps;
    server.register('job.take', jobCommandSchema, async ({ marketId, jobId }) => {
        const result = await game.jobCommands.take(marketId, jobId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('job.complete', jobCommandSchema, async ({ marketId, jobId }) => {
        const market = JOB_MARKETS.find((entry) => entry.marketId === marketId);
        if (!market) {
            return { ok: false, error: { code: 'INVALID_JOB', message: 'Unknown job market' } };
        }
        const marketState = automation.autoJobs.snapshotView()?.markets.find((entry) => entry.marketKey === market.key);
        let resetAt = marketState?.ok && marketState.stale !== true
            && typeof marketState.resetAt === 'string' && marketState.resetAt.length > 0
            ? marketState.resetAt
            : null;
        try {
            const resolved = await automation.autoFinish.resolveDirectReset(market.key, jobId, resetAt);
            if (!resolved.ok) return { ok: false, error: resolved.error };
            resetAt = resolved.resetAt;
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: 'COMPLETE_BARRIER_UNAVAILABLE',
                    message: `Completion barrier unavailable: ${error instanceof Error ? error.message : String(error)}`,
                },
            };
        }
        try {
            if (await automation.autoFinish.isCompletionBlocked(market.key, jobId, resetAt)) {
                return { ok: false, error: { code: 'COMPLETE_BLOCKED', message: 'Completion is blocked by an earlier unconfirmed Complete result' } };
            }
        } catch (error) {
            return {
                ok: false,
                error: {
                    code: 'COMPLETE_BARRIER_UNAVAILABLE',
                    message: `Completion barrier unavailable: ${error instanceof Error ? error.message : String(error)}`,
                },
            };
        }
        const result = await game.jobCommands.complete(marketId, jobId);
        if (!result.ok) {
            if (result.error.unconfirmed === true) {
                try {
                    await automation.autoFinish.markDirectUnconfirmed(market.key, jobId, resetAt);
                } catch (error) {
                    return {
                        ok: false,
                        error: {
                            code: 'COMPLETE_BARRIER_UNAVAILABLE',
                            message: `Completion barrier unavailable: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    };
                }
            }
            return { ok: false, error: { code: result.error.code, message: result.error.message } };
        }
        const persisted = await automation.autoFinish.recordDirectCompletion(market.key, jobId, resetAt);
        if (!persisted.ok) {
            try {
                await automation.autoFinish.markDirectUnconfirmed(market.key, jobId, resetAt);
            } catch (error) {
                return {
                    ok: false,
                    error: {
                        code: 'COMPLETE_BARRIER_UNAVAILABLE',
                        message: `Completion barrier unavailable: ${error instanceof Error ? error.message : String(error)}`,
                    },
                };
            }
            return { ok: false, error: persisted.error };
        }
        await automation.jobStates.update({ marketKey: market.key, jobId, resetAt }, 'completed');
        return ok(undefined);
    });
    server.register('job.dismiss', jobCommandSchema, async ({ marketId, jobId }) => {
        const result = await game.jobCommands.dismiss(marketId, jobId);
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    });
    server.register('job.dismissFailed', dismissFailedSchema, async ({ marketKey, owner }) => {
        return core.runBridgeExclusive({ owner, reason: 'dismiss-failed', priority: 85 }, async () =>
            ok(await automation.autoJobs.dismissFailedJobs(owner, 'dismiss-failed', marketKey ? [marketKey] : undefined)));
    });
    server.register('job.syncMarket', jobMarketSchema, async (request) => {
        return core.runBridgeExclusive({ owner: request.owner, reason: request.reason, priority: 70 }, async () => {
            const result = await automation.autoJobs.syncMarket(request);
            return result.ok ? ok(result.value) : result;
        });
    });
    server.register('job.syncAllMarkets', allMarketsSchema, async (request) => {
        return core.runBridgeExclusive({ owner: request.owner, reason: request.reason, priority: 70 }, async () => {
            return ok(await automation.autoJobs.syncAllMarkets(request.owner, request.reason));
        });
    });
    server.register('job.run', autoJobSchema, async ({ job, owner }) => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        return core.runBridgeExclusive({ owner, reason: `job:${job.id}`, priority: 80 }, async () => {
            const result = await automation.autoJobsRunner.run(job);
            return result.ok
                ? ok(result.value)
                : { ok: false, error: { code: result.error.code, message: result.error.message } };
        });
    });
    server.register('job.queue', autoJobQueueSchema, async (request) => {
        if (await core.helperModeEnabled()) return { ok: false, error: core.helperModeError };
        const result = await automation.queue.run({
            runId: request.runId,
            jobs: request.jobs,
            owner: request.owner,
            ...(request.completedIds !== undefined ? { completedIds: request.completedIds } : {}),
            ...(request.supportedTypes !== undefined ? { supportedTypes: request.supportedTypes } : {}),
        });
        return result.ok ? ok(result.value) : result;
    });
    server.register('job.queueCancel', z.object({ runId: z.string().min(1) }).strict(), async ({ runId }) => {
        automation.queue.cancel(runId);
        return ok(undefined);
    });
    server.register('job.history', z.object({}).strict(), async () => ok(await core.stores.jobHistory.list()));
    server.register('job.queueProgress', z.object({ runId: z.string().min(1) }).strict(), async ({ runId }) => {
        return ok(automation.queue.progress(runId));
    });
}
