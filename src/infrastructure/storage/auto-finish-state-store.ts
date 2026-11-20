import { autoFinishStateSchema, type AutoFinishState } from '../../contracts/auto-finish.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.auto-finish';
const SCHEMA_VERSION = 1;
const EMPTY_STATE: AutoFinishState = { last: null, completedResets: {}, completedJobs: {} };

export class AutoFinishStateStore {
    private readonly repository: VersionedRepository<AutoFinishState>;
    private writeQueue: Promise<unknown> = Promise.resolve();

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

    private enqueue<T>(run: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    private async read(): Promise<AutoFinishState> {
        return (await this.repository.get()) ?? EMPTY_STATE;
    }

    async get(): Promise<AutoFinishState> {
        // A read must see earlier queued writes, especially a single completion.
        await this.writeQueue.catch(() => undefined);
        return this.read();
    }

    async set(state: AutoFinishState): Promise<void> {
        await this.enqueue(() => this.repository.set(state));
    }
}
