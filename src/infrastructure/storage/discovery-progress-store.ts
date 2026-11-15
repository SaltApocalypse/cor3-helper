import { z } from 'zod';
import type { DiscoveryProgress, DiscoveryProgressStore } from '../../application/network/discovery.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const PROGRESS_KEY = 'v2.discovery.progress';
const SCHEMA_VERSION = 1;
const progressSchema = z.object({
    fingerprint: z.string(),
    scannedIps: z.array(z.string()),
    startedAt: z.number().int().nonnegative(),
}).strict();

export class ChromeStorageDiscoveryProgressStore implements DiscoveryProgressStore {
    private readonly repository: VersionedRepository<DiscoveryProgress>;

    constructor(area: StorageArea) {
        this.repository = new VersionedRepository({
            area,
            key: PROGRESS_KEY,
            schema: progressSchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = progressSchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    async get(): Promise<DiscoveryProgress | null> {
        return this.repository.get();
    }

    async set(progress: DiscoveryProgress): Promise<void> {
        await this.repository.set(progress);
    }

    async clear(): Promise<void> {
        await this.repository.clear();
    }
}
