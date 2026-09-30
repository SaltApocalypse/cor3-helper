// Human-friendly error message mappings for common server errors
export var ERROR_MAP = {
    'sai-transit-ip-duplicate': 'IP already exists on server',
    'sai-transit-ip-limit': 'Server IP limit reached',
    'no-path-to-server': 'No path to server (unreachable)',
    'server-in-maintenance': 'Server is in maintenance',
    'sai-missing-software': 'Missing required software',
    'missing-software': 'Missing required software',
    'sai-hack-impossible': 'Not enough hack power',
    'sai-no-hack-software': 'No hacking software',
    'cannot-read-sai-file': 'Cannot read SAI file',
    'invalid-access-token': 'Access token expired or invalid',
    'token-expired': 'Session token expired',
    'job-already-taken': 'Job already taken previously',
    'job-not-found': 'Job no longer available',
    'job-expired': 'Job has expired',
    'job-conditions-not-met': 'Job conditions not met',
    'sai-file-not-found': 'File not found on server',
    'sai-log-not-found': 'Log not found on server',
    'sai-access-denied': 'Access denied to server',
    'rate-limited': 'Rate limited — too many requests',
    'file-not-found': 'File not found on server/folder',
    'market-not-reachable': 'Market not reachable',
    'Error: File is encrypted': 'Unable to decrypt that file extension. Please install the appropriate decryption software',
    'insufficient_power': 'Insufficient decrypt power for this file',
    'file-already-decrypted': 'File is already decrypted',
    'job-is-not-available': 'Job is not available (stale data)'
};

export function friendlyError(errMsg, failedConditions) {
    if (!errMsg) return 'Unknown error';
    var friendly = '';
    // Check for exact match first
    if (ERROR_MAP[errMsg]) {
        friendly = ERROR_MAP[errMsg];
    } else {
        // Check for partial match (error message contains a known key)
        var keys = Object.keys(ERROR_MAP);
        for (var i = 0; i < keys.length; i++) {
            if (errMsg.indexOf(keys[i]) >= 0) {
                friendly = ERROR_MAP[keys[i]];
                break;
            }
        }
    }
    if (!friendly) friendly = errMsg;
    if (failedConditions && Array.isArray(failedConditions) && failedConditions.length > 0) {
        friendly += ' (' + failedConditions.join(', ') + ')';
    }
    return friendly;
}
