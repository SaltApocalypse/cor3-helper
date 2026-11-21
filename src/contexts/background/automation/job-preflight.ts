import { NetworkGraph, type NetworkError } from '../../../domains/network/graph.js';
import type { NetworkSnapshot } from '../../../domains/network/model.js';
import type { RoutePlan } from '../../../domains/network/model.js';
import { decryptFileType, isGenericEncryptedFileType, type JobOffer } from '../../../domains/jobs/model.js';
import type { GameError } from '../../../application/game/ports.js';
import type { LoadoutService } from '../../../application/loadout/service.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger } from '../../../application/automation/ports.js';
import type { JobLockRegistry } from './job-locks.js';
import { asServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';

export interface JobPreflightDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly loadout: Pick<LoadoutService, 'canSatisfy'>;
    /** Per-job minigame locks. Only the current job's lock is consulted. */
    readonly locks?: Pick<JobLockRegistry, 'isLocked' | 'lockUntil'>;
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
    const target = asServerId(targetId);
    const start = snapshot.endpointId ?? snapshot.homeId;
    const graph = new NetworkGraph(snapshot);
    if (start === target) {
        // findRouteFrom still validates target maintenance even for a self-route.
        const self = graph.findRouteFrom(start, target);
        return self.ok ? ok(undefined) : err(self.error);
    }
    // Execution tries the current endpoint first. Checking only the home path
    // here would skip jobs whose home route is blocked by maintenance even
    // though the player can reach the target directly.
    const fromCurrent = start === snapshot.homeId ? null : graph.findRouteFrom(start, target);
    if (fromCurrent?.ok) return ok(undefined);
    const fromHome = graph.findRoute(target);
    if (fromHome.ok) return ok(undefined);
    const errors: NetworkError[] = [];
    if (fromCurrent && !fromCurrent.ok) errors.push(fromCurrent.error);
    errors.push(fromHome.error);
    return err(errors.find((entry) => isMaintenancePreflightError(entry.code)) ?? fromHome.error);
}

function isMaintenancePreflightError(code: string): boolean {
    return code === 'TARGET_IN_MAINTENANCE' || code === 'MAINTENANCE_BLOCKED';
}

function isDefinitiveCapabilityGap(reason: string | null): boolean {
    // Hardware/power plans can change after the job is taken and a loadout is
    // applied. Only missing software or wholly missing hardware is a definitive
    // reason to refuse the job before `take`.
    return reason === 'NO_SOFTWARE' || reason === 'NO_HARDWARE';
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
 * - decrypt jobs need an owned DECRYPT module
 * - jobs whose route still needs hacking need an owned HACK module for every
 *   server type on the route
 * - a per-job minigame lock blocks only that job
 *
 * A stale/unknown map or an unavailable loadout snapshot deliberately does not
 * block the job. Only a definitive missing software/hardware result does;
 * hardware/power transitions are handled after the job is taken.
 */
export class JobPreflight {
    private lastMapRefreshAt = 0;
    private readonly now: () => number;

    constructor(private readonly deps: JobPreflightDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    private async checkCapability(snapshot: NetworkSnapshot | null, job: JobOffer): Promise<Result<void, GameError>> {
        const missing: string[] = [];

        // A lock is scoped to the job/file that produced it. Never infer a
        // global lock from another file's minigame.
        if (this.deps.locks?.isLocked(job.marketKey, job.id)) {
            const until = this.deps.locks.lockUntil(job.marketKey, job.id) ?? this.now();
            return err({ code: 'PREFLIGHT_FAILED', message: lockMessage(until, this.now()) });
        }

        if (jobRequiresDecrypt(job)) {
            const resolvedFileType = decryptFileType(job, job.fileInfo?.name);
            // `.enc`/`.bin` are generic wrappers, not reliable decrypt formats.
            // Treat them as unknown for the preflight so a wrapper does not
            // block a job whose real downloaded extension is only known later.
            const fileType = resolvedFileType && !isGenericEncryptedFileType(resolvedFileType)
                ? resolvedFileType
                : null;
            const capability = await this.deps.loadout.canSatisfy({
                ability: 'DECRYPT',
                target: fileType ?? '',
                requiredPower: 0,
                // The job condition names the decrypted file, but the actual
                // decrypt target is the downloaded encrypted file, whose
                // suffix may be completely different (`.txt` vs `.ab52p`).
                // Require any DECRYPT module here; the strict targeted loadout
                // runs after the real file is known.
                fallbackToAnyAbility: true,
            });
            if (!capability.ok) {
                this.deps.logger.warn('auto-job', `Decrypt capability check unavailable for ${job.name}`, { message: capability.error.message });
            } else if (!capability.value.feasible) {
                if (isDefinitiveCapabilityGap(capability.value.reason)) {
                    missing.push(`DECRYPT ${fileType ?? 'software'}`);
                } else {
                    this.deps.logger.debug('auto-job', 'Decrypt loadout will be attempted after take', {
                        jobId: job.id,
                        reason: capability.value.reason,
                    });
                }
            }
        }

        const targetId = snapshot ? targetServerId(snapshot, job) : null;
        if (snapshot && targetId) {
            const graph = new NetworkGraph(snapshot);
            const target = asServerId(targetId);
            const start = snapshot.endpointId ?? snapshot.homeId;
            const routeSets: RoutePlan[] = [];
            const fromCurrent = graph.findRoutesFrom(start, target, 3);
            if (fromCurrent.ok) routeSets.push(...fromCurrent.value);
            if (start !== snapshot.homeId) {
                const fromHome = graph.findRoutes(target, 3);
                if (fromHome.ok) routeSets.push(...fromHome.value);
            }
            if (routeSets.length > 0) {
                const missingByRoute: string[] = [];
                let hasCapableRoute = false;
                for (const route of routeSets) {
                    const routeMissing: string[] = [];
                    for (const node of route.nodes) {
                        const server = snapshot.servers.get(node.id);
                        if (!server || server.id === snapshot.homeId || server.access.active) continue;
                        if (!server.typeName) continue;
                        const capability = await this.deps.loadout.canSatisfy({ ability: 'HACK', target: server.typeName, requiredPower: 0 });
                        if (!capability.ok) {
                            this.deps.logger.warn('auto-job', `Hack capability check unavailable for ${server.name}`, { message: capability.error.message });
                        } else if (!capability.value.feasible) {
                            if (isDefinitiveCapabilityGap(capability.value.reason)) {
                                routeMissing.push(`HACK ${server.typeName}`);
                            } else {
                                this.deps.logger.debug('auto-job', `Hack loadout will be attempted after take for ${server.name}`, {
                                    reason: capability.value.reason,
                                });
                            }
                        }
                    }
                    if (routeMissing.length === 0) {
                        hasCapableRoute = true;
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
            const canRefresh = now - snapshot.capturedAt > 30_000
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
