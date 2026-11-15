import type { DailyOpsCacheStore } from '../../../infrastructure/storage/daily-ops-cache-store.js';
import type { ChromeTabDailyOpsAdapter } from '../../../infrastructure/browser/chrome-tab-daily-ops-adapter.js';
import { mapDailyOps } from '../../../application/daily-ops/map.js';
import type { DailyOpsState } from '../../../domains/daily-ops/model.js';
import { ok, type Result } from '../../../kernel/result.js';

export interface DailyCacheDeps {
    readonly adapter: Pick<ChromeTabDailyOpsAdapter, 'getDailyOps' | 'getRewards'>;
    readonly store: DailyOpsCacheStore;
    readonly clock: { now(): number };
}

/** Sole owner of the in-memory daily-ops cache and its reset-aware validity. */
export class DailyOpsCacheService {
    private memory: { readonly at: number; readonly value: DailyOpsState } | null = null;
    private loaded = false;

    constructor(private readonly deps: DailyCacheDeps) {}

    remember(value: DailyOpsState): void {
        this.memory = { at: this.deps.clock.now(), value };
        this.loaded = true;
        void this.deps.store.set(value);
    }

    async persist(value: DailyOpsState): Promise<void> {
        this.memory = { at: this.deps.clock.now(), value };
        this.loaded = true;
        await this.deps.store.set(value);
    }

    async read(force = false): Promise<Result<DailyOpsState, { code: string; message: string }>> {
        if (!force) {
            if (!this.loaded) {
                this.memory = await this.deps.store.get();
                this.loaded = true;
            }
            if (this.memory && this.valid(this.memory)) return ok(this.memory.value);
        }
        const ops = await this.deps.adapter.getDailyOps();
        if (!ops.ok) return { ok: false, error: { code: ops.error.code, message: ops.error.message } };
        const rewards = await this.deps.adapter.getRewards();
        const state = mapDailyOps(ops.value, rewards.ok ? rewards.value : []);
        if (!state) return { ok: false, error: { code: 'DAILY_INVALID', message: 'Daily ops payload failed schema validation' } };
        await this.persist(state);
        return ok(state);
    }

    async clear(): Promise<void> {
        this.memory = null;
        this.loaded = false;
        await this.deps.store.clear();
    }

    private valid(entry: { readonly at: number; readonly value: DailyOpsState }): boolean {
        const nextAt = entry.value.nextTaskTime ? new Date(entry.value.nextTaskTime).getTime() : Number.NaN;
        // If the payload carries a reset time, it is authoritative: a past reset
        // means a new daily task is available and the cached claimed/unclaimed
        // state must be refreshed. Only fall back to age for payloads without one.
        if (Number.isFinite(nextAt)) return nextAt > this.deps.clock.now();
        return this.deps.clock.now() - entry.at < 12 * 60 * 60 * 1000;
    }
}
