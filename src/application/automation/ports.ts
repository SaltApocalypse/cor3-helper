import type { SettingsPatch, SettingsV1 } from '../../contracts/storage.js';
import type { Clock } from '../../kernel/clock.js';

/** Re-exported so coordinators can depend on the kernel clock abstraction. */
export type AutomationClock = Clock;

export interface SettingsPort {
    get(): Promise<SettingsV1>;
    update(patch: SettingsPatch): Promise<SettingsV1>;
}

export type AlarmTiming =
    | { readonly when: number }
    | { readonly periodInMinutes: number }
    | { readonly delayInMinutes: number; readonly periodInMinutes: number };

/**
 * Alarm scheduling is injected so automation coordinators can be unit tested
 * without a Chrome runtime. The background context implements it over the
 * browser alarms API; behavior (create/clear/get timing) is unchanged.
 */
export interface SchedulerPort {
    create(alarm: string, timing: AlarmTiming): void;
    clear(alarm: string): Promise<void>;
    get(alarm: string): Promise<{ readonly scheduledTime?: number } | null>;
}

/** Domain event fan-out. The background adapter writes to `v2-events` ports. */
export interface EventPublisher {
    publish(type: string, payload?: unknown): void;
}

export interface AutomationLogger {
    debug(scope: string, message: string, data?: unknown): void;
    info(scope: string, message: string, data?: unknown): void;
    warn(scope: string, message: string, data?: unknown): void;
    error(scope: string, message: string, data?: unknown): void;
}

export type RunLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RunLogSink {
    add(runId: string, level: RunLogLevel, scope: string, message: string, data?: unknown): void;
}
