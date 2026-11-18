import type { AutoFinishFailure } from '../../../contracts/auto-finish.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { SettingsPort } from '../../../application/automation/ports.js';

export interface RetryDecision {
    readonly at: number;
    readonly reason: string | null;
}

/** Computes the earliest moment a failed Auto Finish run should retry. */
export async function computeAutoFinishRetry(
    settings: SettingsPort,
    snapshots: Pick<NetworkSnapshotService, 'get'>,
    now: number,
    failures: readonly AutoFinishFailure[],
    includeMaintenance: boolean,
): Promise<RetryDecision | null> {
    const current = await settings.get();
    if (!current.autoFinishEnabled) return null;
    let earliest = Number.POSITIVE_INFINITY;
    let reason: string | null = null;
    for (const failure of failures) {
        const at = failure.lockExpiresAt ?? failure.retryAt;
        if (at !== undefined && at > now && at < earliest) {
            earliest = at;
            reason = failure.lockExpiresAt !== undefined ? 'minigame lock' : 'job retry';
        }
    }
    if (includeMaintenance) {
        const snapshot = await snapshots.get();
        if (snapshot.ok) {
            for (const server of snapshot.value.servers.values()) {
                if (!server.maintenance.active || !server.maintenance.endsAt) continue;
                const endsAt = new Date(server.maintenance.endsAt).getTime();
                if (Number.isFinite(endsAt) && endsAt > now && endsAt < earliest) {
                    earliest = endsAt;
                    reason = 'maintenance';
                }
            }
        }
    }
    if (!Number.isFinite(earliest) && failures.length > 0) {
        // Transient failures without a game-provided timing get a slow retry;
        // this is also the cooldown used before a job retry budget refreshes.
        return { at: now + 10 * 60_000 + 15_000, reason: 'retry' };
    }
    if (!Number.isFinite(earliest)) return null;
    return { at: earliest + 15_000, reason };
}
