/**
 * Job type identifiers shared by the domain, contracts, and UI. Kept in the
 * kernel so contracts do not depend on a domain module.
 */
export const JOB_TYPES = [
    'File Decryption',
    'IP Injection',
    'Data Download',
    'Log Deletion',
    'Log Download',
    'Decrypt & Extract',
    'File Elimination',
    'Data Upload',
    'IP Cleanup',
] as const;

export type JobType = typeof JOB_TYPES[number];
