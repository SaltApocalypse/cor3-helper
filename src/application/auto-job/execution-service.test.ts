import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import { JobExecutionService } from './execution-service.js';
import type { JobActionPort } from './job-actions.js';

function job(type: JobOffer['type'], extra: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job1', name: type, type, marketId: 'm', marketKey: 'home', serverId: 'server1',
        serverName: 'server', rewardCredits: 100, rewardReputation: 10, deposit: 0,
        alreadyTaken: false, canComplete: false, ...extra,
    };
}

function actions() {
    const calls: string[] = [];
    const reward = { credits: 100, reputation: 10, renown: 1 };
    const port: JobActionPort = {
            take: async () => { calls.push('take'); return { ok: true as const, value: undefined }; },
            complete: async () => { calls.push('complete'); return { ok: true as const, value: reward }; },
            getServerFiles: async () => ({ ok: true as const, value: [{ fileId: 'f1', name: 'f', jobId: 'job1' }] }),
            deleteFile: async () => { calls.push('delete-file'); return { ok: true as const, value: undefined }; },
            getServerLogs: async () => ({ ok: true as const, value: [{ seq: 1, message: 'm', jobId: 'job1' }] }),
            deleteLog: async () => { calls.push('delete-log'); return { ok: true as const, value: undefined }; },
            downloadLog: async () => { calls.push('download-log'); return { ok: true as const, value: undefined }; },
            downloadFile: async () => { calls.push('download-file'); return { ok: true as const, value: undefined }; },
            getTransit: async () => ({ ok: true as const, value: [] }),
            addTransit: async (_server: string, ip: string) => { calls.push('add:' + ip); return { ok: true as const, value: undefined }; },
            removeTransit: async (_server: string, ip: string) => { calls.push('remove:' + ip); return { ok: true as const, value: undefined }; },
            uploadFile: async (_server: string, name: string) => { calls.push('upload:' + name); return { ok: true as const, value: undefined }; },
            getDownloadsFolder: async () => ({ ok: true as const, value: { id: 'downloads' } }),
            openFolder: async () => ({ ok: true as const, value: [{ id: 'desktop-file', name: 'job-file.dat' }] }),
            getFileAnalysis: async () => ({ ok: true as const, value: { canDecrypt: true, decryptPower: 100, tags: [], source: null } }),
            decryptFile: async () => { calls.push('decrypt-file'); return { ok: true as const, value: undefined }; },
    };
    return { calls, port };
}

