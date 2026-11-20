import { DECRYPT_CONDITION_TYPES, decryptFileType, isServerlessJob, type JobOffer } from '../../domains/jobs/model.js';
import type { GameError } from '../game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { JobExecutionPort, JobReward } from './runner.js';
import { conditionsOf, fileReferencesFromConditions, ipsFromConditions, type DownloadFile, type FileAnalysis, type JobActionPort } from './job-actions.js';
import type { MinigamePort } from './minigame-port.js';
import type { JobStateRecorderPort, JobStateSession } from './job-state-recorder.js';
import type { JobStateStorePort } from './job-state-port.js';
import type { JobRefreshHook, JobRefreshResult } from './refresh-outcome.js';
import { isCompletionUncertainRecord, JOB_STATE_UNKNOWN_RESET, jobActiveKey, normalizeJobStateResetAt } from '../../contracts/job-state.js';
import { lifecycleStatusForFailure } from './lifecycle.js';
import { CompletionRecordWriter } from './completion-record.js';
import type { MarketCompletionStorePort } from './market-completion.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';

/** Bounded wait for a background solver to make the job claimable. */
const SOLVER_HANDOFF_DEADLINE_MS = 30_000;
const SOLVER_HANDOFF_INTERVAL_MS = 3_000;
const UNCONFIRMED_COMPLETE_CODES = new Set(['GAME_TIMEOUT', 'GAME_NO_SOCKET', 'JOB_COMMAND_FAILED', 'JOB_ACTION_FAILED', 'GAME_DISCONNECTED', 'GAME_SOCKET_CLOSED']);
// Only locally-generated pre-send failures are provably safe to retry.
const EXPLICIT_COMPLETE_CODES = new Set(['NO_COR3_TAB', 'INVALID_JOB']);

function unconfirmedCompleteError(error: GameError): boolean {
    if (error.unconfirmed !== undefined) return error.unconfirmed;
    if (UNCONFIRMED_COMPLETE_CODES.has(error.code)) return true;
    if (EXPLICIT_COMPLETE_CODES.has(error.code)) return false;
    // Unknown codes are not proof of a business rejection. Default to the
    // conservative outcome so a lost reply cannot trigger a second Complete.
    // GAME_JOB_FAILED is deliberately not explicit: it is the socket fallback
    // for code-less error frames and has no protocol guarantee that the state
    // did not change.
    return true;
}

function comparableReset(resetAt: string | null | undefined): string | null {
    const normalized = normalizeJobStateResetAt(resetAt);
    if (normalized === null) return null;
    return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

export type JobExecutionErrorCode =
    | 'NO_SERVER'
    | 'TAKE_FAILED'
    | 'UNSUPPORTED_JOB_TYPE'
    | 'MINIGAME_REQUIRED'
    | 'MINIGAME_FAILED'
    | 'MINIGAME_DISABLED'
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
    /** Complete reached an indeterminate transport result; do not resend blindly. */
    readonly unconfirmed?: boolean;
}

function stageForJobError(code: JobExecutionErrorCode): string {
    if (code === 'NO_SERVER') return 'route';
    if (code === 'TAKE_FAILED') return 'take';
    if (code === 'PREFLIGHT_FAILED') return 'preflight';
    if (code === 'JOB_CANCELLED') return 'cancelled';
    if (code === 'MINIGAME_REQUIRED' || code === 'MINIGAME_FAILED' || code === 'MINIGAME_DISABLED' || code === 'DECRYPT_POWER_INSUFFICIENT') return 'minigame';
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
        // Only minigame/decrypt/hack lock text may block the job for a long
        // window. A generic "locked" server/file message gets a short retry so
        // it cannot strand a claimable job until the next market reset.
        const lockContext = /minigame|decrypt|ice[\s-]?wall|hack/i.test(source.message);
        if (lockContext) {
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
            return { retryAt: Date.now() + 20 * 60_000, lockExpiresAt: Date.now() + 20 * 60_000 };
        }
        return { retryAt: Date.now() + 60_000 };
    }
    return {};
}

