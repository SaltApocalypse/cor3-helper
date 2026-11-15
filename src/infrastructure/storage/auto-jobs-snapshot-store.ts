import { z } from 'zod';
import { autoJobsSnapshotSchema, type AutoJobsSnapshot } from '../../contracts/auto-jobs.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.auto-jobs.snapshot';
const SCHEMA_VERSION = 1;
type StoredAutoJobsSnapshot = z.infer<typeof autoJobsSnapshotSchema>;

export class AutoJobsSnapshotStore {
    private readonly repository: VersionedRepository<StoredAutoJobsSnapshot>;

    constructor(area: StorageArea, clock?: { now(): number }, logger?: { warn(scope: string, message: string, data?: unknown): void }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: autoJobsSnapshotSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    async get(): Promise<AutoJobsSnapshot | null> {
        return await this.repository.get() as AutoJobsSnapshot | null;
    }

    async set(snapshot: AutoJobsSnapshot): Promise<void> {
        await this.repository.set(snapshot as StoredAutoJobsSnapshot);
    }
}
