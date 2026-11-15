import type { NetworkDiagnostics } from '../../../application/popup/portal.js';
import type { DailyOpsState } from '../../../domains/daily-ops/model.js';
import type { SpecialistState } from '../../../domains/specialists/model.js';

/**
 * Pure automation status helpers for the side panel (H8 phase 7).
 */

export interface AutomationRunFlags {
    readonly autoJobsRunning?: boolean | undefined;
    readonly autoFinishRunning?: boolean | undefined;
    readonly jobRunActive?: boolean | undefined;
    readonly autoDailyRunning?: boolean | undefined;
    readonly autoDroneRunning?: boolean | undefined;
    readonly autoExpeditionRunning?: boolean | undefined;
    readonly autoMailRunning?: boolean | undefined;
    readonly valuableActive?: boolean | undefined;
}

/** True while any automation stream is producing live debug output. */
export function isAutomationDebugLive(flags: AutomationRunFlags): boolean {
    return (flags.autoJobsRunning ?? false)
        || (flags.autoFinishRunning ?? false)
        || (flags.jobRunActive ?? false)
        || (flags.autoDailyRunning ?? false)
        || (flags.autoDroneRunning ?? false)
        || (flags.autoExpeditionRunning ?? false)
        || (flags.autoMailRunning ?? false)
        || (flags.valuableActive ?? false);
}

/** True when the overview has at least one countdown to display. */
export function hasOverviewTimerData(input: {
    readonly daily: DailyOpsState | null;
    readonly specialists: SpecialistState | null;
    readonly networkDiag: NetworkDiagnostics | null;
}): boolean {
    return Boolean(input.daily?.nextTaskTime)
        || Boolean(input.specialists?.expansions[0]?.expiresAt)
        || Boolean(input.networkDiag?.maintenance.length);
}
