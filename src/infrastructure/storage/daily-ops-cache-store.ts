import { z } from 'zod';
import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.dailyOpsCache';
const SCHEMA_VERSION = 1;

const dailyOpsCacheSchema = z.object({
    at: z.number(),
    value: z.object({
        hasClaimedToday: z.boolean(),
        currentStreak: z.number(),
        difficulty: z.string(),
        nextTaskTime: z.string().nullable(),
        streakBonus: z.number().nullable(),
    }).strict(),
}).strict();

export interface DailyOpsCacheEntry {
    readonly at: number;
    readonly value: DailyOpsState;
}

export class DailyOpsCacheStore {
    private readonly repository: VersionedRepository<DailyOpsCacheEntry>;

    constructor(area: StorageArea) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: dailyOpsCacheSchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = dailyOpsCacheSchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    async get(): Promise<DailyOpsCacheEntry | null> {
        return this.repository.get();
    }

    async set(value: DailyOpsState): Promise<void> {
        await this.repository.set({ at: Date.now(), value });
    }

    async clear(): Promise<void> {
        await this.repository.clear();
    }
}
