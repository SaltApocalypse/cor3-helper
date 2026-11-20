import type {
    MarketCompletionPruneOutcome,
    MarketCompletionStoreOutcome,
    MarketCompletionStorePort,
    MarketCompletionWriteInput,
} from '../../application/auto-job/market-completion.js';
import {
    EMPTY_MARKET_COMPLETED_JOBS,
    marketCompletedJobsSchema,
    type MarketCompletedJobsState,
} from '../../contracts/market-completed-jobs.js';
import { JOB_STATE_UNKNOWN_RESET } from '../../contracts/job-state.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.auto-finish.completedJobs';
const SCHEMA_VERSION = 1;

function requireValue(value: string, field: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${field} is required`);
    return trimmed;
}

function requireReset(value: string, field: string): string {
    const trimmed = requireValue(value, field);
    if (trimmed === JOB_STATE_UNKNOWN_RESET) throw new Error(`${field} must be a known reset`);
    return trimmed;
}

/**
 * Sidecar completion store keyed by market then job. It deliberately does not
 * read or write the legacy `v2.auto-finish` completedJobs map.
 */
export class MarketCompletedJobsStore implements MarketCompletionStorePort {
    private readonly repository: VersionedRepository<MarketCompletedJobsState>;
    private writeQueue: Promise<unknown> = Promise.resolve();

    constructor(area: StorageArea, clock?: { now(): number }, logger?: { warn(scope: string, message: string, data?: unknown): void }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: marketCompletedJobsSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    private enqueue<T>(run: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    private async read(): Promise<MarketCompletedJobsState> {
        return (await this.repository.get()) ?? EMPTY_MARKET_COMPLETED_JOBS;
    }

    async get(): Promise<MarketCompletedJobsState> {
        await this.writeQueue.catch(() => undefined);
        return this.read();
    }

    async getState(): Promise<MarketCompletedJobsState> {
        return this.get();
    }

    async clear(): Promise<void> {
        await this.enqueue(() => this.repository.clear());
    }

    /**
     * Removes only stale reset records in one market. Invalid/unknown resets
     * and job absence never cause deletion; other markets are untouched.
     */
    async pruneMarketBeforeReset(marketKey: string, currentResetAt: string): Promise<MarketCompletionPruneOutcome> {
        const market = requireValue(marketKey, 'marketKey');
        const current = currentResetAt.trim();
        if (current.length === 0 || current === JOB_STATE_UNKNOWN_RESET) {
            return { status: 'skipped', reason: 'unknown-reset', state: await this.get() };
        }
        const currentTime = Date.parse(current);
        if (!Number.isFinite(currentTime)) {
            return { status: 'skipped', reason: 'invalid-reset', state: await this.get() };
        }
        return this.enqueue(async () => {
            const state = await this.read();
            const jobs = state.byMarket[market];
            if (!jobs) return { status: 'pruned', removed: 0, state };
            const next: Record<string, string> = {};
            let removed = 0;
            for (const [jobId, stored] of Object.entries(jobs)) {
                const storedTime = Date.parse(stored);
                if (Number.isFinite(storedTime) && storedTime < currentTime) {
                    removed += 1;
                } else {
                    next[jobId] = stored;
                }
            }
            if (removed === 0) return { status: 'pruned', removed: 0, state };
            const updated = { byMarket: { ...state.byMarket, [market]: next } };
            await this.repository.set(updated);
            return { status: 'pruned', removed, state: updated };
        });
    }

    async getCompletion(marketKey: string, jobId: string): Promise<string | null> {
        const market = marketKey.trim();
        const job = jobId.trim();
        if (market.length === 0 || job.length === 0) return null;
        const state = await this.get();
        return state.byMarket[market]?.[job] ?? null;
    }

    async recordCompletion(input: MarketCompletionWriteInput): Promise<MarketCompletionStoreOutcome> {
        const marketKey = requireValue(input.marketKey, 'marketKey');
        const jobId = requireValue(input.jobId, 'jobId');
        const resetAt = requireReset(input.resetAt, 'resetAt');
        const expected = input.expectedExistingResetAt === undefined
            ? undefined
            : input.expectedExistingResetAt === null
                ? null
                : requireReset(input.expectedExistingResetAt, 'expectedExistingResetAt');

        return this.enqueue(async () => {
            const current = await this.read();
            const market = current.byMarket[marketKey] ?? {};
            const existingResetAt = market[jobId];

            if (existingResetAt === resetAt) {
                if (expected !== undefined && expected !== existingResetAt) {
                    return { status: 'reset-mismatch', existingResetAt };
                }
                return { status: 'already-recorded' };
            }
            if (existingResetAt !== undefined) {
                if (expected === undefined || expected === null || expected !== existingResetAt) {
                    return { status: 'reset-mismatch', existingResetAt };
                }
                await this.repository.set({
                    byMarket: {
                        ...current.byMarket,
                        [marketKey]: { ...market, [jobId]: resetAt },
                    },
                });
                return { status: 'written', previousResetAt: existingResetAt };
            }
            if (expected !== undefined && expected !== null) {
                // Caller expected a specific old value, but there is no record.
                return { status: 'reset-mismatch' };
            }
            await this.repository.set({
                byMarket: {
                    ...current.byMarket,
                    [marketKey]: { ...market, [jobId]: resetAt },
                },
            });
            return { status: 'written' };
        });
    }
}
