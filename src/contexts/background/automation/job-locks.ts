import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { jobIdentityKey, jobIdentityParts } from '../../../contracts/jobs.js';

export const MAX_RETRY_ATTEMPTS = 3;
/**
 * A job keeps its retry budget for one market reset, but transient game issues
 * must not strand it forever. After this window the budget is refreshed.
 */
export const RETRY_BUDGET_COOLDOWN_MS = 10 * 60_000;

export interface RetryAttempt {
    readonly count: number;
    readonly marketKey: string;
    readonly resetAt: string | null;
    readonly lastAttemptAt: number;
}

interface LockEntry {
    readonly until: number;
    readonly marketKey: string | null;
    readonly resetAt: string | null;
}

/**
 * Sole owner of the Auto Jobs job locks and retry budget. Persistence goes
 * through the existing automation state store; no other module mutates these
 * maps.
 *
 * Keys are `{marketKey, jobId}` identities, never jobId alone.
 */
export class JobLockRegistry {
    private readonly locks = new Map<string, LockEntry>();
    private readonly attempts = new Map<string, RetryAttempt>();

    constructor(
        private readonly state: AutomationStateStore,
        private readonly now: () => number = () => Date.now(),
    ) {}

    lockUntil(marketKey: string, jobId: string): number | undefined {
        return this.locks.get(jobIdentityKey(marketKey, jobId))?.until;
    }

    setLock(marketKey: string, jobId: string, until: number, resetAt: string | null = null): void {
        this.locks.set(jobIdentityKey(marketKey, jobId), { until, marketKey, resetAt });
    }

    deleteLock(marketKey: string, jobId: string): void {
        this.locks.delete(jobIdentityKey(marketKey, jobId));
    }

    clearLocks(): void {
        this.locks.clear();
    }

    isLocked(marketKey: string, jobId: string): boolean {
        const entry = this.locks.get(jobIdentityKey(marketKey, jobId));
        return entry !== undefined && entry.until > this.now();
    }

    pruneExpiredLocks(): void {
        for (const [key, entry] of this.locks) {
            if (entry.until <= this.now()) this.locks.delete(key);
        }
    }

    locksSnapshot(): Record<string, number> {
        const snapshot: Record<string, number> = {};
        const now = this.now();
        for (const [key, entry] of this.locks) {
            if (entry.until > now) snapshot[key] = entry.until;
        }
        return snapshot;
    }

    attemptsSnapshot(): Record<string, RetryAttempt> {
        const snapshot: Record<string, RetryAttempt> = {};
        for (const [key, entry] of this.attempts) snapshot[key] = entry;
        return snapshot;
    }

    isRetryExhausted(marketKey: string, jobId: string): boolean {
        const entry = this.attempts.get(jobIdentityKey(marketKey, jobId));
        if (entry === undefined || entry.count < MAX_RETRY_ATTEMPTS) return false;
        // Budgets expire after a quiet period so a batch of transient failures
        // does not hide a job until the next market reset.
        return this.now() - entry.lastAttemptAt < RETRY_BUDGET_COOLDOWN_MS;
    }

    retryAttempt(marketKey: string, jobId: string): RetryAttempt | undefined {
        return this.attempts.get(jobIdentityKey(marketKey, jobId));
    }

    retryEntries(): IterableIterator<[string, RetryAttempt]> {
        return this.attempts.entries();
    }

    retryCount(marketKey: string, jobId: string): number {
        return this.attempts.get(jobIdentityKey(marketKey, jobId))?.count ?? 0;
    }

    recordRetry(marketKey: string, jobId: string, resetAt: string | null): void {
        const now = this.now();
        const key = jobIdentityKey(marketKey, jobId);
        const current = this.attempts.get(key);
        const continuing = current !== undefined
            && current.resetAt === resetAt
            && now - current.lastAttemptAt <= RETRY_BUDGET_COOLDOWN_MS;
        this.attempts.set(key, {
            count: continuing ? current.count + 1 : 1,
            marketKey,
            resetAt,
            lastAttemptAt: now,
        });
    }

