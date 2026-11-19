import type { SchedulerPort, AutomationLogger } from '../../application/automation/ports.js';
import type { AutomationRuntime } from './composition/automation.js';
import {
    AUTO_DAILY_HACK_ALARM,
    AUTO_DRONE_ALARM,
    AUTO_DRONE_RETRY_ALARM,
    AUTO_EXPEDITION_ALARM,
    AUTO_EXPEDITION_RETRY_ALARM,
    AUTO_FINISH_RETRY_ALARM,
    AUTO_JOBS_INFO_ALARM,
    AUTO_MAIL_ALARM,
    AUTO_MAIL_RETRY_ALARM,
    AUTO_REFRESH_ALARM,
} from './automation/alarm-ids.js';

export interface AlarmRoute {
    readonly id: string;
    readonly alarm: string;
    readonly scope: string;
    readonly run: () => Promise<void>;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Declarative alarm routing table. The Helper Mode clear list is derived from
 * this table, so a new automation cannot forget its alarm.
 */
export function alarmRoutes(automation: AutomationRuntime, logger: AutomationLogger): readonly AlarmRoute[] {
    return [
        {
            id: 'auto-jobs-info',
            alarm: AUTO_JOBS_INFO_ALARM,
            scope: 'auto-jobs',
            run: async () => {
                try {
                    await automation.autoJobs.ensureInfo('scheduled', true);
                } catch (error) {
                    logger.error('auto-jobs', 'Scheduled Auto Jobs cycle failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-finish-retry',
            alarm: AUTO_FINISH_RETRY_ALARM,
            scope: 'auto-finish',
            run: async () => {
                try {
                    const result = await automation.autoFinish.runExclusive('auto-finish-retry', false);
                    if (!result.ok) logger.warn('auto-finish', 'Auto Finish retry did not run', {
                        code: result.error?.code ?? 'AUTO_FINISH_FAILED',
                        message: result.error?.message ?? 'Auto Finish retry failed',
                    });
                } catch (error) {
                    logger.error('auto-finish', 'Auto Finish retry failed', {
                        message: errorText(error),
                        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
                    });
                }
            },
        },
        {
            id: 'auto-refresh',
            alarm: AUTO_REFRESH_ALARM,
            scope: 'auto-refresh',
            run: async () => {
                try {
                    const result = await automation.autoRefresh.runExclusive();
                    if (!result.ok) logger.warn('auto-refresh', 'Scheduled Auto Refresh did not run', { code: result.code, message: result.message });
                } catch (error) {
                    logger.error('auto-refresh', 'Scheduled Auto Refresh failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-drone',
            alarm: AUTO_DRONE_ALARM,
            scope: 'auto-drone',
            run: async () => {
                try {
                    await automation.drone.run();
                } catch (error) {
                    logger.error('auto-drone', 'Scheduled Auto Drone failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-drone-retry',
            alarm: AUTO_DRONE_RETRY_ALARM,
            scope: 'auto-drone',
            run: async () => {
                try {
                    await automation.drone.run();
                } catch (error) {
                    logger.error('auto-drone', 'Scheduled Auto Drone failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-expedition',
            alarm: AUTO_EXPEDITION_ALARM,
            scope: 'auto-expedition',
            run: async () => {
                try {
                    await automation.expedition.run();
                } catch (error) {
                    logger.error('auto-expedition', 'Scheduled Auto Expedition failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-expedition-retry',
            alarm: AUTO_EXPEDITION_RETRY_ALARM,
            scope: 'auto-expedition',
            run: async () => {
                try {
                    await automation.expedition.run();
                } catch (error) {
                    logger.error('auto-expedition', 'Scheduled Auto Expedition failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-mail',
            alarm: AUTO_MAIL_ALARM,
            scope: 'auto-mail',
            run: async () => {
                try {
                    await automation.mail.run();
                } catch (error) {
                    logger.error('auto-mail', 'Scheduled mailbox collect failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-mail-retry',
            alarm: AUTO_MAIL_RETRY_ALARM,
            scope: 'auto-mail',
            run: async () => {
                try {
                    await automation.mail.run();
                } catch (error) {
                    logger.error('auto-mail', 'Scheduled mailbox collect failed', { message: errorText(error) });
                }
            },
        },
        {
            id: 'auto-daily',
            alarm: AUTO_DAILY_HACK_ALARM,
            scope: 'daily-hack',
            run: async () => {
                try {
                    await automation.daily.runExclusive();
                } catch (error) {
                    logger.error('daily-hack', 'Scheduled Daily Hack failed', { message: errorText(error) });
                }
            },
        },
    ];
}

export function automationAlarmNames(routes: readonly AlarmRoute[]): readonly string[] {
    return routes.map((route) => route.alarm);
}

export async function clearAutomationAlarms(scheduler: SchedulerPort, routes: readonly AlarmRoute[]): Promise<void> {
    await Promise.all(routes.map((route) => scheduler.clear(route.alarm)));
}

export function registerAlarmRouter(automation: AutomationRuntime, logger: AutomationLogger): void {
    const routes = alarmRoutes(automation, logger);
    chrome.alarms.onAlarm.addListener((alarm) => {
        const route = routes.find((entry) => entry.alarm === alarm.name);
        if (!route) return;
        void route.run();
    });
}
