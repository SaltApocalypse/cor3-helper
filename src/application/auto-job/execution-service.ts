import { DECRYPT_CONDITION_TYPES, decryptFileType, isServerlessJob, type JobOffer } from '../../domains/jobs/model.js';
import type { GameError } from '../game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { JobExecutionPort, JobReward } from './runner.js';
import { conditionsOf, fileReferencesFromConditions, ipsFromConditions, type DownloadFile, type FileAnalysis, type JobActionPort } from './job-actions.js';
import type { MinigamePort } from './minigame-port.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';

export type JobExecutionErrorCode =
    | 'NO_SERVER'
    | 'TAKE_FAILED'
    | 'UNSUPPORTED_JOB_TYPE'
    | 'MINIGAME_REQUIRED'
    | 'MINIGAME_FAILED'
    | 'DECRYPT_POWER_INSUFFICIENT'
    | 'FILE_NOT_FOUND'
    | 'ACTION_FAILED'
    | 'PREFLIGHT_FAILED'
    | 'JOB_CANCELLED'
    | 'COMPLETE_FAILED';

export interface JobExecutionError {
    readonly code: JobExecutionErrorCode;
    readonly message: string;
    readonly retryable?: boolean;
    readonly retryAt?: number;
    readonly lockExpiresAt?: number;
    readonly stage?: string;
}

function stageForJobError(code: JobExecutionErrorCode): string {
    if (code === 'NO_SERVER') return 'route';
    if (code === 'TAKE_FAILED') return 'take';
    if (code === 'PREFLIGHT_FAILED') return 'preflight';
    if (code === 'JOB_CANCELLED') return 'cancelled';
    if (code === 'MINIGAME_REQUIRED' || code === 'MINIGAME_FAILED' || code === 'DECRYPT_POWER_INSUFFICIENT') return 'minigame';
    if (code === 'COMPLETE_FAILED') return 'complete';
    return 'action';
}

function retryableForJobError(code: JobExecutionErrorCode): boolean {
    return code === 'TAKE_FAILED'
        || code === 'MINIGAME_FAILED'
        || code === 'ACTION_FAILED'
        || code === 'FILE_NOT_FOUND';
}

function retryMetadata(source: { readonly message: string; readonly retryAt?: number; readonly lockExpiresAt?: number }): Pick<JobExecutionError, 'retryAt' | 'lockExpiresAt'> {
    if (source.retryAt !== undefined || source.lockExpiresAt !== undefined) {
        return {
            ...(source.retryAt !== undefined ? { retryAt: source.retryAt } : {}),
            ...(source.lockExpiresAt !== undefined ? { lockExpiresAt: source.lockExpiresAt } : {}),
        };
    }
    if (/rate[\s-]?limit|too many requests/i.test(source.message)) {
        return { retryAt: Date.now() + 60_000 };
    }
    if (/lock/i.test(source.message)) {
        const minutes = /(\d+)\s*m(?:in)?/i.exec(source.message);
        if (minutes?.[1]) {
            const at = Date.now() + Number(minutes[1]) * 60_000;
            return { retryAt: at, lockExpiresAt: at };
        }
        const seconds = /(\d+)\s*s(?:ec)?/i.exec(source.message);
        if (seconds?.[1]) {
            const at = Date.now() + Number(seconds[1]) * 1000;
            return { retryAt: at, lockExpiresAt: at };
        }
        if (/minigame[-\s]?lock|locked/i.test(source.message)) {
            const at = Date.now() + 20 * 60_000;
            return { retryAt: at, lockExpiresAt: at };
        }
    }
    return {};
}

export type JobCompletionHook = (job: JobOffer) => Promise<Result<void, GameError>>;
export type JobRefreshHook = (job: JobOffer) => Promise<Result<JobOffer, GameError>>;
export type JobDecryptHook = (job: JobOffer, file: DownloadFile, requiredPower?: number) => Promise<Result<void, GameError>>;
export type JobPreflightHook = (job: JobOffer) => Promise<Result<void, GameError>>;

/**
 * Executes job types backed by SAI/transit actions and the desktop decrypt flow.
 * ICE Wall minigames remain explicitly unsupported until their TS solver exists.
 */