export type JobCompletionHook = (job: JobOffer) => Promise<Result<void, GameError>>;
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
        private readonly stateRecorder?: JobStateRecorderPort,
        private readonly solverHandoffDeadlineMs: number = SOLVER_HANDOFF_DEADLINE_MS,
        private readonly completions?: MarketCompletionStorePort,
        private readonly jobStates?: Pick<JobStateStorePort, 'get' | 'list'>,
        private readonly resetAtForMarket?: (marketKey: string) => string | null,
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
                ...(result.error.unconfirmed === true ? { unconfirmed: true } : {}),
            });
        }
        return ok(result.value);
    }

    async executeDetailed(job: JobOffer): Promise<Result<JobReward, JobExecutionError>> {
        // Capture the execution identity once, before any store/session work.
        // It must not be replaced by a snapshot read at Complete time.
        const executionResetAt = comparableReset(this.resetAtForMarket?.(job.marketKey));
        const state = await this.startJobState(job, this.resetAtForMarket ? executionResetAt : undefined);
        const result = await this.executeJob(job, state, executionResetAt);
        if (!result.ok) {
            if (state === null && result.error.unconfirmed === true) {
                await this.rememberUnconfirmedCompletion(job, null, executionResetAt);
            }
            try {
                await state?.transition(lifecycleStatusForFailure({
                    ...result.error,
                    ...(result.error.unconfirmed !== undefined ? { unconfirmed: result.error.unconfirmed } : {}),
                }), {
                    errorCode: result.error.code,
                    message: result.error.message,
                    ...(result.error.stage !== undefined ? { stage: result.error.stage } : {}),
                    ...(result.error.unconfirmed === true ? { unconfirmed: true } : {}),
                });
            } catch (error) {
                // The primary Job State write failed. Persist the durable
                // fallback barrier in the completion store and fail closed for
                // the rest of this runtime if even that fails.
                await this.rememberUnconfirmedCompletion(job, state, executionResetAt);
                this.trace?.('Failed to persist unconfirmed Job State', {
                    jobId: job.id,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return result;
    }

    private async startJobState(job: JobOffer, executionResetAt: string | null | undefined): Promise<JobStateSession | null> {
        if (!this.stateRecorder) return null;
        try {
            return await this.stateRecorder.start(job, executionResetAt);
        } catch (error) {
            // Recording is observational; a recorder bug must not stop the job.
            this.trace?.('Failed to start job lifecycle record', {
                jobId: job.id,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    private async executeJob(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        if (this.shouldStop?.()) return err({ code: 'JOB_CANCELLED', message: 'Job run cancelled', retryable: false, stage: 'cancelled' });
        const blocked = await this.completionBarrier(job, state);
        if (blocked) return err(blocked);
        // Completion is the only remaining step for a claimable job. It must
        // not be rejected for a missing target server or a disabled type.
        if (job.alreadyTaken && job.canComplete) {
            return this.complete(job, state, executionResetAt);
        }
        if (!job.serverId && !isServerlessJob(job.type)) {
            return err({ code: 'NO_SERVER', message: 'Job has no server id' });
        }
        let current = job;
        if (!current.alreadyTaken) {
            await state?.transition('available');
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
            // The take request may mutate remote state; record the intent first.
            await state?.transition('taking');
            const take = await this.actions.take(current);
            if (!take.ok) return err({ code: 'TAKE_FAILED', message: take.error.message, retryable: true, stage: 'take' });
            await state?.transition('taken');
            await this.pace?.();
            if (this.afterTake) {
                const refreshed = await this.afterTake(current);
                if (refreshed.ok && refreshed.value.status === 'fresh') current = refreshed.value.job;
            }
            if (current.alreadyTaken && current.canComplete) {
                return this.complete(current, state, executionResetAt);
            }
        }

        if (this.beforeTarget && current.serverId) {
            await this.pace?.();
            const target = await this.beforeTarget(current);
            if (!target.ok) return err({ code: 'ACTION_FAILED', message: target.error.message, retryable: true, stage: 'route' });
        }

        await state?.transition('executing');
        switch (current.type) {
            case 'IP Injection':
                return this.injectIps(current, state, executionResetAt);
            case 'IP Cleanup':
                return this.cleanupIps(current, state, executionResetAt);
            case 'File Elimination':
                return this.eliminateFile(current, state, executionResetAt);
            case 'Log Deletion':
                return this.deleteLog(current, state, executionResetAt);
            case 'Log Download':
                return this.downloadLog(current, state, executionResetAt);
            case 'Data Upload':
                return this.uploadFile(current, state, executionResetAt);
            case 'Data Download':
                return this.downloadFile(current, state, executionResetAt);
            case 'File Decryption':
                return this.fileDecryption(current, state, executionResetAt);
            case 'Decrypt & Extract':
                return this.decryptAndExtract(current, state, executionResetAt);
            default:
                return err({ code: 'UNSUPPORTED_JOB_TYPE', message: `Unsupported job type: ${current.type}` });
        }
    }

    private async injectIps(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const ips = ipsFromConditions(job);
        if (ips.length === 0) return err({ code: 'ACTION_FAILED', message: 'No IPs found in job conditions' });
        for (const ip of ips) {
            const result = await this.actions.addTransit(job.serverId!, ip);
            if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
            await this.pace?.();
        }
        return this.complete(job, state, executionResetAt);
    }

    private async cleanupIps(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
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
        return this.complete(job, state, executionResetAt);
    }

    private async eliminateFile(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const refs = fileReferencesFromConditions(job);
        const target = files.value.find((file) =>
            file.jobId === job.id
            || refs.some((ref) => ref.fileId === file.fileId || (ref.name !== undefined && ref.name === file.name)),
        ) ?? files.value.find((file) => file.source === 'job');
        if (!target) return this.complete(job, state, executionResetAt);
        const result = await this.actions.deleteFile(job.serverId!, target.fileId);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job, state, executionResetAt);
    }

    private async deleteLog(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const logs = await this.actions.getServerLogs(job.serverId!);
        if (!logs.ok) return err({ code: 'ACTION_FAILED', message: logs.error.message });
        const target = logs.value.find((log) => log.jobId === job.id);
        if (!target) return this.complete(job, state, executionResetAt);
        const result = await this.actions.deleteLog(job.serverId!, target.seq);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job, state, executionResetAt);
    }

    private async downloadLog(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const logs = await this.actions.getServerLogs(job.serverId!);
        if (!logs.ok) return err({ code: 'ACTION_FAILED', message: logs.error.message });
        const target = logs.value.find((log) => log.jobId === job.id);
        if (!target) return this.complete(job, state, executionResetAt);
        const result = await this.actions.downloadLog(job.serverId!, target.seq);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        return this.complete(job, state, executionResetAt);
    }

    private async downloadFile(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const target = files.value.find((file) => file.jobId === job.id);
        if (!target) return this.complete(job, state, executionResetAt);
        const result = await this.actions.downloadFile(job.serverId!, target.fileId);
        if (!result.ok) return err({ code: 'ACTION_FAILED', message: result.error.message });
        if (requiresDecrypt(job)) {
            const download = await this.findDownloadedFile(job, target.name);
            if (!download.ok) return download;
            return this.decryptAndComplete(job, download.value, state, executionResetAt);
        }
        return this.complete(job, state, executionResetAt);
    }

    private async fileDecryption(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const download = await this.findDownloadedFile(job);
        if (!download.ok) return download;
        return this.decryptAndComplete(job, download.value, state, executionResetAt);
    }

    private async decryptAndExtract(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        const files = await this.actions.getServerFiles(job.serverId!);
        if (!files.ok) return err({ code: 'ACTION_FAILED', message: files.error.message });
        const target = files.value.find((file) => file.jobId === job.id);
        if (target) {
            const downloaded = await this.actions.downloadFile(job.serverId!, target.fileId);
            if (!downloaded.ok) return err({ code: 'ACTION_FAILED', message: downloaded.error.message });
        }
        const download = await this.findDownloadedFile(job, target?.name);
        if (!download.ok) return download;
        return this.decryptAndComplete(job, download.value, state, executionResetAt);
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
        // The job condition names the *decrypted* file (for example
        // `export_9724.txt`) while the downloaded file is still encrypted and
        // has a different suffix (`export_9724.ab52p`). Match on the base name
        // from every available reference and prefer the encrypted file.
        const baseCandidates = new Set<string>();
        for (const name of [job.fileInfo?.name, preferredName, ...refs.map((ref) => ref.name)]) {
            if (typeof name === 'string' && name.length > 0) baseCandidates.add(baseName(name));
        }
        const matchesBaseName = (file: DownloadFile): boolean => baseCandidates.has(baseName(file.name));
        const target =
            files.find((file) => job.fileInfo?.id === file.id && matchesExpectedType(file))
            ?? files.find((file) => refs.some((ref) => ref.fileId === file.id) && matchesExpectedType(file))
            ?? files.find((file) => job.fileInfo?.name !== undefined && job.fileInfo.name === file.name && matchesExpectedType(file))
            ?? files.find((file) => refs.some((ref) => ref.name !== undefined && ref.name === file.name) && matchesExpectedType(file))
            ?? files.find((file) => matchesBaseName(file) && file.isEncrypted === true)
            ?? files.find((file) => matchesBaseName(file) && matchesExpectedType(file))
            ?? files.find((file) => matchesBaseName(file))
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
                baseCandidates: [...baseCandidates],
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

    private async decryptAndComplete(job: JobOffer, file: DownloadFile, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        // A decoded file can be picked up again when the user solved it manually
        // or when a previous run already decrypted it. Completing directly avoids
        // re-opening the minigame and avoids reporting "insufficient power (0)".
        this.trace?.(`Decrypt target file selected: ${file.name} (${file.id})`, { jobId: job.id, fileId: file.id, fileName: file.name, expectedType: decryptFileType(job, file.name), encrypted: file.isEncrypted });
        if (file.isEncrypted === false) return this.completeAfterDecrypt(job, file.id, state, executionResetAt);
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
                    return this.completeAfterDecrypt(job, file.id, state, executionResetAt);
                }
                return err({ code: 'ACTION_FAILED', message, ...retryMetadata(opened.error) });
            }
        }
        const result = await solving;
        this.trace?.(
            `Minigame result: ${result.ok ? `${result.value.kind} solved=${result.value.solved}${result.value.message ? ` (${result.value.message})` : ''}` : `error ${result.error.message}`}`,
            {
                jobId: job.id,
                kind: result.ok ? result.value.kind : null,
                solved: result.ok ? result.value.solved : null,
                message: result.ok ? result.value.message ?? null : result.error.message,
            },
        );
        if (openTimedOut) {
            // The decrypt.file reply can time out before a slow minigame room
            // loads. The in-flight solver (or the background solver tick after
            // this promise ends) may still solve it. Never treat that as a
            // successful completion by itself: wait for the market row to
            // become claimable, then use the existing complete path.
            this.trace?.('decrypt.file timed out; waiting for a claimable job row', { jobId: job.id, fileId: file.id });
            const claimable = await this.waitForClaimableJob(job, state?.key.resetAt ?? executionResetAt);
            if (claimable) {
                this.trace?.('Minigame completed after decrypt.file timeout; attempting completion', { jobId: job.id, fileId: file.id });
                return this.completeAfterDecrypt(claimable, file.id, state, executionResetAt, { reopenOnConditions: false });
            }
            const solverMessage = result.ok
                ? result.value.solved
                    ? 'Minigame solved but completion was not confirmed'
                    : result.value.message ?? 'Minigame did not complete'
                : result.error.message;
            return err({
                code: 'ACTION_FAILED',
                message: `Timed out waiting for desktop:decrypt.file; ${solverMessage}`,
                retryable: true,
                stage: 'minigame',
            });
        }
        if (!result.ok) {
            return err({ code: 'MINIGAME_FAILED', message: result.error.message, ...retryMetadata(result.error) });
        }
        if (!result.value.solved) {
            if (/solver disabled/i.test(result.value.message ?? '')) {
                // Market tasks always call the solver; this is a safety net for
                // a disabled runtime, not a user solver-switch gate.
                const until = Date.now() + 10 * 60_000;
                return err({
                    code: 'MINIGAME_DISABLED',
                    message: result.value.message ?? 'Minigame solver is disabled',
                    retryable: false,
                    retryAt: until,
                    lockExpiresAt: until,
                    stage: 'minigame',
                });
            }
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
        // The game updates job conditions slightly after the minigame closes.
        // v1 waited here and retried completion; doing the same avoids marking the
        // first successful decryption as failed while it is still "ready to claim".
        await this.sleep(1500);
        return this.completeAfterDecrypt(job, file.id, state, executionResetAt);
    }

    /**
     * Polls the existing after-take refresh for a remotely claimable row. This
     * is deliberately not a solver event: only the game row can prove that the
     * reward is ready, and no second Take is issued.
     */
    private async waitForClaimableJob(job: JobOffer, expectedResetAt: string | null): Promise<JobOffer | null> {
        if (!this.afterTake) return null;
        const expectedReset = comparableReset(expectedResetAt);
        // Without a trusted original reset, fail closed rather than using the
        // current refresh row to invent a new execution identity.
        if (expectedReset === null) return null;
        const deadline = Date.now() + this.solverHandoffDeadlineMs;
        let current = job;
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            const refreshed = await this.refreshWithDeadline(current, remaining);
            if (refreshed === null) break;
            if (!refreshed.ok) break;
            if (refreshed.value.status !== 'fresh') break;
            const next = refreshed.value.job;
            const refreshedReset = comparableReset(refreshed.value.resetAt);
            // Both identities must be known and identical. Do not adopt the
            // refreshed reset when it differs from the execution identity.
            if (refreshedReset === null || refreshedReset !== expectedReset) break;
            if (next.id !== job.id || next.marketId !== job.marketId || next.marketKey !== job.marketKey) break;
            current = next;
            if (current.alreadyTaken && current.canComplete) return current;
            const wait = Math.min(SOLVER_HANDOFF_INTERVAL_MS, deadline - Date.now());
            if (wait > 0) await this.sleep(wait);
        }
        return null;
    }

    private async refreshWithDeadline(job: JobOffer, remainingMs: number): Promise<JobRefreshResult | null> {
        if (!this.afterTake) return null;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), remainingMs);
        });
        try {
            return await Promise.race([this.afterTake(job, remainingMs), timeout]);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }

    private async completeAfterDecrypt(
        job: JobOffer,
        fileId: string,
        state: JobStateSession | null,
        executionResetAt: string | null,
        options: { readonly reopenOnConditions?: boolean } = {},
    ): Promise<Result<JobReward, JobExecutionError>> {
        let current = job;
        let last = await this.complete(current, state, executionResetAt);
        // Completion can fail because the game has not refreshed conditions yet,
        // the market endpoint was briefly unreachable, or the WS was reconnecting.
        // Refresh the job row before each retry: the deferred run-level pass proved
        // that a fresh market snapshot often sees the job as claimable while the
        // stale row still says "conditions not met".
        for (let attempt = 0; attempt < 3 && !last.ok; attempt++) {
            this.trace?.(`Completion attempt failed (${attempt + 1}): ${last.error.code} — ${last.error.message}`, { jobId: current.id, attempt: attempt + 1, code: last.error.code, message: last.error.message });
            // A lost response does not prove failure; do not send Complete again
            // until the next market/reconciliation pass confirms the state.
            if (last.error.unconfirmed === true) return last;
            if (last.error.code !== 'COMPLETE_FAILED' || /token|not found|stale/i.test(last.error.message)) return last;
            if (options.reopenOnConditions !== false
                && /conditions.*not.*met|not met/i.test(last.error.message)
                && attempt < 2) {
                await this.pace?.();
                await this.reopenFileForCompletion(fileId);
            }
            current = await this.refreshForCompletion(current);
            await this.sleep(3000);
            last = await this.complete(current, state, executionResetAt);
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
        return refreshed.ok && refreshed.value.status === 'fresh' ? refreshed.value.job : job;
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

    private async uploadFile(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
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
        return this.complete(job, state, executionResetAt);
    }

    private async complete(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<Result<JobReward, JobExecutionError>> {
        await this.pace?.();
        await state?.transition('ready-to-claim');
        // The complete request may mutate remote state; record the intent first.
        await state?.transition('claiming');
        if (this.beforeComplete) {
            const hook = await this.beforeComplete(job);
            if (!hook.ok) return err({ code: 'COMPLETE_FAILED', message: hook.error.message, ...retryMetadata(hook.error) });
        }
        const result = await this.actions.complete(job);
        if (!result.ok) {
            return err({
                code: 'COMPLETE_FAILED',
                message: result.error.message,
                ...retryMetadata(result.error),
                ...(unconfirmedCompleteError(result.error) ? { unconfirmed: true } : {}),
            });
        }
        const persisted = await this.persistCompletion(job, state, executionResetAt);
        if (!persisted.ok) return persisted;
        await state?.transition('completed');
        return ok(result.value);
    }

    private readonly runtimeBarrierFailures = new Set<string>();

    /** Refuse to execute a job whose earlier Complete result is still unknown. */
    private async completionBarrier(job: JobOffer, state: JobStateSession | null): Promise<JobExecutionError | null> {
        if (this.runtimeBarrierFailures.has(jobActiveKey(job.marketKey, job.id))) {
            return this.blockedError();
        }

        const key = state?.key;
        if (state && this.jobStates) {
            let record;
            try {
                record = await this.jobStates.get(state.key);
            } catch (error) {
                return this.blockedError(`Completion state unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (record && isCompletionUncertainRecord(record)) return this.blockedError();
        }

        if (this.jobStates?.list) {
            let records;
            try {
                records = await this.jobStates.list();
            } catch (error) {
                return this.blockedError(`Job state barrier unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
            const nullResetBlocked = records.some((record) =>
                record.marketKey === job.marketKey
                && record.jobId === job.id
                && record.resetAt === null
                && isCompletionUncertainRecord(record));
            if (nullResetBlocked) return this.blockedError();
            if (!state) {
                const anyBlocked = records.some((record) =>
                    record.marketKey === job.marketKey
                    && record.jobId === job.id
                    && isCompletionUncertainRecord(record));
                if (anyBlocked) return this.blockedError();
            }
        }

        const readUnconfirmed = this.completions?.getUnconfirmedState;
        if (readUnconfirmed) {
            let barriers;
            try {
                barriers = await readUnconfirmed.call(this.completions);
            } catch (error) {
                return this.blockedError(`Completion barrier unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
            const value = barriers?.[job.marketKey]?.[job.id];
            if (value !== undefined) {
                const resetAt = key ? comparableReset(key.resetAt) : null;
                if (value === JOB_STATE_UNKNOWN_RESET || resetAt === null || value === resetAt) {
                    return this.blockedError();
                }
            }
        }
        return null;
    }

    private blockedError(message = 'Completion is blocked by an earlier unconfirmed Complete result'): JobExecutionError {
        return {
            code: 'COMPLETE_FAILED',
            message,
            retryable: false,
            stage: 'complete',
            unconfirmed: true,
        };
    }

    private async rememberUnconfirmedCompletion(job: JobOffer, state: JobStateSession | null, executionResetAt: string | null): Promise<void> {
        const mark = this.completions?.markUnconfirmed;
        if (!mark) return;
        const key = state?.key ?? {
            marketKey: job.marketKey,
            jobId: job.id,
            resetAt: comparableReset(executionResetAt),
        };
        try {
            await mark.call(this.completions, { marketKey: key.marketKey, jobId: key.jobId, resetAt: key.resetAt });
        } catch (error) {
            this.runtimeBarrierFailures.add(jobActiveKey(job.marketKey, job.id));
            this.trace?.('Failed to persist unconfirmed completion barrier', {
                jobId: job.id,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * The authoritative completion sidecar must be written before Job State can
     * become completed. A failed write leaves the lifecycle in claiming; the
     * caller records unknown/unconfirmed and a later market sync can reconcile.
     */
    private async persistCompletion(
        job: JobOffer,
        state: JobStateSession | null,
        executionResetAt: string | null,
    ): Promise<Result<void, JobExecutionError>> {
        // Test/embedding compositions may run without a sidecar. Production
        // always wires the shared market completion store.
        if (!this.completions) return ok(undefined);

        const resetAt = state
            ? comparableReset(state.key.resetAt)
            : comparableReset(executionResetAt);
        if (resetAt === null) {
            return err({
                code: 'COMPLETE_FAILED',
                message: 'Cannot persist completion without a known reset',
                retryable: false,
                stage: 'complete',
                unconfirmed: true,
            });
        }

        let current: string | null;
        try {
            current = await this.completions.getCompletion(job.marketKey, job.id);
        } catch (error) {
            return err({
                code: 'COMPLETE_FAILED',
                message: `Completion sidecar read failed: ${error instanceof Error ? error.message : String(error)}`,
                retryable: false,
                stage: 'complete',
                unconfirmed: true,
            });
        }

        let expected: string | null | undefined;
        if (current === null) {
            expected = undefined;
        } else if (current === resetAt) {
            expected = current;
        } else {
            const currentTime = Date.parse(current);
            if (!Number.isFinite(currentTime) || Date.parse(resetAt) < currentTime) {
                return err({
                    code: 'COMPLETE_FAILED',
                    message: `Completion sidecar has a newer or invalid reset for ${job.marketKey}/${job.id}`,
                    retryable: false,
                    stage: 'complete',
                    unconfirmed: true,
                });
            }
            expected = current;
        }

        const writer = new CompletionRecordWriter(this.completions);
        const written = await writer.record({
            marketKey: job.marketKey,
            jobId: job.id,
            resetAt,
            ...(expected !== undefined ? { expectedExistingResetAt: expected } : {}),
        });
        if (written.ok) return ok(undefined);

        return err({
            code: 'COMPLETE_FAILED',
            message: `Completion sidecar write failed: ${written.error.code} ${written.error.message}`,
            retryable: false,
            stage: 'complete',
            unconfirmed: true,
        });
    }
}

function requiresDecrypt(job: JobOffer): boolean {
    return conditionsOf(job).some((condition) => condition.type === 'DecryptFile' || condition.type === 'DecryptDownloadedFile');
}

function baseName(name: string): string {
    return name.replace(/\.[^.]+$/, '');
}
