import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';

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
 */
export class JobLockRegistry {
    private readonly locks = new Map<string, LockEntry>();
    private readonly attempts = new Map<string, RetryAttempt>();

    constructor(
        private readonly state: AutomationStateStore,
        private readonly now: () => number = () => Date.now(),
    ) {}

    lockUntil(jobId: string): number | undefined {
        return this.locks.get(jobId)?.until;
    }

    setLock(jobId: string, until: number, marketKey: string | null = null, resetAt: string | null = null): void {
        this.locks.set(jobId, { until, marketKey, resetAt });
    }

    deleteLock(jobId: string): void {
        this.locks.delete(jobId);
    }

    clearLocks(): void {
        this.locks.clear();
    }

    isLocked(jobId: string): boolean {
        const entry = this.locks.get(jobId);
        return entry !== undefined && entry.until > this.now();
    }

    pruneExpiredLocks(): void {
        for (const [jobId, entry] of this.locks) {
            if (entry.until <= this.now()) this.locks.delete(jobId);
        }
    }

    locksSnapshot(): Record<string, number> {
        const snapshot: Record<string, number> = {};
        const now = this.now();
        for (const [jobId, entry] of this.locks) {
            if (entry.until > now) snapshot[jobId] = entry.until;
        }
        return snapshot;
    }

    attemptsSnapshot(): Record<string, RetryAttempt> {
        const snapshot: Record<string, RetryAttempt> = {};
        for (const [jobId, entry] of this.attempts) snapshot[jobId] = entry;
        return snapshot;
    }

    isRetryExhausted(jobId: string): boolean {
        const entry = this.attempts.get(jobId);
        if (entry === undefined || entry.count < MAX_RETRY_ATTEMPTS) return false;
        // Budgets expire after a quiet period so a batch of transient failures
        // does not hide a job until the next market reset.
        return this.now() - entry.lastAttemptAt < RETRY_BUDGET_COOLDOWN_MS;
    }

    retryAttempt(jobId: string): RetryAttempt | undefined {
        return this.attempts.get(jobId);
    }

    retryEntries(): IterableIterator<[string, RetryAttempt]> {
        return this.attempts.entries();
    }

    retryCount(jobId: string): number {
        return this.attempts.get(jobId)?.count ?? 0;
    }

    recordRetry(jobId: string, marketKey: string, resetAt: string | null): void {
        const now = this.now();
        const current = this.attempts.get(jobId);
        const continuing = current !== undefined
            && current.resetAt === resetAt
            && now - current.lastAttemptAt <= RETRY_BUDGET_COOLDOWN_MS;
        this.attempts.set(jobId, {
            count: continuing ? current.count + 1 : 1,
            marketKey,
            resetAt,
            lastAttemptAt: now,
        });
    }

    clearAttempts(): void {
        this.attempts.clear();
    }

    /** Drop attempts whose market reset changed since they were recorded. */
    reconcileResets(resetByMarket: ReadonlyMap<string, string | null>): void {
        for (const [jobId, entry] of this.attempts) {
            const resetAt = resetByMarket.get(entry.marketKey) ?? null;
            if (resetAt !== entry.resetAt) this.attempts.delete(jobId);
        }
        for (const [jobId, entry] of this.locks) {
            if (entry.marketKey === null) continue;
            const resetAt = resetByMarket.get(entry.marketKey) ?? null;
            if (entry.resetAt !== resetAt) this.locks.delete(jobId);
        }
    }

    async persist(phase: 'idle' | 'running' | 'waiting' = 'idle'): Promise<void> {
        const locks: Record<string, { until: number; marketKey: string | null; resetAt: string | null }> = {};
        for (const [jobId, entry] of this.locks) {
            if (entry.until > this.now()) locks[jobId] = entry;
        }
        const attempts: Record<string, RetryAttempt> = {};
        for (const [jobId, entry] of this.attempts) attempts[jobId] = entry;
        await this.state.set('auto-jobs', {
            phase,
            payload: { locks, retryAttempts: attempts },
        });
    }

    /** Restore from the `auto-jobs` automation state entry during bootstrap. */
    restore(payload: Readonly<Record<string, unknown>>): void {
        const storedLocks = payload.locks;
        if (storedLocks && typeof storedLocks === 'object' && !Array.isArray(storedLocks)) {
            for (const [jobId, raw] of Object.entries(storedLocks)) {
                if (typeof raw === 'number') {
                    if (raw > this.now()) this.locks.set(jobId, { until: raw, marketKey: null, resetAt: null });
                    continue;
                }
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as { until?: unknown; marketKey?: unknown; resetAt?: unknown };
                if (typeof entry.until !== 'number' || entry.until <= this.now()) continue;
                this.locks.set(jobId, {
                    until: entry.until,
                    marketKey: typeof entry.marketKey === 'string' ? entry.marketKey : null,
                    resetAt: typeof entry.resetAt === 'string' ? entry.resetAt : null,
                });
            }
        }
        const storedAttempts = payload.retryAttempts;
        if (storedAttempts && typeof storedAttempts === 'object' && !Array.isArray(storedAttempts)) {
            for (const [jobId, raw] of Object.entries(storedAttempts)) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as { count?: unknown; marketKey?: unknown; resetAt?: unknown; lastAttemptAt?: unknown };
                if (typeof entry.count === 'number' && typeof entry.marketKey === 'string') {
                    this.attempts.set(jobId, {
                        count: entry.count,
                        marketKey: entry.marketKey,
                        resetAt: typeof entry.resetAt === 'string' ? entry.resetAt : null,
                        lastAttemptAt: typeof entry.lastAttemptAt === 'number' ? entry.lastAttemptAt : 0,
                    });
                }
            }
        }
    }
}