export class JobExecutionService implements JobExecutionPort {
    constructor(
        private readonly actions: JobActionPort,
        private readonly beforeComplete?: JobCompletionHook,
        private readonly beforeDecrypt?: JobDecryptHook,
        private readonly minigames?: MinigamePort,
        private readonly beforeTake?: JobCompletionHook,
        private readonly beforeTarget?: JobCompletionHook,
        private readonly afterTake?: JobRefreshHook,
        private readonly beforeExecute?: JobPreflightHook,
        private readonly shouldStop?: () => boolean,
        private readonly pace?: () => Promise<void>,
        private readonly trace?: (message: string, data?: unknown) => void,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
    ) {}

    async execute(job: JobOffer): Promise<Result<JobReward, GameError>> {
        const result = await this.executeDetailed(job);
        if (!result.ok) {
            return err({
                code: result.error.code,
                message: result.error.message,
                retryable: result.error.retryable ?? retryableForJobError(result.error.code),
                stage: result.error.stage ?? stageForJobError(result.error.code),
                ...(result.error.retryAt !== undefined ? { retryAt: result.error.retryAt } : {}),
                ...(result.error.lockExpiresAt !== undefined ? { lockExpiresAt: result.error.lockExpiresAt } : {}),
            });
        }
        return ok(result.value);
    }

    async executeDetailed(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        if (this.shouldStop?.()) return err({ code: 'JOB_CANCELLED', message: 'Job run cancelled', retryable: false, stage: 'cancelled' });
        if (!job.serverId && !isServerlessJob(job.type)) {
            return err({ code: 'NO_SERVER', message: 'Job has no server id' });
        }
        if (job.alreadyTaken && job.canComplete) return this.complete(job);
        let current = job;
        if (!current.alreadyTaken) {
            // Serverless jobs still need a preflight (decrypt software and
            // minigame lock); target routing is simply skipped inside it.
            if (this.beforeExecute) {
                const preflight = await this.beforeExecute(current);
                if (!preflight.ok) {
                    return err({
                        code: 'PREFLIGHT_FAILED',
                        message: preflight.error.message,
                        retryable: false,
                        stage: 'preflight',
                    });
                }
            }
            if (this.beforeTake) {
                const market = await this.beforeTake(current);
                if (!market.ok) return err({ code: 'TAKE_FAILED', message: market.error.message, retryable: true, stage: 'take' });
            }
            const take = await this.actions.take(current);
            if (!take.ok) return err({ code: 'TAKE_FAILED', message: take.error.message, retryable: true, stage: 'take' });
            await this.pace?.();
            if (this.afterTake) {
                const refreshed = await this.afterTake(current);
                if (refreshed.ok) current = refreshed.value;
            }
            if (current.alreadyTaken && current.canComplete) return this.complete(current);
        }

        if (this.beforeTarget && current.serverId) {
            await this.pace?.();
            const target = await this.beforeTarget(current);
            if (!target.ok) return err({ code: 'ACTION_FAILED', message: target.error.message, retryable: true, stage: 'route' });
        }

        switch (current.type) {
            case 'IP Injection':
                return this.injectIps(current);
            case 'IP Cleanup':
                return this.cleanupIps(current);
            case 'File Elimination':
                return this.eliminateFile(current);
            case 'Log Deletion':
                return this.deleteLog(current);
            case 'Log Download':
                return this.downloadLog(current);
            case 'Data Upload':
                return this.uploadFile(current);
            case 'Data Download':
                return this.downloadFile(current);
            case 'File Decryption':
                return this.fileDecryption(current);
            case 'Decrypt & Extract':
                return this.decryptAndExtract(current);
            default:
                return err({ code: 'UNSUPPORTED_JOB_TYPE', message: `Unsupported job type: ${current.type}` });
        }
    }

    private async injectIps(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const ips = ipsFromConditions(job);
        if (ips.length === 0) return err({ code: 'ACTION_FAILED', message: 'No IPs found in job conditions' });
        for (const ip of ips) {
            const result = await this.actions.addTransit(job.serverId!, ip);
            if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
            await this.pace?.();
        }
        return this.complete(job);
    }

