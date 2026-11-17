import { describe, expect, it } from 'vitest';
import { decryptFileType, type JobOffer } from './model.js';

function job(patch: Partial<JobOffer>): JobOffer {
    return {
        id: 'job-1',
        name: 'File Decryption',
        type: 'File Decryption',
        marketId: 'market-1',
        marketKey: 'home',
        serverId: null,
        serverName: null,
        rewardCredits: 0,
        rewardReputation: 0,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
        ...patch,
    };
}

describe('decryptFileType', () => {
    it('reads the condition fileExtension and normalizes it', () => {
        expect(decryptFileType(job({ conditions: [{ type: 'DecryptFile', details: { fileExtension: 'doc' } }] }))).toBe('.doc');
    });

    it('accepts an extension that already includes a dot', () => {
        expect(decryptFileType(job({ conditions: [{ type: 'DecryptFile', details: { fileExtension: '.pdf' } }] }))).toBe('.pdf');
    });

    it('falls back to the condition file name', () => {
        expect(decryptFileType(job({ conditions: [{ type: 'DecryptFile', details: { files: [{ name: 'report.xlsx' }] } }] }))).toBe('.xlsx');
    });

    it('reads file-level extensions from condition files', () => {
        expect(decryptFileType(job({ conditions: [{ type: 'DecryptFile', details: { files: [{ name: 'report', fileExtension: 'csv' }] } }] }))).toBe('.csv');
    });

    it('ignores generic encrypted files from download/upload conditions', () => {
        expect(decryptFileType(job({
            conditions: [
                { type: 'DownloadFile', details: { files: [{ name: 'payload.enc' }] } },
                { type: 'DecryptFile', details: { files: [{ name: 'report.eb52x' }] } },
            ],
        }))).toBe('.eb52x');
    });

    it('prefers a real format over .enc inside a decrypt condition', () => {
        expect(decryptFileType(job({
            conditions: [{ type: 'DecryptFile', details: { fileExtension: '.enc', files: [{ name: 'report.eb52x' }] } }],
        }))).toBe('.eb52x');
    });

    it('uses the downloaded file name over a generic decrypt extension', () => {
        expect(decryptFileType(job({
            conditions: [{ type: 'DecryptFile', details: { fileExtension: '.enc' } }],
        }), 'report.eb52x')).toBe('.eb52x');
    });

    it('prefers the actual downloaded file when its suffix changed', () => {
        expect(decryptFileType(job({
            conditions: [{ type: 'DecryptFile', details: { fileExtension: '.dat' } }],
        }), 'report_8918.eb54x', { preferFileName: true })).toBe('.eb54x');
    });

    it('keeps .enc when it is the only decrypt extension available', () => {
        expect(decryptFileType(job({
            conditions: [{ type: 'DecryptFile', details: { fileExtension: '.enc' } }],
        }))).toBe('.enc');
    });

    it('falls back to file info or the downloaded file name', () => {
        expect(decryptFileType(job({ fileInfo: { name: 'archive.zip' } }))).toBe('.zip');
        expect(decryptFileType(job({}), 'download.tar')).toBe('.tar');
    });

    it('returns null when no file type is available', () => {
        expect(decryptFileType(job({}))).toBeNull();
    });
});
