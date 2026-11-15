import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';

export const MAX_RETRY_ATTEMPTS = 3;

export interface RetryAttempt {
    readonly count: number;
    readonly marketKey: string;
    readonly resetAt: string | null;
}

/**
 * Sole owner of the Auto Jobs job locks and retry budget. Persistence goes
 * through the existing automation state store; no other module mutates these
 * maps.
 */
export class JobLockRegistry {
    private readonly locks = new Map<string, number>();
    private readonly attempts = new Map<string, RetryAttempt>();

    constructor(
        private readonly state: AutomationStateStore,
        private readonly now: () => number = () => Date.now(),
    ) {}

    lockUntil(jobId: string): number | undefined {
        return this.locks.get(jobId);
    }

    setLock(jobId: string, until: number): void {
        this.locks.set(jobId, until);
    }

    deleteLock(jobId: string): void {
        this.locks.delete(jobId);
    }

    clearLocks(): void {
        this.locks.clear();
    }

    isLocked(jobId: string): boolean {
        const until = this.locks.get(jobId);
        return until !== undefined && until > this.now();
    }

    pruneExpiredLocks(): void {
        for (const [jobId, until] of this.locks) {
            if (until <= this.now()) this.locks.delete(jobId);
        }
    }

    isRetryExhausted(jobId: string): boolean {
        const entry = this.attempts.get(jobId);
        return entry !== undefined && entry.count >= MAX_RETRY_ATTEMPTS;
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
        const current = this.attempts.get(jobId);
        const count = current && current.resetAt === resetAt ? current.count : 0;
        this.attempts.set(jobId, { count: count + 1, marketKey, resetAt });
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
    }

    async persist(phase: 'idle' | 'running' | 'waiting' = 'idle'): Promise<void> {
        const locks: Record<string, number> = {};
        for (const [jobId, until] of this.locks) if (until > this.now()) locks[jobId] = until;
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
            for (const [jobId, until] of Object.entries(storedLocks)) {
                if (typeof until === 'number' && until > this.now()) this.locks.set(jobId, until);
            }
        }
        const storedAttempts = payload.retryAttempts;
        if (storedAttempts && typeof storedAttempts === 'object' && !Array.isArray(storedAttempts)) {
            for (const [jobId, raw] of Object.entries(storedAttempts)) {
                if (!raw || typeof raw !== 'object') continue;
                const entry = raw as { count?: unknown; marketKey?: unknown; resetAt?: unknown };
                if (typeof entry.count === 'number' && typeof entry.marketKey === 'string') {
                    this.attempts.set(jobId, {
                        count: entry.count,
                        marketKey: entry.marketKey,
                        resetAt: typeof entry.resetAt === 'string' ? entry.resetAt : null,
                    });
                }
            }
        }
    }
}
