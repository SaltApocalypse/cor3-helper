import type { AlarmTiming, SchedulerPort } from '../../../application/automation/ports.js';

/** The only place automation coordinators touch `chrome.alarms`. */
export class ChromeScheduler implements SchedulerPort {
    create(alarm: string, timing: AlarmTiming): void {
        chrome.alarms.create(alarm, timing as chrome.alarms.AlarmCreateInfo);
    }

    async clear(alarm: string): Promise<void> {
        await chrome.alarms.clear(alarm);
    }

    async get(alarm: string): Promise<{ readonly scheduledTime?: number } | null> {
        const found = await chrome.alarms.get(alarm);
        if (!found) return null;
        return typeof found.scheduledTime === 'number' ? { scheduledTime: found.scheduledTime } : {};
    }
}
