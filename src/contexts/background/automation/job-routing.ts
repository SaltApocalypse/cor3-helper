import { NetworkGraph } from '../../../domains/network/graph.js';
import type { JobOffer } from '../../../domains/jobs/model.js';
import { mapMarketSnapshotJobs } from '../../../application/auto-job/market-mapper.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { RouteExecutor } from '../../../application/network/route-executor.js';
import type { EndpointMutexPort } from '../../../application/network/endpoint-mutex.js';
import type { GameError } from '../../../application/game/ports.js';
import type { AutomationLogger } from '../../../application/automation/ports.js';
import { asServerId, type ServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';

export interface TabRequestPort {
    findCor3Tab(): Promise<number | null>;
    send(tabId: number, message: unknown): Promise<unknown>;
}

export interface EndpointCommandPort {
    setEndpoint(serverId: ServerId): Promise<Result<void, GameError>>;
}

export interface ServerAccessPort {
    ensureAccess(serverId: ServerId, context?: { readonly serverTypeName?: string }): Promise<Result<void, GameError>>;
}

export interface JobRoutingDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly endpointCommands: EndpointCommandPort;
    readonly endpointMutex: EndpointMutexPort;
    readonly routeExecutor: RouteExecutor;
    readonly serverAccess: ServerAccessPort;
    readonly tabs: TabRequestPort;
    readonly logger: AutomationLogger;
}

export class JobRouting {
    constructor(private readonly deps: JobRoutingDeps) {}

    async setEndpointIfNeeded(serverId: string, owner: string, reason: string): Promise<Result<void, GameError>> {
        const snapshot = await this.deps.snapshots.get();
        if (snapshot.ok && snapshot.value.endpointId === serverId) return ok(undefined);
        const direct = await this.deps.endpointMutex.run(() => this.deps.endpointCommands.setEndpoint(asServerId(serverId)));
        if (direct.ok) return direct;
        if (!snapshot.ok) return direct;
        const graph = new NetworkGraph(snapshot.value);
        const route = await this.deps.routeExecutor.execute(graph, asServerId(serverId), {
            owner,
            reason,
            now: Date.now(),
            currentEndpoint: snapshot.value.endpointId,
            skipDirect: true,
        });
        if (route.ok) return ok(undefined);
        const message = route.error
            ? `${route.error.message} (direct: ${direct.error.code} ${direct.error.message})`
            : direct.error.message;
        return { ok: false as const, error: { code: route.error?.code ?? direct.error.code, message } };
    }

    async routeJobToMarket(job: JobOffer, reason: string): Promise<Result<void, GameError>> {
        // HOME jobs do not require an endpoint change. v1 never routed home jobs and
        // doing so made serverless File Decryption depend on a network-map refresh.
        if (!job.marketServerId || job.marketKey === 'home') return ok(undefined);
        return this.setEndpointIfNeeded(job.marketServerId, 'auto-job', `job:${job.id}:${reason}`);
    }

    async routeToServer(serverId: string, owner: string, reason: string): Promise<Result<void, GameError>> {
        return this.setEndpointIfNeeded(serverId, owner, reason);
    }

    async routeJobToTarget(job: JobOffer): Promise<Result<void, GameError>> {
        if (!job.serverId) return { ok: false as const, error: { code: 'NO_SERVER', message: 'Job has no target server' } };
        const targetId = asServerId(job.serverId);
        let snapshot = await this.deps.snapshots.get();
        if (!snapshot.ok) return { ok: false as const, error: { code: 'SNAPSHOT_FAILED', message: snapshot.error.message } };
        let graph = new NetworkGraph(snapshot.value);
        let target = graph.getServer(targetId);
        let route = await this.deps.routeExecutor.execute(graph, targetId, {
            owner: 'auto-job',
            reason: `job:${job.id}:target`,
            now: Date.now(),
            currentEndpoint: snapshot.value.endpointId,
        });
        if (!route.ok && route.error?.code === 'NO_ROUTE') {
            const refreshed = await this.deps.snapshots.get(true);
            if (refreshed.ok) {
                snapshot = refreshed;
                graph = new NetworkGraph(snapshot.value);
                target = graph.getServer(targetId);
                route = await this.deps.routeExecutor.execute(graph, targetId, {
                    owner: 'auto-job',
                    reason: `job:${job.id}:target`,
                    now: Date.now(),
                    currentEndpoint: snapshot.value.endpointId,
                });
            }
        }
        if (!route.ok) {
            return { ok: false as const, error: { code: route.error?.code ?? 'ROUTE_FAILED', message: route.error?.message ?? 'No route to job server' } };
        }
        if (route.accessEnsured) return ok(undefined);
        const access = await this.deps.serverAccess.ensureAccess(targetId, {
            ...(target?.typeName ? { serverTypeName: target.typeName } : {}),
        });
        return access.ok
            ? ok(undefined)
            : { ok: false as const, error: { code: access.error.code, message: access.error.message } };
    }

    /**
     * The after-take refresh only needs the job rows. Fetching options and lots as
     * well tripled the command count inside the tight take/route/action window and
     * contributed to "Too many requests" toasts.
     */
    async fetchMarketJobs(marketId: string): Promise<Result<unknown, GameError>> {
        const tabId = await this.deps.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.deps.tabs.send(tabId, { type: 'V2_REQUEST_MARKET_JOBS', marketId });
            if (!response || typeof response !== 'object') {
                return err({ code: 'MARKET_COMMAND_FAILED', message: 'No market jobs result' });
            }
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok !== true) {
                return err({
                    code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'MARKET_COMMAND_FAILED',
                    message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Market jobs fetch failed',
                });
            }
            return ok(candidate.value);
        } catch (error) {
            return err({ code: 'MARKET_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    async refreshJobAfterTake(job: JobOffer): Promise<Result<JobOffer, never>> {
        if (!job.marketServerId) return ok(job);
        const jobs = await this.fetchMarketJobs(job.marketId);
        if (!jobs.ok) {
            this.deps.logger.warn('auto-job', 'After-take market refresh failed', { jobId: job.id, message: jobs.error.message });
            return ok(job);
        }
        const mapped = mapMarketSnapshotJobs({ jobs: jobs.value }, job.marketId, job.marketKey, job.marketServerId);
        const refreshed = mapped.jobs.find((entry) => entry.id === job.id);
        if (!refreshed) this.deps.logger.warn('auto-job', 'Taken job missing from refreshed market data', { jobId: job.id });
        return ok(refreshed ? { ...job, ...refreshed, alreadyTaken: true } : job);
    }
}
