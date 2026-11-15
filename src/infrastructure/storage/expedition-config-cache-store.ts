import { z } from 'zod';
import type { ExpeditionLocation } from '../../domains/expeditions/model.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.expeditionConfigCache';
const SCHEMA_VERSION = 1;

const goalSchema = z.object({ id: z.string(), name: z.string() }).strict();
const zoneSchema = z.object({ id: z.string(), name: z.string(), goals: z.array(goalSchema) }).strict();
const locationSchema = z.object({ id: z.string(), name: z.string(), zones: z.array(zoneSchema) }).strict();
const entrySchema = z.object({
    at: z.number(),
    locations: z.array(locationSchema),
}).strict();
const cacheSchema = z.record(z.string(), entrySchema);

type ExpeditionConfigCache = z.infer<typeof cacheSchema>;

export class ExpeditionConfigCacheStore {
    private memory: ExpeditionConfigCache | null = null;
    private readonly repository: VersionedRepository<ExpeditionConfigCache>;

    constructor(area: StorageArea) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: cacheSchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = cacheSchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    private async load(): Promise<ExpeditionConfigCache> {
        if (this.memory) return this.memory;
        this.memory = (await this.repository.get()) ?? {};
        return this.memory;
    }

    async get(marketKey: string): Promise<readonly ExpeditionLocation[] | null> {
        const cache = await this.load();
        const entry = cache[marketKey];
        return entry && entry.locations.length > 0 ? entry.locations : null;
    }

    async set(marketKey: string, locations: readonly ExpeditionLocation[]): Promise<void> {
        if (locations.length === 0) return;
        const cache = await this.load();
        cache[marketKey] = {
            at: Date.now(),
            locations: locations.map((location) => ({
                id: location.id,
                name: location.name,
                zones: location.zones.map((zone) => ({
                    id: zone.id,
                    name: zone.name,
                    goals: zone.goals.map((goal) => ({ id: goal.id, name: goal.name })),
                })),
            })),
        };
        await this.repository.set(cache);
    }
}
