import type { JobOffer, JobCondition } from '../../domains/jobs/model.js';
import type { GameError } from '../game/ports.js';
import type { Result } from '../../kernel/result.js';
import type { JobReward } from './runner.js';

export interface ServerFile {
    readonly fileId: string;
    readonly name: string;
    readonly jobId?: string;
    readonly source?: string;
    readonly isEncrypted?: boolean;
}

export interface ServerLog {
    readonly seq: number;
    readonly message: string;
    readonly jobId?: string;
}

export interface TransitEntry {
    readonly ip: string;
    readonly source?: string;
    readonly jobId?: string;
}

export interface DownloadFile {
    readonly id: string;
    readonly name: string;
    readonly isEncrypted?: boolean;
    readonly isNew?: boolean;
}

export interface FileAnalysis {
    readonly canDecrypt: boolean | null;
    readonly decryptPower: number | null;
    readonly tags: readonly string[];
    readonly source: string | null;
}

export interface JobActionPort {
    take(job: JobOffer): Promise<Result<void, GameError>>;
    complete(job: JobOffer): Promise<Result<JobReward, GameError>>;
    getServerFiles(serverId: string): Promise<Result<readonly ServerFile[], GameError>>;
    deleteFile(serverId: string, fileId: string): Promise<Result<void, GameError>>;
    getServerLogs(serverId: string): Promise<Result<readonly ServerLog[], GameError>>;
    deleteLog(serverId: string, seq: number): Promise<Result<void, GameError>>;
    downloadLog(serverId: string, seq: number): Promise<Result<void, GameError>>;
    downloadFile(serverId: string, fileId: string): Promise<Result<void, GameError>>;
    getTransit(serverId: string): Promise<Result<readonly TransitEntry[], GameError>>;
    addTransit(serverId: string, ip: string): Promise<Result<void, GameError>>;
    removeTransit(serverId: string, ip: string): Promise<Result<void, GameError>>;
    uploadFile(serverId: string, name: string): Promise<Result<void, GameError>>;
    getDownloadsFolder(): Promise<Result<{ readonly id: string }, GameError>>;
    openFolder(folderId: string): Promise<Result<readonly DownloadFile[], GameError>>;
    getFileAnalysis(fileId: string): Promise<Result<FileAnalysis, GameError>>;
    decryptFile(fileId: string): Promise<Result<void, GameError>>;
    getMinigameLock?(): Promise<number | null>;
}

export function conditionsOf(job: JobOffer): readonly JobCondition[] {
    return job.conditions ?? [];
}

export function ipsFromConditions(job: JobOffer, type?: string): string[] {
    for (const condition of conditionsOf(job)) {
        if (type && condition.type && condition.type !== type) continue;
        if (condition.details?.ips?.length) return [...condition.details.ips];
        if (condition.ip) return [condition.ip];
        if (condition.targetIp) return [condition.targetIp];
    }
    return [];
}

export interface FileReference {
    readonly fileId?: string;
    readonly name?: string;
}

export function fileReferencesFromConditions(job: JobOffer): FileReference[] {
    const refs: FileReference[] = [];
    for (const condition of conditionsOf(job)) {
        if (condition.details?.fileIds) {
            for (const fileId of condition.details.fileIds) refs.push({ fileId });
        }
    }
    for (const condition of conditionsOf(job)) {
        const candidates: unknown[] = [condition, condition.details];
        for (const candidate of candidates) {
            if (!candidate || typeof candidate !== 'object') continue;
            const entry = candidate as { fileId?: unknown; id?: unknown; fileName?: unknown; name?: unknown };
            const fileId = typeof entry.fileId === 'string' ? entry.fileId : typeof entry.id === 'string' ? entry.id : undefined;
            const name = typeof entry.fileName === 'string' ? entry.fileName : typeof entry.name === 'string' ? entry.name : undefined;
            if (fileId || name) refs.push({ ...(fileId ? { fileId } : {}), ...(name ? { name } : {}) });
        }
    }
    return refs;
}
