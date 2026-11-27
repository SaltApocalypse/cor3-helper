import { NetworkGraph, type NetworkError } from '../../../domains/network/graph.js';
import type { NetworkServer, NetworkSnapshot } from '../../../domains/network/model.js';
import type { RoutePlan } from '../../../domains/network/model.js';
import { decryptFileType, isGenericEncryptedFileType, isServerlessJob, type JobOffer } from '../../../domains/jobs/model.js';
import type { GameError } from '../../../application/game/ports.js';
import type { LoadoutService } from '../../../application/loadout/service.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger } from '../../../application/automation/ports.js';
import type { JobLockRegistry } from './job-locks.js';
import { asServerId } from '../../../kernel/ids.js';
import { err, ok, type Result } from '../../../kernel/result.js';

/** A negative reachability result is only trusted on a map this recent. */
const FRESH_SNAPSHOT_MS = 60_000;
/** Throttle forced map refreshes triggered by a preflight block. */
const TARGET_REFRESH_MS = 30_000;

export interface JobAccessProbe {
    inspect(serverId: string): Promise<Result<{ readonly hasAccess: boolean; readonly defenceRate: number | null }, GameError>>;
}

export interface JobPreflightDeps {
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly loadout: Pick<LoadoutService, 'canSatisfy'>;
    /** Per-job minigame locks. Only the current job's lock is consulted. */
    readonly locks?: Pick<JobLockRegistry, 'isLocked' | 'lockUntil'>;
    /** Read-only SAI probe; absent in tests that do not need access checks. */
    readonly access?: JobAccessProbe;
    readonly logger: AutomationLogger;
    readonly now?: () => number;
}

interface JobTarget {
    /** Server id the job points at, after resolving a stale id through the name. */
    readonly id: string | null;
    readonly server: NetworkServer | null;
    /** True when the job id was unknown to the map and the name resolved instead. */
    readonly resolvedByName: boolean;
}

/**
 * Resolve the job target against the map. The job id remains authoritative when
 * the map knows it; a stale/config id falls back to the server name so an
 * outdated row is not reported as unreachable.
 */
function resolveJobTarget(snapshot: NetworkSnapshot, job: JobOffer): JobTarget {
    if (job.serverId) {
        const server = snapshot.servers.get(asServerId(job.serverId)) ?? null;
        if (server) return { id: job.serverId, server, resolvedByName: false };
    }
    const byName = job.serverName
        ? [...snapshot.servers.values()].find((server) => server.name === job.serverName) ?? null
        : null;
    if (byName) {
        return {
            id: byName.id,
            server: byName,
            resolvedByName: job.serverId !== null && job.serverId !== byName.id,
        };
    }
    return { id: job.serverId, server: null, resolvedByName: false };
}

