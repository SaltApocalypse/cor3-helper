import { describe, expect, it, vi } from 'vitest';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { JobLockRegistry, MAX_RETRY_ATTEMPTS, RETRY_BUDGET_COOLDOWN_MS } from './job-locks.js';

function makeRegistry(now = { value: 1_000 }) {
    const store = { set: vi.fn(async () => undefined) } as unknown as AutomationStateStore;
    return { registry: new JobLockRegistry(store, () => now.value), store, now };
}

describe('JobLockRegistry retry budget', () => {
    it('exhausts the budget after the configured attempts', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('home', 'job-1', 'reset-a');
        }
        expect(registry.isRetryExhausted('home', 'job-1')).toBe(true);
    });

    it('refreshes the budget after the cooldown window', () => {
        const made = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            made.registry.recordRetry('home', 'job-1', 'reset-a');
        }
        made.now.value += RETRY_BUDGET_COOLDOWN_MS + 1;
        expect(made.registry.isRetryExhausted('home', 'job-1')).toBe(false);
        made.registry.recordRetry('home', 'job-1', 'reset-a');
        expect(made.registry.retryCount('home', 'job-1')).toBe(1);
    });

    it('resets the budget when the market reset changes', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('home', 'job-1', 'reset-a');
        }
        registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(registry.isRetryExhausted('home', 'job-1')).toBe(false);
    });

    it('keeps the budget when the market is missing from the reconciliation input', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('home', 'job-1', 'reset-a');
        }
        registry.reconcileResets(new Map());
        expect(registry.isRetryExhausted('home', 'job-1')).toBe(true);
        expect(registry.retryAttempt('home', 'job-1')?.count).toBe(MAX_RETRY_ATTEMPTS);
    });

    it('does not compare a record whose previous reset was unknown', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('home', 'job-1', null);
        }
        registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(registry.isRetryExhausted('home', 'job-1')).toBe(true);
    });

    it('does not touch other markets when one reset changes', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('home', 'home-job', 'reset-a');
            registry.recordRetry('dark', 'dark-job', 'reset-dark');
        }
        registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(registry.isRetryExhausted('home', 'home-job')).toBe(false);
        expect(registry.isRetryExhausted('dark', 'dark-job')).toBe(true);
    });
});

describe('JobLockRegistry locks', () => {
    it('drops a lock when its market reset changes', () => {
        const made = makeRegistry();
        made.registry.setLock('home', 'job-1', made.now.value + 60_000, 'reset-a');
        expect(made.registry.isLocked('home', 'job-1')).toBe(true);
        made.registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(made.registry.isLocked('home', 'job-1')).toBe(false);
    });

    it('keeps a lock while the reset is unchanged', () => {
        const made = makeRegistry();
        made.registry.setLock('home', 'job-1', made.now.value + 60_000, 'reset-a');
        made.registry.reconcileResets(new Map([['home', 'reset-a']]));
        expect(made.registry.isLocked('home', 'job-1')).toBe(true);
    });

    it('keeps a lock when the market is missing from the reconciliation input', () => {
        const made = makeRegistry();
        made.registry.setLock('home', 'job-1', made.now.value + 60_000, 'reset-a');
        made.registry.reconcileResets(new Map());
        expect(made.registry.isLocked('home', 'job-1')).toBe(true);
    });

    it('does not clear a lock whose previous reset was unknown', () => {
        const made = makeRegistry();
        made.registry.setLock('home', 'job-1', made.now.value + 60_000, null);
        made.registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(made.registry.isLocked('home', 'job-1')).toBe(true);
    });

    it('keeps locks and retry budgets isolated across markets with the same job id', () => {
        const made = makeRegistry();
        made.registry.setLock('home', 'shared', made.now.value + 60_000, 'reset-a');
        made.registry.setLock('dark', 'shared', made.now.value + 60_000, 'reset-a');
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            made.registry.recordRetry('home', 'shared', 'reset-a');
        }

        expect(made.registry.isLocked('home', 'shared')).toBe(true);
        expect(made.registry.isLocked('dark', 'shared')).toBe(true);
        expect(made.registry.isRetryExhausted('home', 'shared')).toBe(true);
        expect(made.registry.isRetryExhausted('dark', 'shared')).toBe(false);

        made.registry.deleteLock('home', 'shared');
        expect(made.registry.isLocked('home', 'shared')).toBe(false);
        expect(made.registry.isLocked('dark', 'shared')).toBe(true);

        made.registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(made.registry.isRetryExhausted('home', 'shared')).toBe(false);
        expect(made.registry.isRetryExhausted('dark', 'shared')).toBe(false);
        expect(made.registry.isLocked('dark', 'shared')).toBe(true);
    });

    it('migrates legacy persisted entries with a market and drops unattributable ones', () => {
        const made = makeRegistry();
        made.registry.restore({
            locks: {
                'legacy-attributed': { until: made.now.value + 60_000, marketKey: 'home', resetAt: 'reset-a' },
                'legacy-unattributed': 12345,
            },
            retryAttempts: {
                'legacy-attempt': { count: 2, marketKey: 'home', resetAt: 'reset-a', lastAttemptAt: made.now.value },
            },
        });

        expect(made.registry.isLocked('home', 'legacy-attributed')).toBe(true);
        expect(made.registry.isLocked('dark', 'legacy-attributed')).toBe(false);
        expect(made.registry.isLocked('home', 'legacy-unattributed')).toBe(false);
        expect(made.registry.isRetryExhausted('home', 'legacy-attempt')).toBe(false);
        expect(made.registry.retryCount('home', 'legacy-attempt')).toBe(2);
        expect(made.registry.retryCount('dark', 'legacy-attempt')).toBe(0);
    });
});
