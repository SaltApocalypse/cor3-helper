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

export const DECRYPT_CONDITION_TYPES = ['DecryptFile', 'DecryptDownloadedFile'] as const;
const GENERIC_ENCRYPTED_EXTENSIONS = new Set(['.enc', '.bin']);

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

function isDecryptCondition(condition: JobCondition): boolean {
    return condition.type !== undefined
        && (DECRYPT_CONDITION_TYPES as readonly string[]).includes(condition.type);
}

export type DecryptFileTypeOptions = {
    /** The supplied file name is the actual downloaded file, not a server-side name. */
    readonly preferFileName?: boolean;
};

/** `.enc`/`.bin` are common encrypted containers, not reliable decrypt formats. */
export function isGenericEncryptedFileType(value: string | null | undefined): boolean {
    const normalized = normalizeFileType(value)?.toLowerCase();
    return normalized === '.enc' || normalized === '.bin';
}

/**
 * Resolves the decrypt target type (for example `.doc`) from decrypt-related
 * job conditions, the job file info, or the downloaded file name.
 *
 * Do not read file extensions from unrelated conditions: upload/download jobs
 * can carry a generic `.enc` (or `.bin`) file while the decrypt condition uses
 * the real extension, for example `.eb52x`.
 */
export function decryptFileType(
    job: JobOffer,
    fileName?: string,
    options: DecryptFileTypeOptions = {},
): string | null {
    const candidates: string[] = [];
    const addExtension = (value: unknown): void => {
        if (typeof value !== 'string') return;
        const normalized = normalizeFileType(value);
        if (normalized) candidates.push(normalized);
    };
    const addFileName = (value: unknown): void => {
        if (typeof value !== 'string') return;
        const extension = extensionOf(value);
        if (extension) candidates.push(extension);
    };

    // The actual downloaded file is the most concrete source when available.
    if (options.preferFileName) addFileName(fileName);

    for (const condition of job.conditions ?? []) {
        if (!isDecryptCondition(condition)) continue;
        addExtension(condition.details?.fileExtension);
        addExtension(condition.fileExtension);
        for (const file of condition.details?.files ?? []) {
            addFileName(file.name);
            addExtension(file.fileExtension ?? file.extension);
        }
    }

    // The downloaded file name and job file info are more concrete than a
    // generic encrypted extension on the condition itself.
    addFileName(job.fileInfo?.name);
    if (!options.preferFileName) addFileName(fileName);

    if (candidates.length === 0) return null;
    // Prefer a real format over a generic encrypted wrapper when both exist.
    return candidates.find((entry) => !GENERIC_ENCRYPTED_EXTENSIONS.has(entry.toLowerCase()))
        ?? candidates[0]!;
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
