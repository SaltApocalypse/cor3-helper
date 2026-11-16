import type { SettingsV1 } from '../../../contracts/storage.js';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { FeatureAvailabilityStore } from '../../../infrastructure/storage/feature-availability-store.js';
import type { DroneAutoService } from '../../../application/drone/auto.js';
import { DRONE_EXPEDITION_PROFILE } from '../../../domains/expeditions/profiles.js';
import type { AutomationLogger, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import { AUTO_DRONE_ALARM, AUTO_DRONE_RETRY_ALARM } from './alarm-ids.js';

export interface AutoDroneLast {
    readonly at: number;
    readonly status: string;
    readonly message: string;
}

export interface AutoDroneDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly logger: AutomationLogger;
    readonly clock: { now(): number };
    readonly state: AutomationStateStore;
    readonly droneAuto: Pick<DroneAutoService, 'runOnce'>;
    readonly featureAvailability: FeatureAvailabilityStore;
    readonly runAutoMail: () => Promise<void>;
}

const AUTO_DRONE_ACTIVE_RETRY_MS = 60_000;
const AUTO_DRONE_MAINTENANCE_RETRY_MS = 30 * 60_000;

const TRANSIENT_DRONE_ERROR = /no game websocket|no cor3\.gg tab|not ready|socket|timed? ?out|timeout|connection|network|route|unreachable|not[-\s]?reachable|bridge|drone view/i;

/**
 * Startup and tab-switch races produce socket/bridge failures before the game
 * data is available. They are not actionable Auto Drone errors; retry them as
 * "waiting" instead of painting the Overview status red.
 */
export function isTransientDroneFailure(code: string, message: string): boolean {
    return /GAME_NO_SOCKET|GAME_TIMEOUT|BRIDGE_TIMEOUT|BRIDGE_TRANSPORT_ERROR|ENDPOINT_COMMAND_FAILED|GAME_SET_ENDPOINT_FAILED|NO_COR3_TAB/i.test(code)
        || TRANSIENT_DRONE_ERROR.test(message);
}

export class AutoDroneCoordinator {
    private running = false;
    private last: AutoDroneLast | null = null;
    private lastViewAt = 0;

    constructor(private readonly deps: AutoDroneDeps) {}

    isRunning(): boolean {
        return this.running;
    }

    lastRun(): AutoDroneLast | null {
        return this.last;
    }

    markViewSeen(): void {
        this.lastViewAt = Math.max(this.deps.clock.now(), this.last?.at ?? 0);
    }

    lastViewedAt(): number {
        return this.lastViewAt;
    }

    restore(payload: Readonly<Record<string, unknown>>): void {
        const stored = payload.last;
        if (!stored || typeof stored !== 'object') return;
        const entry = stored as { at?: unknown; status?: unknown; message?: unknown };
        if (typeof entry.at === 'number' && typeof entry.status === 'string' && typeof entry.message === 'string') {
            this.last = { at: entry.at, status: entry.status, message: entry.message };
            // A restarted worker should not flash an error from the previous
            // session before the drone panel has a chance to refresh.
            this.lastViewAt = Math.max(this.lastViewAt, entry.at);
        }
    }

    async status() {
        const current = await this.deps.settings.get();
        const availability = await this.deps.featureAvailability.get();
        return {
            enabled: current.autoDroneEnabled,
            intervalMinutes: current.autoDroneIntervalMinutes,
            running: this.running,
            available: availability.droneExpedition,
            dataStale: this.lastViewAt === 0 || this.deps.clock.now() - this.lastViewAt > 5 * 60_000,
            last: this.last,
        };
    }

    async enable(intervalMinutes?: number): Promise<SettingsV1> {
        const next = await this.deps.settings.update({
            autoDroneEnabled: true,
            ...(intervalMinutes !== undefined ? { autoDroneIntervalMinutes: intervalMinutes } : {}),
        });
        this.deps.scheduler.create(AUTO_DRONE_ALARM, { periodInMinutes: next.autoDroneIntervalMinutes });
        // Apply the switch immediately instead of waiting for the first alarm period.
        void this.run();
        return next;
    }

    async disable(): Promise<SettingsV1> {
        const next = await this.deps.settings.update({ autoDroneEnabled: false });
        await this.deps.scheduler.clear(AUTO_DRONE_ALARM);
        await this.deps.scheduler.clear(AUTO_DRONE_RETRY_ALARM);
        return next;
    }

