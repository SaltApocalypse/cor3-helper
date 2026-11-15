import type { SettingsV1 } from '../../../contracts/storage.js';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { ChromeTabDailyOpsAdapter } from '../../../infrastructure/browser/chrome-tab-daily-ops-adapter.js';
import type { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import { mapDailyOps } from '../../../application/daily-ops/map.js';
import { planNextDailyRun } from '../../../application/daily-ops/schedule.js';
import type { DailyOpsState } from '../../../domains/daily-ops/model.js';
import type { AutomationLogger, EventPublisher, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import { ok, type Result } from '../../../kernel/result.js';
import { AUTO_DAILY_HACK_ALARM } from './alarm-ids.js';
import type { DailyOpsCacheService } from './daily-cache.js';

export interface AutoDailyLast {
    readonly at: number;
    readonly solved: boolean;
    readonly puzzle: string;
    readonly message: string;
}

export interface AutoDailyDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly events: EventPublisher;
    readonly logger: AutomationLogger;
    readonly clock: { now(): number };
    readonly state: AutomationStateStore;
    readonly adapter: Pick<ChromeTabDailyOpsAdapter, 'getDailyOps' | 'getRewards' | 'solveHack' | 'cancelHack'>;
    readonly cache: DailyOpsCacheService;
    readonly networkOps: Pick<NetworkOperationQueue, 'enqueue'>;
}

export class AutoDailyCoordinator {
    private running = false;
    private last: AutoDailyLast | null = null;
    private state: DailyOpsState | null = null;
    private nextRunAt: number | null = null;
    private nextRunReason: string | null = null;

    constructor(private readonly deps: AutoDailyDeps) {}

    isRunning(): boolean {
        return this.running;
    }

    lastRun(): AutoDailyLast | null {
        return this.last;
    }

    dailyState(): DailyOpsState | null {
        return this.state;
    }

    nextRun(): { readonly at: number | null; readonly reason: string | null } {
        return { at: this.nextRunAt, reason: this.nextRunReason };
    }

    restore(payload: Readonly<Record<string, unknown>>): void {
        const stored = payload.last;
        if (!stored || typeof stored !== 'object') return;
        const entry = stored as Partial<{ at: number; solved: boolean; puzzle: string; message: string }>;
        if (typeof entry.at === 'number' && typeof entry.solved === 'boolean' && typeof entry.puzzle === 'string' && typeof entry.message === 'string') {
            this.last = { at: entry.at, solved: entry.solved, puzzle: entry.puzzle, message: entry.message };
        }
    }

    async status() {
        const current = await this.deps.settings.get();
        const alarm = await this.deps.scheduler.get(AUTO_DAILY_HACK_ALARM);
        return {
            enabled: current.dailyHackEnabled,
            intervalMinutes: current.dailyHackIntervalMinutes,
            running: this.running,
            last: this.last,
            nextRunAt: this.nextRunAt,
            nextRunReason: this.nextRunReason,
            alarmAt: alarm?.scheduledTime ?? null,
            hasClaimedToday: this.state?.hasClaimedToday ?? null,
            nextTaskTime: this.state?.nextTaskTime ?? null,
        };
    }

    async enable(intervalMinutes?: number): Promise<SettingsV1> {
        const next = await this.deps.settings.update({
            dailyHackEnabled: true,
            ...(intervalMinutes !== undefined ? { dailyHackIntervalMinutes: intervalMinutes } : {}),
        });
        void this.runExclusive();
        return next;
    }

    async disable(): Promise<SettingsV1> {
        const next = await this.deps.settings.update({ dailyHackEnabled: false });
        await this.deps.scheduler.clear(AUTO_DAILY_HACK_ALARM);
        return next;
    }

    async hackNow(): Promise<Result<unknown, { readonly code: string; readonly message: string }>> {
        const result = await this.deps.adapter.solveHack();
        await this.deps.cache.clear();
        return result.ok ? ok(result.value) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    }

    async cancelHack(): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        const result = await this.deps.adapter.cancelHack();
        return result.ok ? ok(undefined) : { ok: false, error: { code: result.error.code, message: result.error.message } };
    }

    async runExclusive(): Promise<void> {
        try {
            const queued = await this.deps.networkOps.enqueue({ owner: 'daily', reason: 'daily-auto', priority: 55 }, async () => {
                await this.run();
                return ok(undefined);
            });
            if (!queued.ok) this.deps.logger.warn('daily-hack', 'Daily auto run did not start', { code: queued.error.code, message: queued.error.message });
        } finally {
            await this.scheduleNext();
        }
    }

    /**
     * Prefer the game's own next-task timestamp so Auto Daily wakes up exactly when
     * a new daily task is available instead of polling on a fixed interval.
     *
     * The previous fallback used the configured interval (4 hours by default). If
     * the status request failed during startup, or the task was still unclaimed
     * after a failed attempt, Auto Daily then slept for four hours while Overview
     * stayed idle. Retry promptly in those cases instead.
     */
    async scheduleNext(): Promise<void> {
        const current = await this.deps.settings.get();
        if (!current.dailyHackEnabled) {
            this.nextRunAt = null;
            this.nextRunReason = null;
            return;
        }
        const [raw, rewards] = await Promise.all([this.deps.adapter.getDailyOps(), this.deps.adapter.getRewards()]);
        if (!raw.ok) {
            this.deps.logger.warn('daily-hack', 'Daily status fetch failed before scheduling', {
                code: raw.error.code,
                message: raw.error.message,
            });
        }
        const state = raw.ok ? mapDailyOps(raw.value, rewards.ok ? rewards.value : []) : null;
        this.state = state;
        const now = this.deps.clock.now();
        await this.deps.scheduler.clear(AUTO_DAILY_HACK_ALARM);

        const decision = planNextDailyRun({
            now,
            state,
            intervalMinutes: current.dailyHackIntervalMinutes,
        });
        this.nextRunAt = decision.at;
        this.nextRunReason = decision.reason;
        this.deps.scheduler.create(AUTO_DAILY_HACK_ALARM, { when: decision.at });
        this.deps.logger.info('daily-hack', `Next daily auto run scheduled: ${new Date(decision.at).toLocaleString()} (${decision.reason})`, {
            at: decision.at,
            reason: decision.reason,
            hasClaimedToday: state?.hasClaimedToday ?? null,
            nextTaskTime: state?.nextTaskTime ?? null,
            intervalMinutes: current.dailyHackIntervalMinutes,
        });
        this.deps.events.publish('daily.auto.schedule', { nextRunAt: decision.at, reason: decision.reason });
    }

    private async run(): Promise<void> {
        if (this.running) return;
        const owner = `auto-daily:${crypto.randomUUID()}`;
        const lease = await this.deps.state.acquireLease('auto-daily', owner, 15 * 60_000);
        if (!lease) {
            this.deps.logger.info('daily-hack', 'Auto Daily skipped: lease held by another worker');
            return;
        }
        this.running = true;
        try {
            const current = await this.deps.settings.get();
            if (!current.dailyHackEnabled || current.helperMode) return;
            const before = await this.deps.adapter.getDailyOps();
            const rewards = await this.deps.adapter.getRewards();
            const stateBefore = before.ok ? mapDailyOps(before.value, rewards.ok ? rewards.value : []) : null;
            this.state = stateBefore;
            this.deps.logger.info('daily-hack', `Daily auto check: ${stateBefore ? (stateBefore.hasClaimedToday ? 'claimed' : 'unclaimed') : 'state unavailable'}${stateBefore?.nextTaskTime ? `, next task ${stateBefore.nextTaskTime}` : ''}`, {
                stateAvailable: stateBefore !== null,
                hasClaimedToday: stateBefore?.hasClaimedToday ?? null,
                nextTaskTime: stateBefore?.nextTaskTime ?? null,
                ...(before.ok ? {} : { code: before.error.code, message: before.error.message }),
            });
            if (stateBefore?.hasClaimedToday) {
                this.last = { at: this.deps.clock.now(), solved: false, puzzle: 'claimed', message: 'Already claimed today; waiting for next reset' };
                await this.deps.cache.persist(stateBefore);
                await this.deps.state.set('auto-daily', { phase: 'waiting', lastError: null, payload: { last: this.last } });
                this.deps.logger.info('daily-hack', 'Daily task already claimed; waiting for next reset');
                this.deps.events.publish('daily.auto.done', stateBefore);
                return;
            }
            const result = await this.deps.adapter.solveHack();
            if (result.ok && result.value && typeof result.value === 'object') {
                const value = result.value as { solved?: unknown; puzzle?: unknown; message?: unknown };
                this.last = {
                    at: this.deps.clock.now(),
                    solved: value.solved === true,
                    puzzle: typeof value.puzzle === 'string' ? value.puzzle : 'unknown',
                    message: typeof value.message === 'string' ? value.message : '',
                };
            } else {
                this.last = { at: this.deps.clock.now(), solved: false, puzzle: 'unknown', message: result.ok ? 'No result' : result.error.message };
            }
            this.deps.logger[this.last.solved ? 'info' : 'warn'](
                'daily-hack',
                `Daily auto run finished: ${this.last.solved ? 'solved' : 'not solved'} (${this.last.puzzle})${this.last.message ? ` — ${this.last.message}` : ''}`,
                {
                    solved: this.last.solved,
                    puzzle: this.last.puzzle,
                    message: this.last.message,
                },
            );
            const after = await this.deps.adapter.getDailyOps();
            const rewardsAfter = await this.deps.adapter.getRewards();
            const stateAfter = after.ok ? mapDailyOps(after.value, rewardsAfter.ok ? rewardsAfter.value : []) : null;
            this.state = stateAfter ?? this.state;
            if (stateAfter) await this.deps.cache.persist(stateAfter);
            await this.deps.state.set('auto-daily', {
                phase: this.last.solved ? 'done' : 'waiting',
                lastError: this.last.solved ? null : this.last.message,
                payload: { last: this.last },
            });
            this.deps.events.publish('daily.auto.done', stateAfter);
        } finally {
            this.running = false;
            await this.deps.state.releaseLease('auto-daily', owner);
        }
    }
}
