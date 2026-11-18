import { describe, expect, it } from 'vitest';
import type { AutoJobsSnapshot } from '../../contracts/auto-jobs.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import { mergeAutoJobsSnapshot } from './snapshot.js';

function job(id: string, marketKey: string): JobOffer {
    return {
        id,
        name: 'IP Injection',
        type: 'IP Injection',
        marketId: `market-${marketKey}`,
        marketKey,
        serverId: 'server',
        serverName: 'server',
        rewardCredits: 1,
        rewardReputation: 1,
        deposit: 0,
        alreadyTaken: false,
        canComplete: false,
    };
}

function snapshot(at: number, marketKeys: readonly string[], jobs: readonly JobOffer[]): AutoJobsSnapshot {
    return {
        at,
        jobs,
        markets: marketKeys.map((marketKey) => ({
            marketKey,
            label: marketKey.toUpperCase(),
            ok: true,
            skipped: 0,
            resetAt: `reset-${marketKey}`,
        })),
    };
}

describe('mergeAutoJobsSnapshot', () => {
    it('keeps jobs and reset countdown for failed markets', () => {
        const previous = snapshot(1, ['home', 'dark'], [job('home-1', 'home'), job('dark-1', 'dark')]);
        const update: AutoJobsSnapshot = {
            at: 2,
            jobs: [],
            markets: [{
                marketKey: 'home',
                label: 'HOME',
                ok: false,
                skipped: 0,
                resetAt: null,
                error: 'maintenance',
            }],
        };
        const result = mergeAutoJobsSnapshot(previous, update);
        expect(result.jobs.map((entry) => entry.id)).toEqual(['home-1', 'dark-1']);
        expect(result.markets.find((market) => market.marketKey === 'home')).toMatchObject({
            ok: false,
            resetAt: 'reset-home',
            error: 'maintenance',
        });
        expect(result.markets.find((market) => market.marketKey === 'dark')).toMatchObject({
            ok: true,
            resetAt: 'reset-dark',
        });
    });

    it('keeps skipped job details for failed markets', () => {
        const base = snapshot(1, ['home'], [job('home-1', 'home')]);
        const previous: AutoJobsSnapshot = {
            ...base,
            markets: [{
                ...base.markets[0]!,
                skippedJobs: [{ id: 'failed', name: 'IP Injection', serverName: 'server', status: 'failed', reason: 'Recent job status: FAILED' }],
            }],
        };
        const result = mergeAutoJobsSnapshot(previous, {
            at: 2,
            jobs: [],
            markets: [{ marketKey: 'home', label: 'HOME', ok: false, skipped: 0, resetAt: null, error: 'maintenance' }],
        });
        expect(result.markets[0]?.skippedJobs).toHaveLength(1);
    });

    it('replaces jobs for a refreshed market even when the new list is empty', () => {
        const previous = snapshot(1, ['home'], [job('home-1', 'home')]);
        const result = mergeAutoJobsSnapshot(previous, snapshot(2, ['home'], []));
        expect(result.jobs).toHaveLength(0);
    });

    it('keeps markets that are absent from a partial update', () => {
        const previous = snapshot(1, ['home', 'dark'], [job('home-1', 'home'), job('dark-1', 'dark')]);
        const update = snapshot(2, ['home'], [job('home-2', 'home')]);
        const result = mergeAutoJobsSnapshot(previous, update);
        expect(result.jobs.map((entry) => entry.id)).toEqual(['home-2', 'dark-1']);
        expect(result.markets.map((market) => market.marketKey).sort()).toEqual(['dark', 'home']);
    });

    it('normalizes freshness metadata without a previous snapshot', () => {
        const update = snapshot(2, ['home'], [job('home-1', 'home')]);
        const result = mergeAutoJobsSnapshot(null, update);
        expect(result.jobs).toEqual(update.jobs);
        expect(result.markets[0]).toMatchObject({ updatedAt: 2, stale: false });
    });

    it('marks a failed market stale while keeping its last refresh time', () => {
        const previous = snapshot(10, ['home'], [job('home-1', 'home')]);
        const update: AutoJobsSnapshot = {
            at: 20,
            jobs: [],
            markets: [{ marketKey: 'home', label: 'HOME', ok: false, skipped: 0, error: 'timeout', errorCode: 'MARKET_FETCH_FAILED' }],
        };
        const result = mergeAutoJobsSnapshot(previous, update);
        expect(result.markets[0]).toMatchObject({ stale: true, updatedAt: 10, error: 'timeout' });
    });
});
