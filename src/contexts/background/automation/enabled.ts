import type { SettingsV1 } from '../../../contracts/storage.js';

/**
 * Auto Refresh only exists to keep the network snapshot warm for active
 * automation. It must not run when the user has every automation switched off.
 */
export function hasEnabledAutomation(settings: SettingsV1): boolean {
    return settings.autoJobsEnabled
        || settings.autoFinishEnabled
        || settings.autoDroneEnabled
        || settings.autoExpeditionEnabled
        || settings.mailAutoClaimEnabled
        || settings.dailyHackEnabled;
}