    private async cleanupIps(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        let ips = ipsFromConditions(job, 'DeleteIps');
        if (ips.length === 0) {
            const transit = await this.actions.getTransit(job.serverId!);
            if (transit.ok) {
                ips = transit.value.filter((entry) => entry.source === 'job' && entry.jobId === job.id).map((entry) => entry.ip);
            }
        }
        if (ips.length === 0) return err({ code: 'ACTION_FAILED', message: 'No IPs found to remove' });
        for (const ip of ips) {
            const result = await this.actions.removeTransit(job.serverId!, ip);
            if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
            await this.pace?.();
        }
        return this.complete(job);
    }

    private async eliminateFile(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const refs = fileReferencesFromConditions(job);
        const target = files.value.find((file) =>
            file.jobId === job.id
            || refs.some((ref) => ref.fileId === file.fileId || (ref.name !== undefined && ref.name === file.name)),
        ) ?? files.value.find((file) => file.source === 'job');
        if (!target) return this.complete(job);
        const result = await this.actions.deleteFile(job.serverId!, target.fileId);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job);
    }

    private async deleteLog(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const logs = await this.actions.getServerLogs(job.serverId!);
        if (!logs.ok) return err({ code: 'ACTION_FAILED', message: logs.error.message });
        const target = logs.value.find((log) => log.jobId === job.id);
        if (!target) return this.complete(job);
        const result = await this.actions.deleteLog(job.serverId!, target.seq);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job);
    }

    private async downloadLog(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const logs = await this.actions.getServerLogs(job.serverId!);
        if (!logs.ok) return err({ code: 'ACTION_FAILED', message: logs.error.message });
        const target = logs.value.find((log) => log.jobId === job.id);
        if (!target) return this.complete(job);
        const result = await this.actions.downloadLog(job.serverId!, target.seq);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job);
    }

    private async downloadFile(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const target = files.value.find((file) => file.jobId === job.id);
        if (!target) return this.complete(job);
        const result = await this.actions.downloadFile(job.serverId!, target.fileId);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        if (requiresDecrypt(job)) {
            const download = await this.findDownloadedFile(job, target.name);
            if (!download.ok) return download;
            return this.decryptAndComplete(job, download.value);
        }
        return this.complete(job);
    }

    private async fileDecryption(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const download = await this.findDownloadedFile(job);
        if (!download.ok) return download;
        return this.decryptAndComplete(job, download.value);
    }

    private async decryptAndExtract(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const target = files.value.find((file) => file.jobId === job.id);
        if (target) {
            const downloaded = await this.actions.downloadFile(job.serverId!, target.fileId);
            if (!downloaded.ok) return err({ code: 'ACTION_FAILED', message: downloaded.error.message });
        }
        const download = await this.findDownloadedFile(job, target?.name);
        if (!download.ok) return download;
        return this.decryptAndComplete(job, download.value);
    }

    private async findDownloadedFile(job: JobOffer, preferredName?: string): Promise<Result<DownloadFile, JobExecutionError>> {
        const folder = await this.actions.getDownloadsFolder();
        if (!folder.ok) return err({ code: 'FILE_NOT_FOUND', message: folder.error.message });
        const listing = await this.actions.openFolder(folder.value.id);
        if (!listing.ok) return err({ code: 'FILE_NOT_FOUND', message: listing.error.message });
        const files = listing.value;
        const refs = fileReferencesFromConditions(job, DECRYPT_CONDITION_TYPES);
        const expectedType = decryptFileType(job, preferredName)?.toLowerCase() ?? null;
        const matchesExpectedType = (file: DownloadFile): boolean =>
            expectedType === null || file.name.toLowerCase().endsWith(expectedType);
        const target =
            files.find((file) => job.fileInfo?.id === file.id && matchesExpectedType(file))
            ?? files.find((file) => refs.some((ref) => ref.fileId === file.id) && matchesExpectedType(file))
            ?? files.find((file) => job.fileInfo?.name !== undefined && job.fileInfo.name === file.name && matchesExpectedType(file))
            ?? files.find((file) => refs.some((ref) => ref.name !== undefined && ref.name === file.name) && matchesExpectedType(file))
            ?? (preferredName ? files.find((file) => baseName(file.name) === baseName(preferredName) && matchesExpectedType(file)) : undefined)
            // Data Download server files often use the original extension
            // (`.dat`) while the encrypted download gets a different suffix
            // (`.eb54x`). Match the base name when the suffix changed.
            ?? (preferredName ? files.find((file) => baseName(file.name) === baseName(preferredName) && file.isEncrypted === true) : undefined)
            ?? (preferredName ? files.find((file) => baseName(file.name) === baseName(preferredName)) : undefined)
            ?? files.find((file) => file.isEncrypted && matchesExpectedType(file))
            ?? files.find((file) => file.isNew && matchesExpectedType(file))
            ?? (expectedType === null ? files.at(-1) : undefined);
        if (!target) {
            this.trace?.('No downloaded file matched the job', {
                jobId: job.id,
                expectedType,
                preferredName: preferredName ?? null,
                fileInfo: job.fileInfo ?? null,
                refs,
                available: files.map((file) => file.name),
            });
            return err({
                code: 'FILE_NOT_FOUND',
                message: expectedType === null
                    ? 'No file found in the Downloads folder'
                    : `No downloaded file matching ${expectedType}`,
            });
        }
        return ok(target);
    }

    /**
     * Equipping a decrypt module can take a moment to be reflected in
     * `get.file.analysis`; an immediate re-read produced false "insufficient
     * power" skips right after a successful loadout plan.
     */
    private async analyzeFileAfterLoadout(fileId: string): Promise<Result<FileAnalysis, GameError>> {
        let analysis = await this.actions.getFileAnalysis(fileId);
        for (let attempt = 0; attempt < 2 && !(analysis.ok && analysis.value.canDecrypt === true); attempt++) {
            await this.sleep(700);
            analysis = await this.actions.getFileAnalysis(fileId);
        }
        return analysis;
    }

    private async activeMinigameLock(): Promise<number | null> {
        if (!this.actions.getMinigameLock) return null;
        const expiresAt = await this.actions.getMinigameLock();
        return expiresAt !== null && expiresAt > Date.now() ? expiresAt : null;
    }

    private lockedError(expiresAt: number): Result<JobReward, JobExecutionError> {
        const minutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60_000));
        return err({
            code: 'MINIGAME_FAILED',
            message: `Minigame locked (~${minutes}m remaining)`,
            retryable: true,
            retryAt: expiresAt,
            lockExpiresAt: expiresAt,
            stage: 'minigame',
        });
    }

    private async decryptAndComplete(job: JobOffer, file: DownloadFile): Promise<Result<JobReward, JobExecutionError>> {
        const initialLock = await this.activeMinigameLock();
        if (initialLock !== null) return this.lockedError(initialLock);
        // A decoded file can be picked up again when the user solved it manually
        // or when a previous run already decrypted it. Completing directly avoids
        // re-opening the minigame and avoids reporting "insufficient power (0)".
        this.trace?.(`Decrypt target file selected: ${file.name} (${file.id})`, { jobId: job.id, fileId: file.id, fileName: file.name, expectedType: decryptFileType(job, file.name), encrypted: file.isEncrypted });
        if (file.isEncrypted === false) return this.completeAfterDecrypt(job, file.id);
        let analysis = await this.actions.getFileAnalysis(file.id);
        this.trace?.(
            `Decrypt file analysis: canDecrypt=${analysis.ok ? analysis.value.canDecrypt : 'error'}, power=${analysis.ok ? analysis.value.decryptPower : '?'}`,
            {
                jobId: job.id,
                fileId: file.id,
                canDecrypt: analysis.ok ? analysis.value.canDecrypt : null,
                decryptPower: analysis.ok ? analysis.value.decryptPower : null,
            },
        );
        // Do not treat canDecrypt=false + power=0 as "already decrypted" when
        // the file's encrypted state is unknown. That combination can also mean
        // "no decrypt software is installed", which made jobs fail at completion
        // without ever trying the loadout. Known-decrypted files are handled by
        // the isEncrypted === false branch above; otherwise attempt decryption
        // and let the already-decrypted error path submit the job.
        // Only change the loadout when the current one cannot decrypt the file.
        // This avoids a burst of equip/unequip commands for files that are
        // already decryptable, which was a major source of rate limiting.
        if (!analysis.ok || analysis.value.canDecrypt !== true) {
            const requiredPower = analysis.ok && analysis.value.canDecrypt === false
                ? analysis.value.decryptPower ?? undefined
                : undefined;
            if (this.beforeDecrypt) {
                const ready = await this.beforeDecrypt(job, file, requiredPower);
                if (!ready.ok) {
                    return err({
                        code: ready.error.code === 'DECRYPT_POWER_INSUFFICIENT' ? 'DECRYPT_POWER_INSUFFICIENT' : 'ACTION_FAILED',
                        message: ready.error.message,
                        ...(ready.error.retryable !== undefined ? { retryable: ready.error.retryable } : {}),
                        stage: 'loadout',
                    });
                }
                analysis = await this.analyzeFileAfterLoadout(file.id);
                this.trace?.(
                    `Decrypt analysis after loadout: canDecrypt=${analysis.ok ? analysis.value.canDecrypt : 'error'}, power=${analysis.ok ? analysis.value.decryptPower : '?'}`,
                    {
                        jobId: job.id,
                        fileId: file.id,
                        fileName: file.name,
                        requiredPower: requiredPower ?? null,
                        canDecrypt: analysis.ok ? analysis.value.canDecrypt : null,
                        decryptPower: analysis.ok ? analysis.value.decryptPower : null,
                    },
                );
            }
        }
        if (analysis.ok && analysis.value.canDecrypt === false) {
            const zeroPower = analysis.value.decryptPower === null || analysis.value.decryptPower === 0;
            if (!zeroPower) {
                this.trace?.('Decrypt power still insufficient after loadout', {
                    jobId: job.id,
                    fileId: file.id,
                    fileName: file.name,
                    decryptPower: analysis.value.decryptPower,
                });
                return err({
                    code: 'DECRYPT_POWER_INSUFFICIENT',
                    message: `Insufficient decrypt power${analysis.value.decryptPower !== null ? ` (${analysis.value.decryptPower})` : ''}`,
                });
            }
            // power=0 with canDecrypt=false can mean "already decrypted", a
            // stale analysis, or no decrypt software. Try opening once and let
            // the game's already-decrypted/missing-software path decide.
            this.trace?.('Decrypt power is zero; attempting decryption', {
                jobId: job.id,
                fileId: file.id,
                fileName: file.name,
            });
        }
        if (!this.minigames) {
            return err({ code: 'MINIGAME_REQUIRED', message: 'No minigame adapter is configured' });
        }
        await this.pace?.();
        this.trace?.('Opening file for decryption', { jobId: job.id, fileId: file.id, fileName: file.name });
        const solving = this.minigames.solve(30_000);
        const opened = await this.actions.decryptFile(file.id);
        let openTimedOut = false;
        if (!opened.ok) {
            const message = opened.error.message;
            openTimedOut = opened.error.code === 'GAME_TIMEOUT'
                || /timed out waiting for desktop:decrypt\.file/i.test(message);
            if (!openTimedOut) {
                await this.minigames.cancel();
                if (message.includes('file-already-decrypted') || message.includes('cannot-read-sai-file')) {
                    // Conditions update shortly after decryption; use the retrying
                    // completion path instead of a single, easily-stale attempt.
                    return this.completeAfterDecrypt(job, file.id);
                }
                const lock = await this.activeMinigameLock();
                if (lock !== null) return this.lockedError(lock);
                return err({ code: 'ACTION_FAILED', message, ...retryMetadata(opened.error) });
            }
        }
        const result = await solving;
        if (openTimedOut) {
            const lock = await this.activeMinigameLock();
            if (lock !== null) return this.lockedError(lock);
            // The decrypt.file reply may only arrive after the minigame closes.
            // Never continue to completion when the file was not confirmed open:
            // it produced a burst of "job-conditions-not-met" retries in v2.
            return err({
                code: 'ACTION_FAILED',
                message: 'Timed out waiting for desktop:decrypt.file',
                retryable: true,
                stage: 'minigame',
            });
        }
        if (!result.ok) {
            const lock = await this.activeMinigameLock();
            if (lock !== null) return this.lockedError(lock);
            return err({ code: 'MINIGAME_FAILED', message: result.error.message, ...retryMetadata(result.error) });
        }
        if (!result.value.solved) {
            const lock = await this.activeMinigameLock();
            if (lock !== null) return this.lockedError(lock);
            // kind === 'none' means either no minigame appeared within the
            // detection window or another solver already owns the session.
            // Both are retryable, not success.
            const message = result.value.message ?? `${result.value.kind === 'none' ? 'no minigame detected' : `${result.value.kind} minigame was not solved`}`;
            return err({
                code: 'MINIGAME_FAILED',
                message,
                retryable: true,
                stage: 'minigame',
            });
        }
        const finalLock = await this.activeMinigameLock();
        if (finalLock !== null) return this.lockedError(finalLock);
        // The game updates job conditions slightly after the minigame closes.
        // v1 waited here and retried completion; doing the same avoids marking the
        // first successful decryption as failed while it is still "ready to claim".
        await this.sleep(1500);
        return this.completeAfterDecrypt(job, file.id);
    }

    private async completeAfterDecrypt(job: JobOffer, fileId: string): Promise<Result<JobReward, JobExecutionError>> {
        let current = job;
        let last = await this.complete(current);
        // Completion can fail because the game has not refreshed conditions yet,
        // the market endpoint was briefly unreachable, or the WS was reconnecting.
        // Refresh the job row before each retry: the deferred run-level pass proved
        // that a fresh market snapshot often sees the job as claimable while the
        // stale row still says "conditions not met".
        for (let attempt = 0; attempt < 3 && !last.ok; attempt++) {
            this.trace?.(`Completion attempt failed (${attempt + 1}): ${last.error.code} — ${last.error.message}`, { jobId: current.id, attempt: attempt + 1, code: last.error.code, message: last.error.message });
            if (last.error.code !== 'COMPLETE_FAILED' || /token|not found|stale/i.test(last.error.message)) return last;
            if (/conditions.*not.*met|not met/i.test(last.error.message) && attempt < 2) {
                await this.pace?.();
                await this.reopenFileForCompletion(fileId);
            }
            current = await this.refreshForCompletion(current);
            await this.sleep(3000);
            last = await this.complete(current);
        }
        return last;
    }

    /**
     * Fetches the job row again after a completion failure. The game updates
     * job conditions after the decrypt minigame closes; retrying against a stale
     * row produces "retry" labels even though the job is already claimable.
     */
    private async refreshForCompletion(job: JobOffer): Promise<JobOffer> {
        if (!this.afterTake) return job;
        const refreshed = await this.afterTake(job);
        if (!refreshed.ok) return job;
        return refreshed.value;
    }

    /**
     * v1 nudged the game by re-opening an already processed file when the
     * completion conditions lagged behind the decryption result. Do the same
     * only a couple of times so it does not turn into a command burst.
     */
    private async reopenFileForCompletion(fileId: string): Promise<void> {
        if (!this.minigames) {
            await this.actions.decryptFile(fileId);
            return;
        }
        const solving = this.minigames.solve(5_000);
        const opened = await this.actions.decryptFile(fileId);
        if (opened.ok || opened.error.code === 'GAME_TIMEOUT') {
            await solving;
            return;
        }
        await this.minigames.cancel();
        await solving;
    }

    private async uploadFile(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        if (!job.serverId) return err({ code: 'NO_SERVER', message: 'Job has no target server for upload' });
        let fileName = job.fileInfo?.name ?? null;
        if (!fileName) {
            for (const condition of conditionsOf(job)) {
                if (condition.type === 'UploadFile' && condition.details?.files?.[0]?.name) {
                    fileName = condition.details.files[0].name;
                    break;
                }
            }
        }
        if (!fileName) return err({ code: 'ACTION_FAILED', message: 'No upload file found' });
        const result = await this.actions.uploadFile(job.serverId, fileName);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job);
    }

    private async complete(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        await this.pace?.();
        if (this.beforeComplete) {
            const hook = await this.beforeComplete(job);
            if (!hook.ok) return err({ code: 'COMPLETE_FAILED', message: hook.error.message, ...retryMetadata(hook.error) });
        }
        const result = await this.actions.complete(job);
        if (!result.ok) return err({ code: 'COMPLETE_FAILED', message: result.error.message, ...retryMetadata(result.error) });
        return ok(result.value);
    }
}

function requiresDecrypt(job: JobOffer): boolean {
    return conditionsOf(job).some((condition) => condition.type === 'DecryptFile' || condition.type === 'DecryptDownloadedFile');
}

function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, '');
}
