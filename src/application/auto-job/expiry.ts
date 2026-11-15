const EXPIRED_HINTS = [
    'expire',
    'time limit',
    'too late',
    'deadline',
    'no longer available',
    'not available anymore',
    'job-not-found',
    'job-not-available',
    'already completed',
    'already-completed',
    'job-completed',
];

/**
 * The game reports expired jobs as FAILED. The extension keeps treating them as
 * failures internally, but this helper lets the UI label them as expired.
 */
export function isExpiredJobFailureText(code: string, message: string): boolean {
    const text = `${code} ${message}`.toLowerCase();
    if (text.includes('token')) return false;
    return EXPIRED_HINTS.some((hint) => text.includes(hint));
}
