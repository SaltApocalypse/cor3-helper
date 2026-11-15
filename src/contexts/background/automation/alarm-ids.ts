/**
 * Single source of truth for automation alarm names.
 *
 * The alarm route table (`../alarms.ts`) maps every id to its handler and
 * derives the Helper Mode clear list from that table, so adding an automation
 * cannot forget to suppress its alarm.
 */
export const AUTO_JOBS_INFO_ALARM = 'v2-auto-jobs-info';
export const AUTO_JOBS_LEGACY_ALARM = 'v2-auto-jobs';
export const AUTO_FINISH_RETRY_ALARM = 'v2-auto-finish-retry';
export const AUTO_REFRESH_ALARM = 'v2-auto-refresh';
export const AUTO_DRONE_ALARM = 'v2-auto-drone';
export const AUTO_DRONE_RETRY_ALARM = 'v2-auto-drone-retry';
export const AUTO_EXPEDITION_ALARM = 'v2-auto-expedition';
export const AUTO_EXPEDITION_RETRY_ALARM = 'v2-auto-expedition-retry';
export const AUTO_MAIL_ALARM = 'v2-auto-mail';
export const AUTO_MAIL_RETRY_ALARM = 'v2-auto-mail-retry';
export const AUTO_DAILY_HACK_ALARM = 'v2-auto-daily-hack';

export const AUTOMATION_ALARM_IDS = {
    autoJobsInfo: AUTO_JOBS_INFO_ALARM,
    autoFinishRetry: AUTO_FINISH_RETRY_ALARM,
    autoRefresh: AUTO_REFRESH_ALARM,
    autoDrone: AUTO_DRONE_ALARM,
    autoDroneRetry: AUTO_DRONE_RETRY_ALARM,
    autoExpedition: AUTO_EXPEDITION_ALARM,
    autoExpeditionRetry: AUTO_EXPEDITION_RETRY_ALARM,
    autoMail: AUTO_MAIL_ALARM,
    autoMailRetry: AUTO_MAIL_RETRY_ALARM,
    autoDailyHack: AUTO_DAILY_HACK_ALARM,
} as const;

export type AutomationAlarmId = typeof AUTOMATION_ALARM_IDS[keyof typeof AUTOMATION_ALARM_IDS];
