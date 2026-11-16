import type { Result } from '../../kernel/result.js';
import { ok } from '../../kernel/result.js';
import {
    bestDroneMission,
    canLaunch,
    chooseDroneEventOption,
    isDroneRateLimited,
    type DroneDecisionPolicy,
    type DroneMission,
} from '../../domains/drone/model.js';
import type { DroneService } from './service.js';

export interface DroneAutomationSettings {
    readonly repairEnabled: boolean;
    readonly repairThreshold: number;
    readonly repairOnCharge: boolean;
    readonly decisionPolicy: DroneDecisionPolicy;
    readonly locationId: string | null;
    readonly goalId: string | null;
    readonly targetLocationConfigId?: string | null;
    readonly targetMissionConfigId?: string | null;
    readonly autoSendEnabled: boolean;
    readonly processedEventIds?: ReadonlySet<string>;
}

export const DEFAULT_DRONE_AUTOMATION_SETTINGS: DroneAutomationSettings = {
    repairEnabled: false,
    repairThreshold: 60,
    repairOnCharge: false,
    decisionPolicy: 'off',
    locationId: null,
    goalId: null,
    targetLocationConfigId: null,
    targetMissionConfigId: null,
    autoSendEnabled: true,
};

export type DroneBlockedReason = 'no-drone' | 'destroyed' | 'repairing' | 'active-mission' | 'no-mission';

export interface DroneAutomationResult {
    readonly status: 'launched' | 'repaired' | 'idle' | 'blocked' | 'completed' | 'rate-limited' | 'insufficient-credits';
    readonly message: string;
    readonly missionId: string | null;
    readonly retryAfterMs?: number;
    readonly blockedReason?: DroneBlockedReason;
    readonly eventId?: string;
}

export class DroneAutoService {
    constructor(
        private readonly drone: DroneService,
        private readonly trace?: (message: string, data?: unknown) => void,
    ) {}

    async runOnce(settings: DroneAutomationSettings = DEFAULT_DRONE_AUTOMATION_SETTINGS): Promise<Result<DroneAutomationResult, { readonly code: string; readonly message: string }>> {
        const completed = await this.drone.completedMission();
        if (completed.ok && completed.value) {
            this.trace?.('Drone completed mission detected', { missionId: completed.value.missionId, loot: completed.value.lootCount });
            return ok({
                status: 'completed',
                message: `Mission ${completed.value.missionId} completed; loot is waiting in the mailbox`,
                missionId: completed.value.missionId,
            });
        }
        const event = await this.drone.latestEvent();
        this.trace?.('Drone event check', {
            hasEvent: event.ok ? event.value !== null : false,
            eventType: event.ok ? event.value?.type ?? null : null,
            eventId: event.ok ? event.value?.eventId ?? null : null,
            options: event.ok ? event.value?.options.length ?? 0 : 0,
            policy: settings.decisionPolicy,
        });
        if (event.ok && event.value && !settings.processedEventIds?.has(event.value.eventId)) {
            const option = chooseDroneEventOption(event.value, settings.decisionPolicy);
            this.trace?.('Drone event option selected', { eventId: event.value.eventId, option: option?.id ?? null, label: option?.label ?? null });
            if (option) {
                let missionId = event.value.missionId;
                if (!missionId) {
                    const view = await this.drone.view();
                    if (view.ok) missionId = view.value.activeMissionId ?? '';
                }
                const resolved = await this.drone.resolve(event.value.eventId, option.id, missionId || undefined);
                return resolved.ok
                    ? { ok: true, value: { status: 'launched', message: `Resolved ${event.value.type}: ${option.label}`, missionId: event.value.missionId, eventId: event.value.eventId } }
                    : { ok: false, error: resolved.error };
            }
        }
        const view = await this.drone.view();
        if (!view.ok) return view;
        const state = view.value;
        this.trace?.('Drone state', {
            hasDrone: state.drone !== null,
            durability: state.drone?.durability ?? null,
            battery: state.battery,
            activeMissionId: state.activeMissionId,
            missions: state.missions.length,
        });
        if (!state.drone) return ok({ status: 'blocked', message: 'No drone found', missionId: null, blockedReason: 'no-drone' });
        if (state.drone.destroyed) return ok({ status: 'blocked', message: 'Drone is destroyed', missionId: null, blockedReason: 'destroyed' });
        if (state.drone.repairing) return ok({
            status: 'blocked',
            message: 'Drone is under maintenance',
            missionId: null,
            blockedReason: 'repairing',
            ...(state.drone.repairSecondsRemaining !== null ? { retryAfterMs: state.drone.repairSecondsRemaining * 1000 } : {}),
        });
        if (state.activeMissionId) return ok({ status: 'blocked', message: 'A drone mission is already active', missionId: state.activeMissionId, blockedReason: 'active-mission' });

        if (settings.repairEnabled) {
            const threshold = Math.max(0, Math.min(100, settings.repairThreshold));
            const needsDurabilityRepair = state.drone.durability <= threshold;
            // The game does not expose a separate charging flag; charging and
            // idle are both non-mission states. `repairOnCharge` therefore
            // applies to any low-battery idle drone with missing durability.
            const needsLowBatteryRepair = settings.repairOnCharge
                && state.battery < 30
                && state.drone.durability < state.drone.maxDurability;
            if ((needsDurabilityRepair || needsLowBatteryRepair) && state.drone.durability < state.drone.maxDurability) {
                const repaired = await this.drone.repair(state.drone.maxDurability);
                if (repaired.ok) {
                    return ok({ status: 'repaired', message: `Repairing to ${state.drone.maxDurability}`, missionId: null });
                }
                if (/insufficient|not-enough|no-credits|credits/i.test(repaired.error.message)) {
                    return ok({ status: 'insufficient-credits', message: `Repair failed: ${repaired.error.message}`, missionId: null });
                }
                if (isDroneRateLimited(repaired.error.message)) {
                    return ok({ status: 'rate-limited', message: repaired.error.message, missionId: null, retryAfterMs: 60_000 });
                }
                return { ok: false, error: repaired.error };
            }
        }

        const targetLocation = settings.targetLocationConfigId ?? null;
        const targetMission = settings.targetMissionConfigId ?? null;
        let mission: DroneMission | null;
        if (targetLocation !== null || targetMission !== null) {
            mission = state.missions.find((entry) =>
                (targetLocation === null || entry.locationConfigId === targetLocation)
                && (targetMission === null || entry.missionConfigId === targetMission || entry.id === targetMission)) ?? null;
            if (!mission) {
                return ok({
                    status: 'blocked',
                    message: 'Configured drone mission is not available in the current game data',
                    missionId: null,
                    blockedReason: 'no-mission',
                });
            }
            if (!canLaunch(state, mission)) {
                return ok({
                    status: 'blocked',
                    message: 'Configured drone mission is not launchable (battery or drone state)',
                    missionId: mission.id,
                    blockedReason: 'no-mission',
                });
            }
        } else {
            mission = bestDroneMission(state, settings.locationId, settings.goalId);
        }
        if (!mission) return ok({ status: 'idle', message: 'No launchable mission', missionId: null, blockedReason: 'no-mission' });
        const launched = await this.drone.launch(mission.locationConfigId, mission.missionConfigId);
        if (launched.ok) return ok({ status: 'launched', message: `Launched ${mission.name}`, missionId: mission.id });
        if (isDroneRateLimited(launched.error.message)) {
            return ok({ status: 'rate-limited', message: launched.error.message, missionId: null, retryAfterMs: 60_000 });
        }
        return { ok: false, error: launched.error };
    }
}
