import { JOB_TYPES, type JobType } from '../../kernel/job-types.js';
import type { JobCondition, JobOffer } from '../../contracts/jobs.js';

export { JOB_TYPES, type JobType };
export type { JobCondition, JobOffer };

export const JOB_TYPE_PRIORITY: readonly JobType[] = [
    'IP Injection', 'IP Cleanup', 'Data Upload', 'Data Download',
    'Log Deletion', 'Log Download', 'File Elimination', 'File Decryption', 'Decrypt & Extract',
];

export interface JobSelectionOptions {
    readonly completedIds?: ReadonlySet<string>;
    readonly supportedTypes?: ReadonlySet<string>;
    readonly serverPriority: (serverName: string | null, job: JobOffer) => number;
}

/** File Decryption works on a local downloaded file and has no target server. */
export function isServerlessJob(type: JobType): boolean {
    return type === 'File Decryption';
}

function normalizeFileType(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function extensionOf(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = /(\.[A-Za-z0-9]+)$/.exec(value.trim());
    return match ? normalizeFileType(match[1]) : null;
}

/**
 * Resolves the decrypt target type (for example `.doc`) from job conditions,
 * the job file info, or the downloaded file name. v1 used the condition's
 * `fileExtension`; modern job rows sometimes only carry the file object.
 */
export function decryptFileType(job: JobOffer, fileName?: string): string | null {
    for (const condition of job.conditions ?? []) {
        const sources: unknown[] = [condition.details?.fileExtension, condition.fileExtension];
        for (const source of sources) {
            if (typeof source !== 'string') continue;
            const normalized = normalizeFileType(source);
            if (normalized) return normalized;
        }
        for (const file of condition.details?.files ?? []) {
            const extension = file.fileExtension ?? file.extension;
            if (typeof extension === 'string') {
                const normalized = normalizeFileType(extension);
                if (normalized) return normalized;
            }
        }
    }
    const fromJobFile = extensionOf(job.fileInfo?.name);
    if (fromJobFile) return fromJobFile;
    const fromDownload = extensionOf(fileName);
    if (fromDownload) return fromDownload;
    for (const condition of job.conditions ?? []) {
        const type = condition.type;
        if (type !== undefined && type !== 'DecryptFile' && type !== 'DecryptDownloadedFile') continue;
        for (const file of condition.details?.files ?? []) {
            const name = typeof file.name === 'string' ? file.name : undefined;
            const fromCondition = extensionOf(name);
            if (fromCondition) return fromCondition;
        }
    }
    return null;
}

export function isBuggedJob(job: JobOffer): boolean {
    return job.serverName === 'D4RK RM7CE' && (job.type === 'Log Deletion' || job.type === 'Log Download');
}

export function selectJobs(offers: readonly JobOffer[], options: JobSelectionOptions): JobOffer[] {
    const completed = options.completedIds ?? new Set<string>();
    const supported = options.supportedTypes;
    return offers
        .filter((job) => !completed.has(job.id))
        .filter((job) => !supported || supported.has(job.type))
        .filter((job) => !isBuggedJob(job))
        .sort((a, b) => {
            const server = options.serverPriority(a.serverName, a) - options.serverPriority(b.serverName, b);
            if (server !== 0) return server;
            const typeA = JOB_TYPE_PRIORITY.indexOf(a.type);
            const typeB = JOB_TYPE_PRIORITY.indexOf(b.type);
            return (typeA < 0 ? JOB_TYPE_PRIORITY.length : typeA) - (typeB < 0 ? JOB_TYPE_PRIORITY.length : typeB);
        });
}
