import type { DownloadFile, FileAnalysis, JobActionPort, ServerFile, ServerLog, TransitEntry } from '../../application/auto-job/job-actions.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { GameError } from '../../application/game/ports.js';
import { unwrapTabResult } from './tab-response.js';
import type { JobReward } from '../../application/auto-job/runner.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabJobActionAdapter implements JobActionPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async take(job: JobOffer): Promise<Result<void, GameError>> {
        return this.command('V2_JOB_TAKE', { marketId: job.marketId, jobId: job.id });
    }

    async complete(job: JobOffer): Promise<Result<JobReward, GameError>> {
        let result: Result<void, GameError>;
        try {
            result = await this.command('V2_JOB_COMPLETE', { marketId: job.marketId, jobId: job.id });
        } catch (error) {
            return err({
                code: 'JOB_ACTION_FAILED',
                message: error instanceof Error ? error.message : String(error),
                unconfirmed: true,
            });
        }
        if (!result.ok) {
            // JOB_ACTION_FAILED covers an invalid/no response or a candidate
            // error without a code. Default to unknown, not a business retry.
            return result.error.code === 'JOB_ACTION_FAILED' && result.error.unconfirmed === undefined
                ? err({ ...result.error, unconfirmed: true })
                : result;
        }
        return ok({ credits: job.rewardCredits, reputation: job.rewardReputation, renown: 0 });
    }

    async getServerFiles(serverId: string): Promise<Result<readonly ServerFile[], GameError>> {
        const result = await this.action('getFiles', { serverId });
        if (!result.ok) return result;
        const data = result.value as { files?: unknown } | null;
        if (!Array.isArray(data?.files)) return ok([]);
        return ok(data.files.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object').map((entry) => ({
            fileId: typeof entry.fileId === 'string' ? entry.fileId : '',
            name: typeof entry.name === 'string' ? entry.name : '',
            ...(typeof entry.jobId === 'string' ? { jobId: entry.jobId } : {}),
            ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
            ...(entry.isEncrypted === true ? { isEncrypted: true } : {}),
        })).filter((entry) => entry.fileId.length > 0));
    }

    async deleteFile(serverId: string, fileId: string): Promise<Result<void, GameError>> {
        return this.actionVoid('deleteFile', { serverId, fileId });
    }

    async getServerLogs(serverId: string): Promise<Result<readonly ServerLog[], GameError>> {
        const result = await this.action('getLogs', { serverId });
        if (!result.ok) return result;
        const data = result.value as { logs?: unknown } | null;
        if (!Array.isArray(data?.logs)) return ok([]);
        return ok(data.logs.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object').map((entry) => ({
            seq: typeof entry.seq === 'number' ? entry.seq : 0,
            message: typeof entry.message === 'string' ? entry.message : '',
            ...(typeof entry.jobId === 'string' ? { jobId: entry.jobId } : {}),
        })).filter((entry) => entry.seq > 0));
    }

    async deleteLog(serverId: string, seq: number): Promise<Result<void, GameError>> {
        return this.actionVoid('deleteLog', { serverId, seq });
    }

    async downloadLog(serverId: string, seq: number): Promise<Result<void, GameError>> {
        return this.actionVoid('downloadLog', { serverId, seq });
    }

    async downloadFile(serverId: string, fileId: string): Promise<Result<void, GameError>> {
        return this.actionVoid('downloadFile', { serverId, fileId });
    }

    async getTransit(serverId: string): Promise<Result<readonly TransitEntry[], GameError>> {
        const result = await this.action('getTransit', { serverId });
        if (!result.ok) return result;
        const data = result.value as { ips?: unknown } | null;
        if (!Array.isArray(data?.ips)) return ok([]);
        return ok(data.ips.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object').map((entry) => ({
            ip: typeof entry.ip === 'string' ? entry.ip : '',
            ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
            ...(typeof entry.jobId === 'string' ? { jobId: entry.jobId } : {}),
        })).filter((entry) => entry.ip.length > 0));
    }

    async addTransit(serverId: string, ip: string): Promise<Result<void, GameError>> {
        return this.actionVoid('addTransit', { serverId, ip, description: '' });
    }

    async removeTransit(serverId: string, ip: string): Promise<Result<void, GameError>> {
        return this.actionVoid('removeTransit', { serverId, ip });
    }

    async uploadFile(serverId: string, name: string): Promise<Result<void, GameError>> {
        return this.actionVoid('uploadFile', { serverId, name, sizeMb: 0 });
    }

    async getDownloadsFolder(): Promise<Result<{ readonly id: string }, GameError>> {
        const result = await this.action('getDesktopOptions', {});
        if (!result.ok) return result;
        const data = result.value as { folders?: unknown } | null;
        if (!Array.isArray(data?.folders)) {
            return err({ code: 'DOWNLOAD_FOLDER_MISSING', message: 'No desktop folders returned' });
        }
        for (const raw of data.folders) {
            if (!raw || typeof raw !== 'object') continue;
            const entry = raw as { id?: unknown; name?: unknown };
            if (entry.name === 'Downloads' && typeof entry.id === 'string') return ok({ id: entry.id });
        }
        return err({ code: 'DOWNLOAD_FOLDER_MISSING', message: 'Downloads folder not found' });
    }

    async openFolder(folderId: string): Promise<Result<readonly DownloadFile[], GameError>> {
        const result = await this.action('openFolder', { folderId, source: 'desktop' });
        if (!result.ok) return result;
        const data = result.value as { files?: unknown } | null;
        if (!Array.isArray(data?.files)) return ok([]);
        const files: DownloadFile[] = [];
        for (const raw of data.files) {
            if (!raw || typeof raw !== 'object') continue;
            const entry = raw as { id?: unknown; name?: unknown; isEncrypted?: unknown; isNew?: unknown };
            if (typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
            files.push({
                id: entry.id,
                name: entry.name,
                ...(entry.isEncrypted === true ? { isEncrypted: true } : {}),
                ...(entry.isNew === true ? { isNew: true } : {}),
            });
        }
        return ok(files);
    }

    async getFileAnalysis(fileId: string): Promise<Result<FileAnalysis, GameError>> {
        const result = await this.action('getFileAnalysis', { fileId, source: 'desktop' });
        if (!result.ok) return result;
        const data = result.value as { canDecrypt?: unknown; decryptPower?: unknown } | null;
        const tags = Array.isArray((data as { tags?: unknown } | null)?.tags)
            ? ((data as { tags: unknown[] }).tags).map(String).filter((tag) => tag.length > 0)
            : [];
        return ok({
            canDecrypt: typeof data?.canDecrypt === 'boolean' ? data.canDecrypt : null,
            decryptPower: typeof data?.decryptPower === 'number' ? data.decryptPower : null,
            tags,
            source: typeof (data as { source?: unknown } | null)?.source === 'string' ? (data as { source: string }).source : null,
        });
    }

    async decryptFile(fileId: string): Promise<Result<void, GameError>> {
        return this.actionVoid('decryptFile', { fileId });
    }

    async getMinigameLock(): Promise<number | null> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return null;
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_MINIGAME_LOCK' });
            const candidate = response as { ok?: unknown; value?: unknown } | null;
            return candidate?.ok === true && typeof candidate.value === 'number' ? candidate.value : null;
        } catch {
            return null;
        }
    }

    private async action(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        const response = await this.tabs.send(tabId, { type: 'V2_JOB_ACTION', kind, payload });
        return unwrapTabResult(response, { code: 'JOB_ACTION_FAILED', message: 'Job action failed' });
    }

    private async actionVoid(kind: string, payload: Record<string, unknown>): Promise<Result<void, GameError>> {
        const result = await this.action(kind, payload);
        return result.ok ? ok(undefined) : result;
    }

    private async command(type: string, payload: Record<string, unknown>): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        const result = unwrapTabResult(await this.tabs.send(tabId, { type, ...payload }), { code: 'JOB_ACTION_FAILED', message: 'Job action failed' });
        return result.ok ? ok(undefined) : result;
    }

}
