import { autoFinishStateSchema, type AutoFinishState } from '../../contracts/auto-finish.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.auto-finish';
const SCHEMA_VERSION = 1;

export class AutoFinishStateStore {
    private readonly repository: VersionedRepository<AutoFinishState>;

    constructor(area: StorageArea, clock?: { now(): number }, logger?: { warn(scope: string, message: string, data?: unknown): void }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: autoFinishStateSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    async get(): Promise<AutoFinishState> {
        return (await this.repository.get()) ?? { last: null, completedResets: {}, completedJobs: {} };
    }

    async set(state: AutoFinishState): Promise<void> {
        await this.repository.set(state);
    }
}
