import { z } from 'zod';
import type { DroneState } from '../../domains/drone/model.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.droneDataCache';
const SCHEMA_VERSION = 1;

const droneSchema = z.object({
    id: z.string(),
    name: z.string(),
    durability: z.number(),
    maxDurability: z.number(),
    battery: z.number(),
    maxBattery: z.number(),
    repairing: z.boolean(),
    destroyed: z.boolean(),
}).strict();
const missionSchema = z.object({
    id: z.string(),
    name: z.string(),
    batteryCost: z.number(),
    locationConfigId: z.string(),
    locationName: z.string(),
    missionConfigId: z.string(),
    risk: z.number(),
    durationSeconds: z.number(),
}).strict();
const stateSchema = z.object({
    at: z.number(),
    value: z.object({
        drone: droneSchema.nullable(),
        battery: z.number(),
        maxBattery: z.number(),
        batteryRestoreSeconds: z.number().nullable().optional(),
        activeMissionId: z.string().nullable(),
        missions: z.array(missionSchema),
        archived: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    }).strict(),
}).strict();

type DroneCacheEntry = z.infer<typeof stateSchema>;

export interface DroneDataCachePort {
    get(): Promise<DroneState | null>;
    set(value: DroneState): Promise<void>;
}

export class DroneDataCacheStore implements DroneDataCachePort {
    private memory: DroneCacheEntry | null = null;
    private readonly repository: VersionedRepository<DroneCacheEntry>;

    constructor(area: StorageArea) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: stateSchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = stateSchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    async get(): Promise<DroneState | null> {
        // The persisted schema intentionally stores only the stable fields;
        // repairSecondsRemaining is a transient value, so the cast is safe.
        if (this.memory) return this.memory.value as DroneState;
        const stored = await this.repository.get();
        if (!stored) return null;
        this.memory = stored;
        return stored.value as DroneState;
    }

    async set(value: DroneState): Promise<void> {
        const entry = stateSchema.parse({ at: Date.now(), value });
        this.memory = entry;
        await this.repository.set(entry);
    }
}
