import { NetworkGraph } from '../../../domains/network/graph.js';
import type { NetworkSnapshot } from '../../../domains/network/model.js';
import { decryptFileType, type JobOffer } from '../../../domains/jobs/model.js';
import type { GameError } from '../../../application/game/ports.js';
import type { LoadoutService } from '../../../application/loadout/service.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger } from '../../../application/automation/ports.js';
import { asServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';

export interface JobPreflightDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly loadout: Pick<LoadoutService, 'canSatisfy'>;
    readonly jobActions: { getMinigameLock?(): Promise<number | null> };
    readonly logger: AutomationLogger;
    readonly now?: () => number;
}

function checkJobTarget(snapshot: NetworkSnapshot, job: JobOffer): Result<void, GameError> {
    const targetId = job.serverId
        ?? [...snapshot.servers.values()].find((server) => server.name === job.serverName)?.id
        ?? null;
    if (!targetId) {
        return err({ code: 'SERVER_LOCKED', message: `Target server ${job.serverName ?? job.id} is not on the network map` });
    }
    const graph = new NetworkGraph(snapshot);
    const route = graph.findRoute(asServerId(targetId));
    return route.ok ? ok(undefined) : err({ code: route.error.code, message: route.error.message });
}

function isMaintenancePreflightError(code: string): boolean {
    return code === 'TARGET_IN_MAINTENANCE' || code === 'MAINTENANCE_BLOCKED';
}

function jobRequiresDecrypt(job: JobOffer): boolean {
    if (job.type === 'File Decryption' || job.type === 'Decrypt & Extract') return true;
    return (job.conditions ?? []).some((condition) =>
        condition.type === 'DecryptFile' || condition.type === 'DecryptDownloadedFile');
}

function targetServerId(snapshot: NetworkSnapshot, job: JobOffer) {
    return job.serverId
        ?? [...snapshot.servers.values()].find((server) => server.name === job.serverName)?.id
        ?? null;
}

function lockMessage(expiresAt: number, now: number): string {
    const minutes = Math.max(1, Math.ceil((expiresAt - now) / 60_000));
    return `Minigame locked (~${minutes}m remaining)`;
}

/**
 * Checks the ownership side of the preflight, not just route reachability:
 * - decrypt jobs need an owned DECRYPT module for the file type
 * - jobs whose route still needs hacking need an owned HACK module for every
 *   server type on the route
 * - an active minigame lock means neither hacking nor decryption can run
 *
 * A stale/unknown map or an unavailable loadout snapshot deliberately does not
 * block the job. Only a definitive "no owned software" result does.
 */
export class JobPreflight {
    private lastMapRefreshAt = 0;
    private readonly now: () => number;

    constructor(private readonly deps: JobPreflightDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    private async checkCapability(snapshot: NetworkSnapshot | null, job: JobOffer): Promise<Result<void, GameError>> {
        const missing: string[] = [];
        let needsMinigame = false;

        if (jobRequiresDecrypt(job)) {
            needsMinigame = true;
            const fileType = decryptFileType(job, job.fileInfo?.name);
            const capability = await this.deps.loadout.canSatisfy({
                ability: 'DECRYPT',
                target: fileType ?? '',
                requiredPower: 0,
                // File Decryption rows often only expose the extension after the
                // file is downloaded. Fall back to "owns any DECRYPT module" so a
                // completely un-equipped account still does not take the job.
                ...(fileType ? {} : { fallbackToAnyAbility: true }),
            });
            if (!capability.ok) {
                this.deps.logger.warn('auto-job', `Decrypt capability check unavailable for ${job.name}`, { message: capability.error.message });
            } else if (!capability.value.feasible) {
                missing.push(`DECRYPT ${fileType ?? 'software'}`);
            }
        }

        const targetId = snapshot ? targetServerId(snapshot, job) : null;
        if (snapshot && targetId) {
            const routes = new NetworkGraph(snapshot).findRoutes(asServerId(targetId), 3);
            if (routes.ok) {
                const missingByRoute: string[] = [];
                let hasCapableRoute = false;
                for (const route of routes.value) {
                    const routeMissing: string[] = [];
                    let routeNeedsMinigame = false;
                    for (const node of route.nodes) {
                        const server = snapshot.servers.get(node.id);
                        if (!server || server.id === snapshot.homeId || server.access.active) continue;
                        routeNeedsMinigame = true;
                        if (!server.typeName) continue;
                        const capability = await this.deps.loadout.canSatisfy({ ability: 'HACK', target: server.typeName, requiredPower: 0 });
                        if (!capability.ok) {
                            this.deps.logger.warn('auto-job', `Hack capability check unavailable for ${server.name}`, { message: capability.error.message });
                        } else if (!capability.value.feasible) {
                            routeMissing.push(`HACK ${server.typeName}`);
                        }
                    }
                    if (routeMissing.length === 0) {
                        hasCapableRoute = true;
                        if (routeNeedsMinigame) needsMinigame = true;
                        break;
                    }
                    for (const entry of routeMissing) {
                        if (!missingByRoute.includes(entry)) missingByRoute.push(entry);
                    }
                }
                if (!hasCapableRoute && missingByRoute.length > 0) missing.push(...missingByRoute);
            }
        }

        if (missing.length > 0) {
            return err({
                code: 'PREFLIGHT_FAILED',
                message: `Missing required software: ${[...new Set(missing)].join(', ')}`,
            });
        }

        if (needsMinigame && this.deps.jobActions.getMinigameLock) {
            const lock = await this.deps.jobActions.getMinigameLock();
            if (lock !== null && lock > this.now()) {
                return err({ code: 'PREFLIGHT_FAILED', message: lockMessage(lock, this.now()) });
            }
        }
        return ok(undefined);
    }

    /**
     * Check the live map before taking a job. Only a fresh maintenance block is
     * treated as fatal: an unknown target or missing route is often just a stale or
     * incomplete map snapshot, and v1 still attempted those jobs. Blocking them
     * caused valid servers to be marked failed after GAME_MAP_FAILED refreshes.
     */
    async preflight(job: JobOffer): Promise<Result<void, GameError>> {
        const first = await this.deps.snapshots.get();
        if (!first.ok) {
            this.deps.logger.warn('auto-job', `Skipping map preflight for ${job.name}: ${first.error.message}`);
            // Serverless decrypt jobs do not need a map: still enforce decrypt
            // software ownership and the minigame lock before taking them.
            return jobRequiresDecrypt(job) ? this.checkCapability(null, job) : ok(undefined);
        }
        let snapshot = first.value;
        let target = checkJobTarget(snapshot, job);
        if (!target.ok && isMaintenancePreflightError(target.error.code)) {
            const now = this.now();
            const canRefresh = now - snapshot.capturedAt > 120_000
                && now - this.lastMapRefreshAt >= 30_000;
            if (canRefresh) {
                this.lastMapRefreshAt = now;
                const refreshed = await this.deps.snapshots.get(true);
                if (refreshed.ok) {
                    snapshot = refreshed.value;
                    target = checkJobTarget(snapshot, job);
                }
            }
            if (!target.ok && isMaintenancePreflightError(target.error.code)) return target;
        }

        const capability = await this.checkCapability(snapshot, job);
        return capability.ok ? ok(undefined) : capability;
    }
}