function checkJobTarget(snapshot: NetworkSnapshot, job: JobOffer): Result<void, GameError> {
    const resolved = resolveJobTarget(snapshot, job);
    if (!resolved.id) {
        return err({ code: 'SERVER_LOCKED', message: `Target server ${job.serverName ?? job.id} is missing from the network map` });
    }
    if (!resolved.server) {
        return err({ code: 'SERVER_LOCKED', message: `Target server ${job.serverName ?? resolved.id} is missing from the network map` });
    }
    if (resolved.server.discovered === false) {
        return err({ code: 'SERVER_LOCKED', message: `Target server ${resolved.server.name} has not been discovered` });
    }
    const target = asServerId(resolved.id);
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
    private readonly accessCache = new Map<string, { readonly at: number; readonly value: { readonly hasAccess: boolean; readonly defenceRate: number | null } }>();

    constructor(private readonly deps: JobPreflightDeps) {
        this.now = deps.now ?? (() => Date.now());
    }

    private async inspectAccess(serverId: string): Promise<{ readonly hasAccess: boolean; readonly defenceRate: number | null } | null> {
        const access = this.deps.access;
        if (!access) return null;
        const cached = this.accessCache.get(serverId);
        if (cached && this.now() - cached.at < 30_000) return cached.value;
        try {
            const result = await access.inspect(serverId);
            if (!result.ok) {
                this.deps.logger.debug('auto-job', 'Target access probe failed', {
                    serverId,
                    code: result.error.code,
                    message: result.error.message,
                });
                return null;
            }
            this.accessCache.set(serverId, { at: this.now(), value: result.value });
            return result.value;
        } catch (error) {
            this.deps.logger.debug('auto-job', 'Target access probe threw', {
                serverId,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
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

        const resolvedTarget = snapshot ? resolveJobTarget(snapshot, job) : null;
        const targetId = resolvedTarget?.id ?? null;
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

            // Read-only SAI check for the target itself. A route can be
            // planned while the target still has no access grant; in that case
            // the job would be taken and fail later at `set.endpoint`. Block it
            // before take only when a hack is required and the owned loadout
            // cannot reach the server's defence rate.
            const targetServer = resolvedTarget?.server ?? null;
            const probe = await this.inspectAccess(targetId);
            if (
                targetServer
                && targetServer.id !== snapshot.homeId
                && probe
                && !probe.hasAccess
                && probe.defenceRate !== null
                && probe.defenceRate > 0
                && targetServer.typeName
            ) {
                const requiredPower = probe.defenceRate;
                const capability = await this.deps.loadout.canSatisfy({
                    ability: 'HACK',
                    target: targetServer.typeName,
                    requiredPower,
                });
                if (!capability.ok) {
                    this.deps.logger.warn('auto-job', `Target access capability check unavailable for ${targetServer.name}`, {
                        message: capability.error.message,
                    });
                } else if (!capability.value.feasible) {
                    missing.push(`HACK ${targetServer.typeName} (${requiredPower})`);
                } else {
                    this.deps.logger.debug('auto-job', `Target ${targetServer.name} needs a hack; loadout available`, {
                        jobId: job.id,
                        requiredPower,
                    });
                }
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
     * Check the live map before taking a job. Maintenance is always fatal;
     * unreachable targets (missing from the map, undiscovered, or without a
     * route) are fatal only on a fresh snapshot. A stale or incomplete map
     * must not block a valid job: previously `GAME_MAP_FAILED` refreshes made
     * the map disagree with the live server list and every target looked
     * unreachable.
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
        if (!isServerlessJob(job.type)) {
            let target = checkJobTarget(snapshot, job);
            if (!target.ok) {
                const now = this.now();
                const canRefresh = now - snapshot.capturedAt > TARGET_REFRESH_MS
                    && now - this.lastMapRefreshAt >= TARGET_REFRESH_MS;
                if (canRefresh) {
                    this.lastMapRefreshAt = now;
                    const refreshed = await this.deps.snapshots.get(true);
                    if (refreshed.ok) {
                        snapshot = refreshed.value;
                        target = checkJobTarget(snapshot, job);
                    }
                }
            }
            if (!target.ok) {
                if (isMaintenancePreflightError(target.error.code)) return target;
                const diagnostics = this.targetDiagnostics(snapshot, job);
                if (this.now() - snapshot.capturedAt <= FRESH_SNAPSHOT_MS) {
                    this.deps.logger.warn('auto-job', `Skipping ${job.name}: target server is not available`, {
                        jobId: job.id,
                        code: target.error.code,
                        message: target.error.message,
                        ...diagnostics,
                    });
                    // Deliberately avoid maintenance/route/lock wording: the
                    // outcome classifier turns those into endless retries,
                    // while an unreachable target should be a skip for this run.
                    return err({
                        code: 'PREFLIGHT_FAILED',
                        message: `Target server ${job.serverName ?? job.serverId ?? job.id} cannot be reached in this run`,
                    });
                }
                this.deps.logger.debug('auto-job', `Target preflight kept permissive on a stale map for ${job.name}`, {
                    jobId: job.id,
                    code: target.error.code,
                    message: target.error.message,
                    mapAgeMs: this.now() - snapshot.capturedAt,
                    ...diagnostics,
                });
            }
        }

        const capability = await this.checkCapability(snapshot, job);
        return capability.ok ? ok(undefined) : capability;
    }

    /** Diagnostics for a blocked/uncertain target decision; never throws. */
    private targetDiagnostics(snapshot: NetworkSnapshot, job: JobOffer): Record<string, unknown> {
        try {
            const resolved = resolveJobTarget(snapshot, job);
            const start = snapshot.endpointId ?? snapshot.homeId;
            const graph = new NetworkGraph(snapshot);
            const target = resolved.id ? asServerId(resolved.id) : null;
            const fromCurrent = target ? graph.findRoutesFrom(start, target, 3) : null;
            const fromHome = target && start !== snapshot.homeId ? graph.findRoutes(target, 3) : null;
            return {
                marketKey: job.marketKey,
                serverId: job.serverId,
                serverName: job.serverName,
                resolvedId: resolved.id,
                resolvedByName: resolved.resolvedByName,
                inMap: resolved.server !== null,
                discovered: resolved.server?.discovered ?? null,
                accessible: resolved.server?.accessible ?? null,
                reachableNow: resolved.server?.reachableNow ?? null,
                endpointCapable: resolved.server?.endpointCapable ?? null,
                mapAgeMs: this.now() - snapshot.capturedAt,
                currentEndpoint: snapshot.endpointId,
                routeFromCurrent: fromCurrent
                    ? fromCurrent.ok ? fromCurrent.value.length : fromCurrent.error.code
                    : 'skipped',
                routeFromHome: fromHome
                    ? fromHome.ok ? fromHome.value.length : fromHome.error.code
                    : 'skipped',
            };
        } catch (error) {
            return { diagnosticsError: error instanceof Error ? error.message : String(error) };
        }
    }
}
