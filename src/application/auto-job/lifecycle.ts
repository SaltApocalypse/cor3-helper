import type { JobLifecycleStatus } from '../../contracts/job-state.js';
import { isExpiredJobFailureText } from './expiry.js';

export interface JobLifecycleFailure {
    readonly code: string;
    readonly message: string;
    readonly stage?: string | undefined;
    readonly retryAt?: number | undefined;
    readonly lockExpiresAt?: number | undefined;
}

const UNCONFIRMED_RESULT = /timeout|timed out|no response|response (?:lost|missing)|lost response|disconnected|socket|connection (?:reset|closed|refused)|econn|not[-\s]?reachable|unknown (?:result|outcome)/i;
const MINIGAME_LOCK = /minigame.*lock|lock(?:ed)?.*minigame|locked\s*\(/i;
const CONDITIONS_NOT_MET = /conditions?.*not.*met|not met|not ready|still.*process/i;

/**
 * Maps a final execution error to the local lifecycle record. "completed" is
 * never derived here; only an explicit successful complete may write it.
 */
export function lifecycleStatusForFailure(error: JobLifecycleFailure): JobLifecycleStatus {
    const text = `${error.code} ${error.message}`;
    if (isExpiredJobFailureText(error.code, error.message)) return 'expired';
    if (error.code === 'JOB_CANCELLED' || error.stage === 'cancelled') return 'blocked';
    if (error.lockExpiresAt !== undefined
        || error.code === 'MINIGAME_FAILED'
        || error.code === 'MINIGAME_DISABLED'
        || MINIGAME_LOCK.test(text)) {
        return 'waiting-minigame';
    }
    // A timeout or lost reply does not prove the remote mutation failed.
    if (error.code === 'GAME_TIMEOUT' || UNCONFIRMED_RESULT.test(text)) return 'unknown';
    if (error.code === 'PREFLIGHT_FAILED'
        || error.code === 'NO_SERVER'
        || error.code === 'UNSUPPORTED_JOB_TYPE'
        || error.code === 'MINIGAME_REQUIRED'
        || (error.code === 'ACTION_FAILED' && (error.stage === 'route' || error.stage === 'preflight'))) {
        return 'blocked';
    }
    if (error.code === 'COMPLETE_FAILED' && CONDITIONS_NOT_MET.test(text)) return 'ready-to-claim';
    return 'failed';
}