describe('JobExecutionService', () => {
    it('completes a claimable taken job without taking it again', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('File Decryption', {
            alreadyTaken: true,
            canComplete: true,
        }));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['complete']);
    });

    it('injects IPs and completes', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('IP Injection', { conditions: [{ details: { ips: ['1.1.1.1', '2.2.2.2'] } }] }));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'add:1.1.1.1', 'add:2.2.2.2', 'complete']);
    });

    it('deletes the matching log and completes', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('Log Deletion'));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'delete-log', 'complete']);
    });

    it('deletes the file targeted by DeleteFile conditions', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('File Elimination', {
            id: 'job2',
            conditions: [{ type: 'DeleteFile', details: { fileIds: ['f1'] } }],
        }));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'delete-file', 'complete']);
    });

    it('downloads a non-encrypted Data Download file', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('Data Download'));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'download-file', 'complete']);
    });

    it('requires the minigame adapter for encrypted Data Download jobs', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('Data Download', {
            conditions: [{ type: 'DecryptFile' }],
        }));
        expect(result).toEqual({ ok: false, error: { code: 'MINIGAME_REQUIRED', message: 'No minigame adapter is configured' } });
    });

    it('finds the encrypted download when the server file suffix changed', async () => {
        const fake = actions();
        fake.port.getServerFiles = async () => ({
            ok: true,
            value: [{ fileId: 'f1', name: 'report_8918.dat', jobId: 'job1' }],
        });
        fake.port.openFolder = async () => ({
            ok: true,
            value: [{ id: 'encrypted', name: 'report_8918.eb54x', isEncrypted: true }],
        });
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );
        const result = await service.executeDetailed(job('Data Download', {
            conditions: [{ type: 'DecryptFile', details: { files: [{ name: 'report_8918.dat' }] } }],
        }));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'download-file', 'decrypt-file', 'complete']);
    });

    it('decrypts a downloaded file and completes', async () => {
        const fake = actions();
        const minigameCalls: string[] = [];
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => { minigameCalls.push('solve'); return { ok: true as const, value: { kind: 'config-hack' as const, solved: true } }; },
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'decrypt-file', 'complete']);
        expect(minigameCalls).toEqual(['solve']);
    });

    it('selects the downloaded file referenced by DecryptDownloadedFile conditions', async () => {
        const fake = actions();
        const picked: string[] = [];
        fake.port.openFolder = async () => ({
            ok: true,
            value: [
                { id: 'upload-enc', name: 'payload.enc', isEncrypted: true },
                { id: 'target-file', name: 'report.eb52x', isEncrypted: true },
            ],
        });
        fake.port.getFileAnalysis = async (fileId) => {
            picked.push('analysis:' + fileId);
            return { ok: true, value: { canDecrypt: true, decryptPower: 20, tags: [], source: null } };
        };
        fake.port.decryptFile = async (fileId) => {
            picked.push('decrypt:' + fileId);
            return { ok: true, value: undefined };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            { solve: async () => ({ ok: true, value: { kind: 'config-hack' as const, solved: true } }), cancel: async () => ({ ok: true, value: undefined }) },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
        );
        const result = await service.executeDetailed(job('File Decryption', {
            fileInfo: { id: 'upload-enc', name: 'payload.enc' },
            conditions: [
                { type: 'DownloadFile', details: { files: [{ id: 'upload-enc', name: 'payload.enc' }] } },
                { type: 'DecryptDownloadedFile', details: { files: [{ id: 'target-file', name: 'report.eb52x' }] } },
            ],
        }));
        expect(result.ok).toBe(true);
        expect(picked).toEqual(['analysis:target-file', 'decrypt:target-file']);
    });

    it('waits for the loadout analysis to settle after equipping decrypt software', async () => {
        const fake = actions();
        let analysisCalls = 0;
        fake.port.getFileAnalysis = async () => {
            analysisCalls += 1;
            return { ok: true, value: { canDecrypt: analysisCalls >= 3, decryptPower: 20, tags: [], source: null } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            async () => ({ ok: true as const, value: undefined }),
            { solve: async () => ({ ok: true, value: { kind: 'config-hack' as const, solved: true } }), cancel: async () => ({ ok: true, value: undefined }) },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(analysisCalls).toBe(3);
        expect(fake.calls).toContain('decrypt-file');
    });

    it('takes the File Decryption job before applying the decrypt loadout', async () => {
        const fake = actions();
        const order: string[] = [];
        let analysisCalls = 0;
        fake.port.take = async () => { order.push('take'); return { ok: true as const, value: undefined }; };
        fake.port.getFileAnalysis = async () => {
            analysisCalls += 1;
            return { ok: true as const, value: { canDecrypt: analysisCalls > 1, decryptPower: 12, tags: [], source: null } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            async () => { order.push('loadout'); return { ok: true as const, value: undefined }; },
            {
                solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(order).toEqual(['take', 'loadout']);
    });

    it('does not swap the loadout when the current setup can already decrypt', async () => {
        const fake = actions();
        const order: string[] = [];
        fake.port.take = async () => { order.push('take'); return { ok: true as const, value: undefined }; };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            async () => { order.push('loadout'); return { ok: true as const, value: undefined }; },
            {
                solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(order).toEqual(['take']);
        expect(fake.calls).toEqual(['decrypt-file', 'complete']);
    });

    it('keeps the taken File Decryption job when the targeted loadout is infeasible', async () => {
        const fake = actions();
        fake.port.getFileAnalysis = async () => ({ ok: true as const, value: { canDecrypt: false, decryptPower: 12, tags: [], source: null } });
        const service = new JobExecutionService(
            fake.port,
            undefined,
            async () => ({ ok: false as const, error: { code: 'DECRYPT_POWER_INSUFFICIENT', message: 'No owned .xvct decrypt module' } }),
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('DECRYPT_POWER_INSUFFICIENT');
        expect(fake.calls).toEqual(['take']);
    });

    it('runs the completion hook before claiming the reward', async () => {
        const fake = actions();
        let hooked = false;
        const service = new JobExecutionService(fake.port, async () => {
            hooked = true;
            return { ok: true as const, value: undefined };
        });
        const result = await service.executeDetailed(job('Log Deletion'));
        expect(result.ok).toBe(true);
        expect(hooked).toBe(true);
    });

    it('does not complete when the completion hook fails', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port, async () => ({
            ok: false as const,
            error: { code: 'ROUTE_FAILED', message: 'market unreachable' },
        }));
        const result = await service.executeDetailed(job('Log Deletion'));
        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['take', 'delete-log']);
    });

    it('stops when file analysis reports insufficient decrypt power', async () => {
        const fake = actions();
        fake.port.getFileAnalysis = async () => ({ ok: true as const, value: { canDecrypt: false, decryptPower: 12, tags: [], source: null } });
        const minigameCalls: string[] = [];
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => { minigameCalls.push('solve'); return { ok: true as const, value: { kind: 'config-hack' as const, solved: true } }; },
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result).toEqual({ ok: false, error: { code: 'DECRYPT_POWER_INSUFFICIENT', message: 'Insufficient decrypt power (12)' } });
        expect(minigameCalls).toEqual([]);
        expect(fake.calls).toEqual(['take']);
    });

    it('reports an unsolved minigame without completing the job', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: false, message: 'timed out' } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result).toEqual({ ok: false, error: { code: 'MINIGAME_FAILED', message: 'timed out', retryable: true, stage: 'minigame' } });
        expect(fake.calls).toEqual(['take', 'decrypt-file']);
    });

    it('treats an undetected minigame as retryable, not success', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'none' as const, solved: false, message: 'no minigame detected' } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result).toEqual({ ok: false, error: { code: 'MINIGAME_FAILED', message: 'no minigame detected', retryable: true, stage: 'minigame' } });
        expect(fake.calls).toEqual(['take', 'decrypt-file']);
    });

    it('cancels the solver when decrypt.file fails', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => ({ ok: false as const, error: { code: 'DECRYPT_FAILED', message: 'cannot open file' } });
        const minigameCalls: string[] = [];
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => { minigameCalls.push('solve'); return { ok: true as const, value: { kind: 'none' as const, solved: false } }; },
            cancel: async () => { minigameCalls.push('cancel'); return { ok: true as const, value: undefined }; },
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result).toEqual({ ok: false, error: { code: 'ACTION_FAILED', message: 'cannot open file' } });
        expect(minigameCalls).toEqual(['solve', 'cancel']);
    });

    it('retries instead of completing when the decrypt.file response times out', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return {
                ok: false as const,
                error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' },
            };
        };
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: true } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('ACTION_FAILED');
            expect(result.error.retryable).toBe(true);
        }
        expect(fake.calls).toEqual(['take', 'decrypt-file']);
    });

    it('extracts a minigame lock retry time from the game error', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => ({
            ok: false as const,
            error: { code: 'MINIGAME_LOCKED', message: 'minigame-locked: Minigame locked (~4m remaining)' },
        });
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'none' as const, solved: false } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.lockExpiresAt).toBeTypeOf('number');
            expect(result.error.retryAt).toBeTypeOf('number');
        }
    });

    it('skips decryption while the game reports an active minigame lock', async () => {
        const fake = actions();
        const lockExpiresAt = Date.now() + 60_000;
        fake.port.getMinigameLock = async () => lockExpiresAt;
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'none' as const, solved: false } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('MINIGAME_FAILED');
            expect(result.error.lockExpiresAt).toBe(lockExpiresAt);
            expect(result.error.retryAt).toBe(lockExpiresAt);
        }
    });

    it('submits an already-decrypted file when analysis reports zero decrypt power', async () => {
        const fake = actions();
        fake.port.openFolder = async () => ({ ok: true as const, value: [{ id: 'desktop-file', name: 'job-file.dat', isEncrypted: false }] });
        fake.port.getFileAnalysis = async () => ({ ok: true as const, value: { canDecrypt: false, decryptPower: 0, tags: [], source: null } });
        const minigameCalls: string[] = [];
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => { minigameCalls.push('solve'); return { ok: true as const, value: { kind: 'none' as const, solved: false } }; },
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'complete']);
        expect(minigameCalls).toEqual([]);
    });

    it('attempts decryption when zero decrypt power may be stale', async () => {
        const fake = actions();
        fake.port.openFolder = async () => ({ ok: true as const, value: [{ id: 'desktop-file', name: 'report.xvct', isEncrypted: true }] });
        fake.port.getFileAnalysis = async () => ({ ok: true as const, value: { canDecrypt: false, decryptPower: 0, tags: [], source: null } });
        const service = new JobExecutionService(fake.port, undefined, undefined, {
            solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: true } }),
            cancel: async () => ({ ok: true as const, value: undefined }),
        });
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'decrypt-file', 'complete']);
    });

    it('requires a minigame adapter for decrypt jobs', async () => {
        const fake = actions();
        const service = new JobExecutionService(fake.port);
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result).toEqual({ ok: false, error: { code: 'MINIGAME_REQUIRED', message: 'No minigame adapter is configured' } });
    });

    it('routes to the market before take, then to the target before job actions', async () => {
        const fake = actions();
        const routeCalls: string[] = [];
        const service = new JobExecutionService(
            fake.port,
            (job) => { routeCalls.push('complete:' + job.marketKey); return Promise.resolve({ ok: true as const, value: undefined }); },
            undefined,
            undefined,
            (job) => { routeCalls.push('take:' + job.marketKey); return Promise.resolve({ ok: true as const, value: undefined }); },
            () => { routeCalls.push('target'); return Promise.resolve({ ok: true as const, value: undefined }); },
            (refreshJob) => { routeCalls.push('refresh:' + refreshJob.id); return Promise.resolve({ ok: true as const, value: refreshJob }); },
        );
        const result = await service.executeDetailed(job('Log Deletion'));
        expect(result.ok).toBe(true);
        expect(routeCalls).toEqual(['take:home', 'refresh:job1', 'target', 'complete:home']);
        expect(fake.calls).toEqual(['take', 'delete-log', 'complete']);
    });

    it('does not take a job when the target server is not unlocked', async () => {
        const fake = actions();
        let preflightCalls = 0;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => {
                preflightCalls += 1;
                return { ok: false as const, error: { code: 'SERVER_LOCKED', message: 'Target server is not on the network map' } };
            },
        );
        const result = await service.executeDetailed(job('IP Injection'));
        expect(result).toEqual({
            ok: false,
            error: { code: 'PREFLIGHT_FAILED', message: 'Target server is not on the network map', retryable: false, stage: 'preflight' },
        });
        expect(preflightCalls).toBe(1);
        expect(fake.calls).toEqual([]);
    });

    it('runs serverless File Decryption without a target route', async () => {
        const fake = actions();
        let targetCalls = 0;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'config-hack' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            () => {
                targetCalls += 1;
                return Promise.resolve({ ok: true as const, value: undefined });
            },
        );
        const result = await service.executeDetailed(job('File Decryption', { serverId: null }));
        expect(result.ok).toBe(true);
        expect(targetCalls).toBe(0);
        expect(fake.calls).toEqual(['take', 'decrypt-file', 'complete']);
    });
});
