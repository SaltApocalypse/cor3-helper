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
            registry.recordRetry('job-1', 'home', 'reset-a');
        }
        expect(registry.isRetryExhausted('job-1')).toBe(true);
    });

    it('refreshes the budget after the cooldown window', () => {
        const made = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            made.registry.recordRetry('job-1', 'home', 'reset-a');
        }
        made.now.value += RETRY_BUDGET_COOLDOWN_MS + 1;
        expect(made.registry.isRetryExhausted('job-1')).toBe(false);
        made.registry.recordRetry('job-1', 'home', 'reset-a');
        expect(made.registry.retryCount('job-1')).toBe(1);
    });

    it('resets the budget when the market reset changes', () => {
        const { registry } = makeRegistry();
        for (let index = 0; index < MAX_RETRY_ATTEMPTS; index++) {
            registry.recordRetry('job-1', 'home', 'reset-a');
        }
        registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(registry.isRetryExhausted('job-1')).toBe(false);
    });
});

describe('JobLockRegistry locks', () => {
    it('drops a lock when its market reset changes', () => {
        const made = makeRegistry();
        made.registry.setLock('job-1', made.now.value + 60_000, 'home', 'reset-a');
        expect(made.registry.isLocked('job-1')).toBe(true);
        made.registry.reconcileResets(new Map([['home', 'reset-b']]));
        expect(made.registry.isLocked('job-1')).toBe(false);
    });

    it('keeps a lock while the reset is unchanged', () => {
        const made = makeRegistry();
        made.registry.setLock('job-1', made.now.value + 60_000, 'home', 'reset-a');
        made.registry.reconcileResets(new Map([['home', 'reset-a']]));
        expect(made.registry.isLocked('job-1')).toBe(true);
    });
});