    clearAttempts(): void {
        this.attempts.clear();
    }

    /**
     * Drop attempts/locks only when the market reset is known and differs.
     *
     * A market missing from the map (sync failure, missing reset, unknown) must
     * not be interpreted as a reset change; doing so erased retry budgets and
     * locks during transient market failures. Records with an unknown previous
     * reset (`null`) are also left alone because there is nothing reliable to
     * compare against.
     */
    reconcileResets(resetByMarket: ReadonlyMap<string, string>): void {
        for (const [key, entry] of this.attempts) {
            const resetAt = resetByMarket.get(entry.marketKey);
            if (resetAt === undefined) continue;
            if (entry.resetAt === null) continue;
            if (resetAt !== entry.resetAt) this.attempts.delete(key);
        }
        for (const [key, entry] of this.locks) {
            if (entry.marketKey === null) continue;
            const resetAt = resetByMarket.get(entry.marketKey);
            if (resetAt === undefined) continue;
            if (entry.resetAt === null) continue;
            if (resetAt !== entry.resetAt) this.locks.delete(key);
        }
    }

    async persist(phase: 'idle' | 'running' | 'waiting' = 'idle'): Promise<void> {
        const locks: Record<string, { until: number; marketKey: string | null; resetAt: string | null }> = {};
        for (const [key, entry] of this.locks) {
            if (entry.until > this.now()) locks[key] = entry;
        }
        const attempts: Record<string, RetryAttempt> = {};
        for (const [key, entry] of this.attempts) attempts[key] = entry;
        await this.state.set('auto-jobs', {
            phase,
            payload: { locks, retryAttempts: attempts },
        });
    }

    /** Restore from the `auto-jobs` automation state entry during bootstrap. */
    restore(payload: Readonly<Record<string, unknown>>): void {
        const storedLocks = payload.locks;
        if (storedLocks && typeof storedLocks === 'object' && !Array.isArray(storedLocks)) {
            for (const [key, raw] of Object.entries(storedLocks)) {
                if (typeof raw === 'number') {
                    // Legacy jobId-only lock: it cannot be attributed to a
                    // market, so do not apply it to any market.
                    continue;
                }
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as { until?: unknown; marketKey?: unknown; resetAt?: unknown };
                const identity = restoreIdentity(key, entry.marketKey);
                if (!identity) continue;
                if (typeof entry.until !== 'number' || entry.until <= this.now()) continue;
                this.locks.set(jobIdentityKey(identity.marketKey, identity.jobId), {
                    until: entry.until,
                    marketKey: identity.marketKey,
                    resetAt: typeof entry.resetAt === 'string' ? entry.resetAt : null,
                });
            }
        }
        const storedAttempts = payload.retryAttempts;
        if (storedAttempts && typeof storedAttempts === 'object' && !Array.isArray(storedAttempts)) {
            for (const [key, raw] of Object.entries(storedAttempts)) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as { count?: unknown; marketKey?: unknown; resetAt?: unknown; lastAttemptAt?: unknown };
                const identity = restoreIdentity(key, entry.marketKey);
                if (!identity || typeof entry.count !== 'number') continue;
                this.attempts.set(jobIdentityKey(identity.marketKey, identity.jobId), {
                    count: entry.count,
                    marketKey: identity.marketKey,
                    resetAt: typeof entry.resetAt === 'string' ? entry.resetAt : null,
                    lastAttemptAt: typeof entry.lastAttemptAt === 'number' ? entry.lastAttemptAt : 0,
                });
            }
        }
    }
}

/**
 * Restore an identity from either the new market-scoped key or a legacy
 * jobId-only key that still carries a marketKey in its entry. A legacy key
 * without a market is discarded rather than guessed.
 */
function restoreIdentity(key: string, marketKey: unknown): { readonly marketKey: string; readonly jobId: string } | null {
    const parsed = jobIdentityParts(key);
    if (parsed) return parsed;
    if (typeof marketKey !== 'string' || marketKey.length === 0 || key.length === 0) return null;
    return { marketKey, jobId: key };
}
