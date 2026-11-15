import { z } from 'zod';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.featureAvailability';
const SCHEMA_VERSION = 1;

const featureAvailabilitySchema = z.object({
    mercenaryExpedition: z.boolean(),
    droneExpedition: z.boolean(),
    stashExpansion: z.boolean().default(true),
    updatedAt: z.number(),
}).strict();

export interface FeatureAvailability {
    readonly mercenaryExpedition: boolean;
    readonly droneExpedition: boolean;
    readonly stashExpansion: boolean;
    readonly updatedAt: number;
}

const DEFAULTS: FeatureAvailability = {
    mercenaryExpedition: true,
    droneExpedition: true,
    stashExpansion: true,
    updatedAt: 0,
};

/**
 * Long-lived feature availability cache. It prevents the UI from locking all
 * controls during a cold start before game data has loaded. Only a successful
 * data read is allowed to flip a feature to unavailable.
 */
export class FeatureAvailabilityStore {
    private memory: FeatureAvailability | null = null;
    private readonly repository: VersionedRepository<FeatureAvailability>;

    constructor(area: StorageArea) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: featureAvailabilitySchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = featureAvailabilitySchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    async get(): Promise<FeatureAvailability> {
        if (this.memory) return this.memory;
        this.memory = (await this.repository.get()) ?? DEFAULTS;
        return this.memory;
    }

    async set(patch: Partial<Omit<FeatureAvailability, 'updatedAt'>>): Promise<FeatureAvailability> {
        const current = await this.get();
        const changed = Object.entries(patch).some(([key, value]) => current[key as keyof FeatureAvailability] !== value);
        if (!changed) return current;
        const next: FeatureAvailability = {
            ...current,
            ...patch,
            updatedAt: Date.now(),
        };
        this.memory = next;
        await this.repository.set(next);
        return next;
    }
}
