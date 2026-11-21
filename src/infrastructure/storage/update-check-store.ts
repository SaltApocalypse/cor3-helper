import type { StorageReadResult } from '../../contracts/storage-health.js';
import { updateCheckResultSchema, type UpdateCheckResult } from '../../contracts/update-check.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.updateCheck';
const SCHEMA_VERSION = 1;

/**
 * Independent cache for update-check results. It deliberately lives outside
 * SettingsV1 so settings import/export/reset cannot destroy update state.
 */
export class UpdateCheckStore {
    private readonly repository: VersionedRepository<UpdateCheckResult>;

    constructor(area: StorageArea, clock?: { now(): number }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: updateCheckResultSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
        });
    }

    /** Health-aware read for callers that must distinguish missing/corrupt. */
    async read(): Promise<StorageReadResult<UpdateCheckResult>> {
        return this.repository.read();
    }

    /** Throws on storage failure so the service can return a structured error. */
    async save(result: UpdateCheckResult): Promise<void> {
        await this.repository.set(result);
    }

    async clear(): Promise<void> {
        await this.repository.clear();
    }
}
