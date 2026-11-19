import type { CoreRuntime } from './composition/core.js';
import type { AutomationRuntime } from './composition/automation.js';
import { alarmRoutes } from './alarms.js';
import { AUTO_DRONE_ALARM, AUTO_EXPEDITION_ALARM, AUTO_JOBS_LEGACY_ALARM, AUTO_MAIL_ALARM, AUTO_REFRESH_ALARM } from './automation/alarm-ids.js';
import { hasEnabledAutomation } from './automation/enabled.js';

export async function restorePersistedState(core: CoreRuntime, automation: AutomationRuntime): Promise<void> {
    const [jobsState, droneState, expeditionState, mailState, dailyState] = await Promise.all([
        core.stores.automationState.get('auto-jobs'),
        core.stores.automationState.get('auto-drone'),
        core.stores.automationState.get('auto-expedition'),
        core.stores.automationState.get('auto-mail'),
        core.stores.automationState.get('auto-daily'),
    ]);
    automation.locks.restore(jobsState.payload);
    automation.drone.restore(droneState.payload);
    automation.expedition.restore(expeditionState);
    automation.mail.restore(mailState.payload);
    automation.daily.restore(dailyState.payload);
    await Promise.all([
        automation.autoFinish.restore(),
        automation.autoJobs.restore(),
        automation.jobStates.prune(),
    ]);
}

export async function applyHelperMode(core: CoreRuntime, automation: AutomationRuntime): Promise<boolean> {
    const current = await core.settings.get();
    // The old singular alarm id is not in the route table; clear it explicitly
    // so a profile upgraded from an earlier build cannot leave it behind.
    automation.scheduler.clear(AUTO_JOBS_LEGACY_ALARM);
    if (current.helperMode) {
        await Promise.all(alarmRoutes(automation, core.logger).map((route) => automation.scheduler.clear(route.alarm)));
    }
    return current.helperMode;
}

export async function startSchedulers(core: CoreRuntime, automation: AutomationRuntime, helperMode: boolean): Promise<void> {
    const current = await core.settings.get();
    void core.syncAutoSolvers(current);
    if (helperMode) return;
    void automation.autoJobs.scheduleNextRefresh();
    void automation.autoJobs.ensureInfo('startup');
    if (hasEnabledAutomation(current)) {
        automation.scheduler.create(AUTO_REFRESH_ALARM, { periodInMinutes: 5 });
    } else {
        void automation.scheduler.clear(AUTO_REFRESH_ALARM);
    }
    if (current.autoDroneEnabled) {
        automation.scheduler.create(AUTO_DRONE_ALARM, { periodInMinutes: current.autoDroneIntervalMinutes });
    }
    if (current.autoExpeditionEnabled) {
        automation.scheduler.create(AUTO_EXPEDITION_ALARM, { periodInMinutes: current.autoExpeditionIntervalMinutes });
        const last = automation.expedition.lastRun();
        if (!last || Date.now() - last.at > 60_000) {
            void automation.expedition.run();
        }
    }
    if (current.autoDroneEnabled) {
        const last = automation.drone.lastRun();
        if (!last || Date.now() - last.at > 60_000) {
            void automation.drone.run();
        }
    }
    if (current.mailAutoClaimEnabled) {
        automation.scheduler.create(AUTO_MAIL_ALARM, { periodInMinutes: 45 });
    }
    if (current.dailyHackEnabled) {
        void automation.daily.scheduleNext();
    }
}

export async function startBackground(core: CoreRuntime, automation: AutomationRuntime): Promise<void> {
    await restorePersistedState(core, automation);
    const helperMode = await applyHelperMode(core, automation);
    await startSchedulers(core, automation, helperMode);
    void automation.readiness.refreshFromTab();
}
