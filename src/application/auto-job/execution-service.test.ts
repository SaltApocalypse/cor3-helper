import { describe, expect, it } from 'vitest';
import type { JobOffer } from '../../domains/jobs/model.js';
import { JobExecutionService } from './execution-service.js';
import type { JobActionPort } from './job-actions.js';
import type { JobStateRecorderPort } from './job-state-recorder.js';
import type { MarketCompletionStorePort } from './market-completion.js';

function job(type: JobOffer['type'], extra: Partial<JobOffer> = {}): JobOffer {
    return {
        id: 'job1', name: type, type, marketId: 'm', marketKey: 'home', serverId: 'server1',
        serverName: 'server', rewardCredits: 100, rewardReputation: 10, deposit: 0,
        alreadyTaken: false, canComplete: false, ...extra,
    };
}

function handoffRecorder(resetAt: string | null = '2026-11-20T11:00:00.000Z'): JobStateRecorderPort {
    return {
        start: async (offer) => ({
            key: { marketKey: offer.marketKey, jobId: offer.id, resetAt },
            transition: async () => undefined,
        }),
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

    it('matches an encrypted download when only the decrypted condition name is known', async () => {
        const fake = actions();
        fake.port.getServerFiles = async () => ({ ok: true, value: [] });
        fake.port.openFolder = async () => ({
            ok: true,
            value: [{ id: 'encrypted', name: 'export_9724.ab52p', isEncrypted: true }],
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
        const result = await service.executeDetailed(job('Decrypt & Extract', {
            alreadyTaken: true,
            conditions: [{ type: 'DecryptDownloadedFile', details: { files: [{ name: 'export_9724.txt' }] } }],
        }));
        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['decrypt-file', 'complete']);
    });

    it('does not complete or retry when the minigame solver is disabled', async () => {
        const fake = actions();
        fake.port.openFolder = async () => ({
            ok: true,
            value: [{ id: 'encrypted', name: 'job-file.dat', isEncrypted: true }],
        });
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: false, message: 'solver disabled for ice-wall' } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('MINIGAME_DISABLED');
            expect(result.error.retryable).toBe(false);
            expect(result.error.lockExpiresAt).toBeTypeOf('number');
        }
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
            handoffRecorder(),
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
            handoffRecorder(),
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

    it('passes the observed decrypt power to the hook for unknown-requirement planning', async () => {
        const fake = actions();
        // `decryptPower` is the current power, not the requirement. The hook
        // receives it as an observation and plans with requirement 'unknown',
        // so the loadout selects the strongest plan.
        fake.port.getFileAnalysis = async () => ({ ok: true as const, value: { canDecrypt: false, decryptPower: 20, tags: [], source: null } });
        let seen: number | undefined;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            async (_job, _file, requiredPower) => {
                seen = requiredPower;
                return { ok: false as const, error: { code: 'DECRYPT_POWER_INSUFFICIENT', message: 'stop after hook' } };
            },
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(seen).toBe(20);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('DECRYPT_POWER_INSUFFICIENT');
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

    it('completes after a decrypt.file timeout when the solver made the job claimable', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' } };
        };
        let afterTakeCalls = 0;
        let solverCalls = 0;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => {
                    solverCalls += 1;
                    return { ok: true as const, value: { kind: 'ice-wall' as const, solved: true } };
                },
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            async (current) => {
                afterTakeCalls += 1;
                return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: afterTakeCalls > 1 } } };
            },
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            handoffRecorder(),
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['take', 'decrypt-file', 'complete']);
        expect(solverCalls).toBe(1);
    });

    it('waits for the background solver result through a claimable job row', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' } };
        };
        let refreshes = 0;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'none' as const, solved: false, message: 'no minigame detected' } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            async (current) => {
                refreshes += 1;
                return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: refreshes >= 2 } } };
            },
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            handoffRecorder(),
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(true);
        expect(refreshes).toBeGreaterThanOrEqual(2);
        expect(fake.calls).toEqual(['take', 'decrypt-file', 'complete']);
    });

    it('does not complete while the solver result is still unconfirmed', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'none' as const, solved: false, message: 'no minigame detected' } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            async (current) => ({ ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: false } } }),
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            handoffRecorder(),
            20,
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('ACTION_FAILED');
            expect(result.error.retryable).toBe(true);
            expect(result.error.stage).toBe('minigame');
        }
        expect(fake.calls).toEqual(['take', 'decrypt-file']);
    });

    it('does not resend Complete when the response is unconfirmed', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'decrypt-file')).toHaveLength(1);
    });

    it('does not resend Complete after a socket/message failure', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'JOB_COMMAND_FAILED', message: 'message channel closed before response' } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
    });

    it('does not reopen the minigame when the completion conditions fallback is unconfirmed', async () => {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' } };
        };
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'job conditions not met' } };
        };
        let afterTakeCalls = 0;
        let solverCalls = 0;
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => {
                    solverCalls += 1;
                    return { ok: true as const, value: { kind: 'ice-wall' as const, solved: true } };
                },
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            async (current) => {
                afterTakeCalls += 1;
                return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: afterTakeCalls > 1 } } };
            },
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            handoffRecorder(),
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'decrypt-file')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(solverCalls).toBe(1);
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

    it('does not take a job when preflight rejects it', async () => {
        const fake = actions();
        let takeCalls = 0;
        fake.port.take = async () => {
            takeCalls += 1;
            return { ok: true as const, value: undefined };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => ({ ok: false as const, error: { code: 'PREFLIGHT_FAILED', message: 'required solver disabled' } }),
        );
        const result = await service.executeDetailed(job('File Decryption'));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('PREFLIGHT_FAILED');
        expect(takeCalls).toBe(0);
    });

    it('completes a claim-only job without running a rejecting preflight', async () => {
        const fake = actions();
        let takeCalls = 0;
        fake.port.take = async () => {
            takeCalls += 1;
            return { ok: true as const, value: undefined };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => ({ ok: false as const, error: { code: 'PREFLIGHT_FAILED', message: 'solver disabled' } }),
        );
        const result = await service.executeDetailed(job('File Decryption', {
            alreadyTaken: true,
            canComplete: true,
        }));
        expect(result.ok).toBe(true);
        expect(takeCalls).toBe(0);
        expect(fake.calls).toEqual(['complete']);
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
            (refreshJob) => { routeCalls.push('refresh:' + refreshJob.id); return Promise.resolve({ ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: refreshJob } }); },
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

function lifecycleRecorder() {
    const transitions: import('../../contracts/job-state.js').JobLifecycleStatus[] = [];
    const recorder: import('./job-state-recorder.js').JobStateRecorderPort = {
        start: async (offer) => ({
            key: { marketKey: offer.marketKey, jobId: offer.id, resetAt: '2026-11-20T11:00:00.000Z' },
            transition: async (status) => { transitions.push(status); },
        }),
    };
    return { transitions, recorder };
}

function serviceWithRecorder(port: JobActionPort, recorder: import('./job-state-recorder.js').JobStateRecorderPort): JobExecutionService {
    return new JobExecutionService(
        port,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        recorder,
    );
}

describe('JobExecutionService lifecycle records', () => {
    it('persists taking before take, and completed only after an explicit complete success', async () => {
        const fake = actions();
        const lifecycle = lifecycleRecorder();
        fake.port.take = async () => {
            expect(lifecycle.transitions.at(-1)).toBe('taking');
            fake.calls.push('take');
            return { ok: true as const, value: undefined };
        };
        fake.port.complete = async () => {
            expect(lifecycle.transitions.at(-1)).toBe('claiming');
            fake.calls.push('complete');
            return { ok: true as const, value: { credits: 100, reputation: 10, renown: 1 } };
        };
        const service = serviceWithRecorder(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('IP Injection', {
            conditions: [{ details: { ips: ['1.1.1.1'] } }],
        }));

        expect(result.ok).toBe(true);
        expect(lifecycle.transitions).toEqual([
            'available', 'taking', 'taken', 'executing', 'ready-to-claim', 'claiming', 'completed',
        ]);
    });

    it('records a claim-only job as ready-to-claim and never sends take', async () => {
        const fake = actions();
        const lifecycle = lifecycleRecorder();
        fake.port.take = async () => {
            throw new Error('take must not be called for a claim-only job');
        };
        const service = serviceWithRecorder(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption', {
            alreadyTaken: true,
            canComplete: true,
        }));

        expect(result.ok).toBe(true);
        expect(lifecycle.transitions).toEqual(['ready-to-claim', 'claiming', 'completed']);
        expect(fake.calls).toEqual(['complete']);
    });

    it('does not record taken when the take request fails', async () => {
        const fake = actions();
        const lifecycle = lifecycleRecorder();
        fake.port.take = async () => ({ ok: false as const, error: { code: 'GAME_ERROR', message: 'take rejected' } });
        const service = serviceWithRecorder(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('IP Injection'));

        expect(result.ok).toBe(false);
        expect(lifecycle.transitions).toContain('taking');
        expect(lifecycle.transitions).not.toContain('taken');
        expect(lifecycle.transitions.at(-1)).toBe('failed');
    });

    it('records an unconfirmed complete as unknown, never completed', async () => {
        const fake = actions();
        const lifecycle = lifecycleRecorder();
        fake.port.complete = async () => ({
            ok: false as const,
            error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:complete' },
        });
        const service = serviceWithRecorder(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('IP Injection', {
            conditions: [{ details: { ips: ['1.1.1.1'] } }],
        }));

        expect(result.ok).toBe(false);
        expect(lifecycle.transitions).toContain('claiming');
        expect(lifecycle.transitions).not.toContain('completed');
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });

    it('records a preflight minigame lock as waiting-minigame without taking', async () => {
        const fake = actions();
        const lifecycle = lifecycleRecorder();
        fake.port.take = async () => {
            throw new Error('take must not be called while the job is locked');
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => ({ ok: false as const, error: { code: 'PREFLIGHT_FAILED', message: 'Minigame locked (~5m remaining)' } }),
            undefined,
            undefined,
            undefined,
            undefined,
            lifecycle.recorder,
        );

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(lifecycle.transitions).toEqual(['available', 'waiting-minigame']);
        expect(fake.calls).toEqual([]);
    });
});

