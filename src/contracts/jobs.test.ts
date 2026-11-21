import { describe, expect, it } from 'vitest';
import { jobIdentityKey, jobIdentityParts } from './jobs.js';

describe('job identity', () => {
    it('treats the same job id in different markets as different identities', () => {
        const home = jobIdentityKey('home', 'shared');
        const dark = jobIdentityKey('dark', 'shared');
        expect(home).not.toBe(dark);
        expect(jobIdentityParts(home)).toEqual({ marketKey: 'home', jobId: 'shared' });
        expect(jobIdentityParts(dark)).toEqual({ marketKey: 'dark', jobId: 'shared' });
    });

    it('keeps the same market and job id stable', () => {
        expect(jobIdentityKey('home', 'shared')).toBe(jobIdentityKey('home', 'shared'));
        expect(jobIdentityParts(jobIdentityKey('home', 'shared'))).toEqual({ marketKey: 'home', jobId: 'shared' });
    });

    it('does not infer a market for a legacy jobId-only key', () => {
        expect(jobIdentityParts('legacy-job')).toBeNull();
        expect(jobIdentityParts('123')).toBeNull();
    });
});
