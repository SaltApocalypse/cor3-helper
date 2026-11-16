import { isExpiredJobFailureText } from './expiry.js';

/**
 * User-visible job outcome after an automatic run.
 *
 * "failed" is intentionally narrow: the job was attempted and the failure is
 * neither temporary, expired, nor a known capability gap. Anything that may
 * succeed later is reported as "retry" so the UI does not cry wolf.
 */
export type JobOutcomeStatus = 'retry' | 'skipped' | 'expired' | 'failed';

export type JobOutcomeReason =
    | 'conditions'
    | 'server-state'
    | 'network'
    | 'minigame'
    | 'minigame-lock'
    | 'maintenance'
    | 'capability'
    | 'type-disabled'
    | 'no-server'
    | 'cancelled'
    | 'expired'
    | 'unsupported'
    | 'unknown';

export interface JobOutcomeInput {
    readonly code: string;
    readonly detailCode?: string;
    readonly message: string;
    readonly stage?: string;
    readonly retryable?: boolean;
    readonly retryAt?: number;
    readonly lockExpiresAt?: number;
}

export interface JobOutcome {
    readonly status: JobOutcomeStatus;
    readonly reason: JobOutcomeReason;
    readonly retryAt?: number;
}

const NETWORK_HINTS = /timeout|timed out|socket|no game websocket|websocket|map|network|rate[\s-]?limit|too many requests|disconnected|econn|connection|all route attempts|route attempts failed|busy|processing|in progress|pending|cooldown|try again|not[\s-]?reachable/i;
const CONDITION_HINTS = /conditions?.*not.*met|not met|not ready|still.*process|try again/i;
const LOCK_HINTS = /minigame[-\s]?lock|locked|cooldown/i;
const MAINTENANCE_HINTS = /maintenance|no route|not on the network map|route blocked|unreachable|not[\s-]?reachable/i;
const CAPABILITY_HINTS = /missing required software|no[-\s]?software|no .* software|insufficient.*power|decrypt power/i;

function retryOutcome(reason: JobOutcomeReason, at: number | undefined): JobOutcome {
    return at !== undefined ? { status: 'retry', reason, retryAt: at } : { status: 'retry', reason };
}

function skippedOutcome(reason: JobOutcomeReason): JobOutcome {
    return { status: 'skipped', reason };
}

export function classifyJobFailure(input: JobOutcomeInput, _now = Date.now()): JobOutcome {
    const code = input.detailCode ?? input.code;
    const message = input.message;
    const text = `${code} ${message}`;
    const at = input.lockExpiresAt ?? input.retryAt;

    // Expired is terminal and comes from the game itself: deadline, job removed,
    // already completed, or job-not-found. Keep this before every retry rule.
    if (isExpiredJobFailureText(code, message)) {
        return { status: 'expired', reason: 'expired' };
    }
    if (code === 'JOB_CANCELLED' || input.stage === 'cancelled') {
        return skippedOutcome('cancelled');
    }
    if (code === 'NO_SERVER') {
        return skippedOutcome('no-server');
    }
    if (code === 'TYPE_DISABLED') {
        return skippedOutcome('type-disabled');
    }
    if (code === 'LOADOUT_NO_PLAN' || code === 'NO_PLAN' || /no[_-]?software|no\s+software|loadout.*infeasible/i.test(text)) {
        return skippedOutcome('capability');
    }
    if (code === 'PREFLIGHT_FAILED') {
        if (input.lockExpiresAt !== undefined || LOCK_HINTS.test(message)) return retryOutcome('minigame-lock', at);
        if (MAINTENANCE_HINTS.test(message)) return retryOutcome('maintenance', at);
        if (CAPABILITY_HINTS.test(message)) return skippedOutcome('capability');
        // The job was never accepted, so do not call it failed.
        return skippedOutcome('capability');
    }
    if (code === 'UNSUPPORTED_JOB_TYPE' || code === 'MINIGAME_REQUIRED') {
        return skippedOutcome('unsupported');
    }
    if (code === 'DECRYPT_POWER_INSUFFICIENT') {
        return skippedOutcome('capability');
    }
    if (code === 'FILE_NOT_FOUND') {
        return retryOutcome('server-state', at);
    }
    if (code === 'MINIGAME_FAILED') {
        return retryOutcome(input.lockExpiresAt !== undefined ? 'minigame-lock' : 'minigame', at);
    }
    if (code === 'TAKE_FAILED') {
        if (input.retryable !== false) return retryOutcome('network', at);
        return skippedOutcome('conditions');
    }
    if (code === 'COMPLETE_FAILED') {
        if (CONDITION_HINTS.test(message)) return retryOutcome('conditions', at);
        if (NETWORK_HINTS.test(message)) return retryOutcome('network', at);
        if (MAINTENANCE_HINTS.test(message)) return retryOutcome('maintenance', at);
        if (input.retryable === true) return retryOutcome('unknown', at);
        return { status: 'failed', reason: 'unknown' };
    }
    if (code === 'ACTION_FAILED' || code === 'JOB_FAILED' || code === 'ROUTE_FAILED' || code === 'SNAPSHOT_FAILED') {
        if (NETWORK_HINTS.test(text)) return retryOutcome('network', at);
        if (MAINTENANCE_HINTS.test(message)) return retryOutcome('maintenance', at);
        if (input.retryable === false) return { status: 'failed', reason: 'unknown' };
        return retryOutcome('server-state', at);
    }
    if (input.retryable === true) return retryOutcome('unknown', at);
    return { status: 'failed', reason: 'unknown' };
}
