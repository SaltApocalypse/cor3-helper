import { describe, expect, it } from 'vitest';
import { alarmRoutes, automationAlarmNames, clearAutomationAlarms } from './alarms.js';
import { AUTOMATION_ALARM_IDS } from './automation/alarm-ids.js';
import type { AutomationRuntime } from './composition/automation.js';
import type { AutomationLogger } from '../../application/automation/ports.js';

const logger: AutomationLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('alarm route table', () => {
    // Route construction only closes over the runtime; it does not call it.
    const automation = {} as AutomationRuntime;

    it('declares every automation alarm exactly once', () => {
        const routes = alarmRoutes(automation, logger);
        const names = automationAlarmNames(routes);
        expect(new Set(names).size).toBe(names.length);
        expect([...names].sort()).toEqual(Object.values(AUTOMATION_ALARM_IDS).sort());
    });

    it('derives the Helper Mode clear list from the route table', async () => {
        const routes = alarmRoutes(automation, logger);
        const cleared: string[] = [];
        const scheduler = {
            create: () => undefined,
            clear: async (alarm: string) => { cleared.push(alarm); },
            get: async () => null,
        };
        await clearAutomationAlarms(scheduler, routes);
        expect(cleared.sort()).toEqual(Object.values(AUTOMATION_ALARM_IDS).sort());
    });
});