describe('JobExecutionService handoff refresh safety', () => {
    async function runHandoff(
        afterTake: (current: JobOffer, timeoutMs?: number) => Promise<import('./refresh-outcome.js').JobRefreshResult>,
        deadlineMs = 20,
        expectedResetAt: string | null = '2026-11-20T11:00:00.000Z',
    ) {
        const fake = actions();
        fake.port.decryptFile = async () => {
            fake.calls.push('decrypt-file');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for desktop:decrypt.file (action)' } };
        };
        const service = new JobExecutionService(
            fake.port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            afterTake,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            handoffRecorder(expectedResetAt),
            deadlineMs,
        );
        const result = await service.executeDetailed(job('File Decryption', { alreadyTaken: true, canComplete: false }));
        return { fake, result };
    }

    it('does not use a failed refresh result', async () => {
        const { fake, result } = await runHandoff(async () => ({
            ok: false as const,
            error: { code: 'MARKET_COMMAND_FAILED', message: 'refresh failed' },
        }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not use a missing refresh result', async () => {
        const { fake, result } = await runHandoff(async () => ({ ok: true as const, value: { status: 'missing' as const } }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not use an unavailable refresh result', async () => {
        const { fake, result } = await runHandoff(async () => ({ ok: true as const, value: { status: 'unavailable' as const } }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not use a fresh row for another job or market', async () => {
        const { fake, result } = await runHandoff(async (current) => ({
            ok: true as const,
            value: {
                status: 'fresh' as const,
                resetAt: '2026-11-20T11:00:00.000Z',
                job: { ...current, id: 'other-job', alreadyTaken: true, canComplete: true },
            },
        }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not use a fresh row for the same job id in another market', async () => {
        const { fake, result } = await runHandoff(async (current) => ({
            ok: true as const,
            value: {
                status: 'fresh' as const,
                resetAt: '2026-11-20T11:00:00.000Z',
                job: { ...current, marketId: 'dark-market', marketKey: 'dark', alreadyTaken: true, canComplete: true },
            },
        }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('fails closed when the execution reset is missing', async () => {
        let calls = 0;
        const { fake, result } = await runHandoff(async (current) => {
            calls += 1;
            return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: true } } };
        }, 20, null);

        expect(result.ok).toBe(false);
        expect(calls).toBe(0);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('fails closed when the execution reset is not parseable', async () => {
        let calls = 0;
        const { fake, result } = await runHandoff(async (current) => {
            calls += 1;
            return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: true } } };
        }, 20, 'not-a-date');

        expect(result.ok).toBe(false);
        expect(calls).toBe(0);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not complete when the refreshed reset is missing', async () => {
        const { fake, result } = await runHandoff(async (current) => ({
            ok: true as const,
            value: { status: 'fresh' as const, resetAt: null, job: { ...current, alreadyTaken: true, canComplete: true } },
        }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('does not complete when the refreshed reset is not parseable', async () => {
        const { fake, result } = await runHandoff(async (current) => ({
            ok: true as const,
            value: { status: 'fresh' as const, resetAt: 'not-a-date', job: { ...current, alreadyTaken: true, canComplete: true } },
        }));

        expect(result.ok).toBe(false);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('stops on a reset mismatch without adopting the new reset', async () => {
        let calls = 0;
        const { fake, result } = await runHandoff(async (current) => {
            calls += 1;
            return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-21T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: true } } };
        });

        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
        expect(fake.calls).toEqual(['decrypt-file']);
    });

    it('completes with matching identity and claimability', async () => {
        const { fake, result } = await runHandoff(async (current) => ({
            ok: true as const,
            value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: true } },
        }));

        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['decrypt-file', 'complete']);
    });

    it('stops at the handoff deadline without another refresh', async () => {
        let calls = 0;
        const { fake, result } = await runHandoff(async (current) => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { ok: true as const, value: { status: 'fresh' as const, resetAt: '2026-11-20T11:00:00.000Z', job: { ...current, alreadyTaken: true, canComplete: false } } };
        }, 10);

        expect(result.ok).toBe(false);
        expect(calls).toBe(1);
        expect(fake.calls).toEqual(['decrypt-file']);
    });
});

describe('JobExecutionService Complete classification', () => {
    function serviceWithComplete(
        port: JobActionPort,
        recorder: import('./job-state-recorder.js').JobStateRecorderPort,
        completions?: MarketCompletionStorePort,
    ): JobExecutionService {
        return new JobExecutionService(
            port,
            undefined,
            undefined,
            {
                solve: async () => ({ ok: true as const, value: { kind: 'ice-wall' as const, solved: true } }),
                cancel: async () => ({ ok: true as const, value: undefined }),
            },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => undefined,
            recorder,
            undefined,
            completions,
        );
    }

    it('writes the completion sidecar before transitioning completed', async () => {
        const fake = actions();
        let sidecarWritten = false;
        const completions: MarketCompletionStorePort = {
            recordCompletion: async () => {
                sidecarWritten = true;
                return { status: 'written' };
            },
            getState: async () => ({ byMarket: {} }),
            getCompletion: async () => null,
            clear: async () => undefined,
            pruneMarketBeforeReset: async () => ({ status: 'pruned', removed: 0, state: { byMarket: {} } }),
        };
        const transitions: string[] = [];
        const recorder: JobStateRecorderPort = {
            start: async () => ({
                key: { marketKey: 'home', jobId: 'job1', resetAt: '2026-11-20T11:00:00.000Z' },
                transition: async (status) => {
                    if (status === 'completed') expect(sidecarWritten).toBe(true);
                    transitions.push(status);
                },
            }),
        };
        const service = serviceWithComplete(fake.port, recorder, completions);

        const result = await service.executeDetailed(job('File Decryption', { alreadyTaken: true, canComplete: true }));

        expect(result.ok).toBe(true);
        expect(sidecarWritten).toBe(true);
        expect(transitions.at(-1)).toBe('completed');
    });

    it('treats JOB_ACTION_FAILED as unconfirmed and records unknown', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'JOB_ACTION_FAILED', message: 'No job result' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(lifecycle.transitions).not.toContain('completed');
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });

    it('treats an unknown Complete error code as unconfirmed', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'WEIRD_GAME_CODE', message: 'rejected' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(lifecycle.transitions).not.toContain('completed');
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });

    it('treats a fallback GAME_JOB_FAILED as unconfirmed', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return {
                ok: false as const,
                error: { code: 'GAME_JOB_FAILED', message: 'job-conditions-not-met', unconfirmed: true },
            };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(lifecycle.transitions).not.toContain('completed');
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });

    it('treats a server-provided GAME_JOB_FAILED as unconfirmed', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'rejected' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
        expect(lifecycle.transitions).not.toContain('completed');
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });

    it('treats AUTH_REQUIRED and AUTH_EXPIRED as unconfirmed outside their real paths', async () => {
        for (const code of ['AUTH_REQUIRED', 'AUTH_EXPIRED']) {
            const fake = actions();
            fake.port.complete = async () => {
                fake.calls.push('complete');
                return { ok: false as const, error: { code, message: 'auth unavailable' } };
            };
            const lifecycle = lifecycleRecorder();
            const service = serviceWithComplete(fake.port, lifecycle.recorder);

            const result = await service.executeDetailed(job('File Decryption'));

            expect(result.ok).toBe(false);
            expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
            expect(fake.calls.filter((call) => call === 'take')).toHaveLength(1);
            expect(lifecycle.transitions).not.toContain('completed');
            expect(lifecycle.transitions.at(-1)).toBe('unknown');
        }
    });

    it('keeps confirmed-not-sent NO_COR3_TAB on the finite retry path', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(4);
        expect(lifecycle.transitions).not.toContain('completed');
    });

    it('keeps explicit INVALID_JOB on the finite retry path', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'INVALID_JOB', message: 'Invalid job data' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption'));

        expect(result.ok).toBe(false);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(4);
        expect(lifecycle.transitions).not.toContain('completed');
    });

    it('retries a transient market-not-reachable Complete instead of marking it unknown', async () => {
        const fake = actions();
        let attempts = 0;
        fake.port.complete = async () => {
            fake.calls.push('complete');
            attempts += 1;
            return attempts === 1
                ? { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'market-not-reachable' } }
                : { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('Log Deletion'));

        expect(result.ok).toBe(true);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(2);
        expect(lifecycle.transitions).not.toContain('unknown');
        expect(lifecycle.transitions.at(-1)).toBe('completed');
    });

    it('retries a transient Complete for a claimable job without taking it again', async () => {
        const fake = actions();
        let attempts = 0;
        fake.port.complete = async () => {
            fake.calls.push('complete');
            attempts += 1;
            return attempts === 1
                ? { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'market-not-reachable' } }
                : { ok: true as const, value: { credits: 1, reputation: 1, renown: 0 } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('File Decryption', {
            alreadyTaken: true,
            canComplete: true,
        }));

        expect(result.ok).toBe(true);
        expect(fake.calls).toEqual(['complete', 'complete']);
        expect(lifecycle.transitions).not.toContain('unknown');
    });

    it('keeps a transient Complete retryable after the bounded retries are exhausted', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'market-not-reachable' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('Log Deletion'));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('COMPLETE_FAILED');
            expect(result.error.unconfirmed).not.toBe(true);
            expect(result.error.retryable).toBe(true);
        }
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(3);
        expect(lifecycle.transitions).not.toContain('unknown');
    });

    it('treats a delayed already-completed response as a completed claim', async () => {
        const fake = actions();
        let attempts = 0;
        fake.port.complete = async () => {
            fake.calls.push('complete');
            attempts += 1;
            return attempts === 1
                ? { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'market-not-reachable' } }
                : { ok: false as const, error: { code: 'GAME_JOB_FAILED', message: 'job-already-completed' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('Log Deletion'));

        expect(result.ok).toBe(true);
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(2);
        expect(lifecycle.transitions.at(-1)).toBe('completed');
        expect(lifecycle.transitions).not.toContain('unknown');
        expect(lifecycle.transitions).not.toContain('expired');
    });

    it('does not retry an ambiguous Complete timeout', async () => {
        const fake = actions();
        fake.port.complete = async () => {
            fake.calls.push('complete');
            return { ok: false as const, error: { code: 'GAME_TIMEOUT', message: 'Timed out waiting for market:job.complete' } };
        };
        const lifecycle = lifecycleRecorder();
        const service = serviceWithComplete(fake.port, lifecycle.recorder);

        const result = await service.executeDetailed(job('Log Deletion'));

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.unconfirmed).toBe(true);
        }
        expect(fake.calls.filter((call) => call === 'complete')).toHaveLength(1);
        expect(lifecycle.transitions.at(-1)).toBe('unknown');
    });
});
