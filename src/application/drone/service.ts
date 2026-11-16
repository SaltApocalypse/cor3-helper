import type { Result } from '../../kernel/result.js';
import { err, ok } from '../../kernel/result.js';
import type { DroneCompletedMission, DroneMissionEvent, DroneState } from '../../domains/drone/model.js';
import { mapDroneCompleted, mapDroneEvent, mapDroneState } from './map.js';

export interface DronePort {
    getOptions(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getArchived(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getLatestEvent(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    getCompleted(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    launch(locationConfigId: string, missionConfigId: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    resolve(eventId: string, optionId: string, missionId?: string): Promise<Result<void, { readonly code: string; readonly message: string }>>;
    repair(targetDurability: number): Promise<Result<void, { readonly code: string; readonly message: string }>>;
}

export interface DroneViewCache {
    get(): Promise<DroneState | null>;
    set(value: DroneState): Promise<void>;
}

export class DroneService {
    constructor(
        private readonly drone: DronePort,
        private readonly cache?: DroneViewCache,
    ) {}

    async view(): Promise<Result<DroneState, { readonly code: string; readonly message: string }>> {
        const options = await this.drone.getOptions();
        if (!options.ok) {
            const cached = await this.cache?.get();
            return cached ? ok(cached) : options;
        }
        const archived = await this.drone.getArchived();
        const state = mapDroneState(options.value, archived.ok ? archived.value : {});
        if (!state) {
            const cached = await this.cache?.get();
            return cached ? ok(cached) : err({ code: 'DRONE_INVALID', message: 'Drone payload failed schema validation' });
        }
        if (state.drone) {
            try { await this.cache?.set(state); } catch { /* cache is best effort */ }
        }
        return ok(state);
    }

    async latestEvent(): Promise<Result<DroneMissionEvent | null, { readonly code: string; readonly message: string }>> {
        const raw = await this.drone.getLatestEvent();
        return raw.ok ? ok(mapDroneEvent(raw.value)) : raw;
    }

    async completedMission(): Promise<Result<DroneCompletedMission | null, { readonly code: string; readonly message: string }>> {
        const raw = await this.drone.getCompleted();
        return raw.ok ? ok(mapDroneCompleted(raw.value)) : raw;
    }

    async launch(locationConfigId: string, missionConfigId: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.drone.launch(locationConfigId, missionConfigId);
    }

    async repair(targetDurability: number): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.drone.repair(targetDurability);
    }

    async resolve(eventId: string, optionId: string, missionId?: string): Promise<Result<void, { readonly code: string; readonly message: string }>> {
        return this.drone.resolve(eventId, optionId, missionId);
    }
}