    async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        const owner = `auto-drone:${crypto.randomUUID()}`;
        const lease = await this.deps.state.acquireLease('auto-drone', owner, 10 * 60_000);
        if (!lease) {
            this.running = false;
            this.deps.logger.info('auto-drone', 'Auto Drone skipped: lease held by another worker');
            return;
        }
        try {
            const current = await this.deps.settings.get();
            if (!current.autoDroneEnabled || current.helperMode) return;
            const storedState = await this.deps.state.get('auto-drone');
            const storedEvents = Array.isArray(storedState.payload.processedEventIds)
                ? storedState.payload.processedEventIds.filter((id): id is string => typeof id === 'string')
                : [];
            this.deps.logger.info('auto-drone', 'Auto Drone run started', {
                repairEnabled: current.droneRepairEnabled,
                repairThreshold: current.droneRepairThreshold,
                repairOnCharge: current.droneRepairOnCharge,
                decisionPolicy: current.droneDecisionPolicy,
                locationId: current.droneLocationId,
            });
            const result = await this.deps.droneAuto.runOnce({
                repairEnabled: current.droneRepairEnabled,
                repairThreshold: current.droneRepairThreshold,
                repairOnCharge: current.droneRepairOnCharge,
                decisionPolicy: current.droneDecisionPolicy,
                locationId: current.droneLocationId,
                goalId: current.droneGoalId,
                targetLocationConfigId: DRONE_EXPEDITION_PROFILE.locationConfigId,
                targetMissionConfigId: DRONE_EXPEDITION_PROFILE.missionConfigId,
                autoSendEnabled: current.droneAutoSendEnabled,
                processedEventIds: new Set(storedEvents),
            });
            const transient = !result.ok && isTransientDroneFailure(result.error.code, result.error.message);
            this.last = result.ok
                ? { at: this.deps.clock.now(), status: result.value.status, message: result.value.message }
                : { at: this.deps.clock.now(), status: transient ? 'waiting' : 'error', message: result.error.message };
            this.deps.logger[result.ok || transient ? 'info' : 'warn'](
                'auto-drone',
                `Auto Drone run finished: ${this.last.status} — ${this.last.message}`,
                { status: this.last.status, message: this.last.message },
            );
            const processedEvents = result.ok && result.value.eventId
                ? [...new Set([...storedEvents, result.value.eventId])].slice(-100)
                : storedEvents;
            const phase = result.ok
                ? (result.value.status === 'launched' || result.value.status === 'repaired'
                    || result.value.blockedReason === 'active-mission' || result.value.blockedReason === 'repairing'
                    ? 'running'
                    : result.value.status === 'blocked' ? 'blocked' : 'idle')
                : transient ? 'idle' : 'blocked';
            await this.deps.state.set('auto-drone', {
                phase,
                nextActionAt: null,
                lastError: result.ok || transient ? null : result.error.message,
                payload: {
                    processedEventIds: processedEvents,
                    last: this.last,
                    activeMissionId: result.ok ? result.value.missionId : null,
                },
            });
            if (result.ok && result.value.status === 'completed') void this.deps.runAutoMail();
            if (result.ok && result.value.status === 'insufficient-credits') {
                if (/repair/i.test(result.value.message)) {
                    await this.deps.settings.update({ droneRepairEnabled: false });
                    this.deps.logger.warn('auto-drone', 'Auto repair disabled after repair payment failure', { reason: result.value.message });
                } else {
                    await this.deps.settings.update({ autoDroneEnabled: false });
                    await this.deps.scheduler.clear(AUTO_DRONE_ALARM);
                    await this.deps.scheduler.clear(AUTO_DRONE_RETRY_ALARM);
                    this.deps.logger.warn('auto-drone', 'Auto Drone disabled after payment failure', { reason: result.value.message });
                }
            }
            if (result.ok && result.value.status === 'blocked' && /destroyed/i.test(result.value.message)) {
                await this.deps.settings.update({ autoDroneEnabled: false });
                await this.deps.scheduler.clear(AUTO_DRONE_ALARM);
                await this.deps.scheduler.clear(AUTO_DRONE_RETRY_ALARM);
                this.deps.logger.warn('auto-drone', 'Auto Drone disabled because the drone is destroyed', { reason: result.value.message });
            }
            if (result.ok && result.value.status === 'rate-limited') {
                this.deps.scheduler.create(AUTO_DRONE_RETRY_ALARM, { when: this.deps.clock.now() + (result.value.retryAfterMs ?? 60_000) });
            } else if (result.ok && (result.value.status === 'repaired' || result.value.blockedReason === 'repairing')) {
                // Maintenance takes a long time; use the reported remaining time
                // when available, otherwise check again in 30 minutes.
                const wait = Math.min(
                    result.value.retryAfterMs ?? AUTO_DRONE_MAINTENANCE_RETRY_MS,
                    AUTO_DRONE_MAINTENANCE_RETRY_MS,
                );
                this.deps.scheduler.create(AUTO_DRONE_RETRY_ALARM, { when: this.deps.clock.now() + Math.max(60_000, wait) });
            } else if (result.ok && (
                result.value.status === 'launched'
                || result.value.blockedReason === 'active-mission'
            )) {
                // Check back soon for in-flight decisions and completion.
                this.deps.scheduler.create(AUTO_DRONE_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_DRONE_ACTIVE_RETRY_MS });
            } else if (!result.ok && transient) {
                // Startup and transient socket failures are retried instead of
                // being left as a permanent red status.
                this.deps.scheduler.create(AUTO_DRONE_RETRY_ALARM, { when: this.deps.clock.now() + AUTO_DRONE_ACTIVE_RETRY_MS });
            }
        } finally {
            this.running = false;
            await this.deps.state.releaseLease('auto-drone', owner);
        }
    }
}
