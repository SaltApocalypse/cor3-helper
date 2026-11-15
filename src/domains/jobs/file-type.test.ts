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

    it('falls back to file info or the downloaded file name', () => {
        expect(decryptFileType(job({ fileInfo: { name: 'archive.zip' } }))).toBe('.zip');
        expect(decryptFileType(job({}), 'download.tar')).toBe('.tar');
    });

    it('returns null when no file type is available', () => {
        expect(decryptFileType(job({}))).toBeNull();
    });
});
