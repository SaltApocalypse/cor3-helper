import type { JobStateKey, JobStateRecord } from '../../contracts/job-state.js';

export interface JobStatePruneOptions {
    readonly now?: number;
    readonly maxAgeMs?: number;
}

/** Persistence port for local job lifecycle records. */
export interface JobStateStorePort {
    get(key: JobStateKey): Promise<JobStateRecord | null>;
    list(): Promise<readonly JobStateRecord[]>;
    upsert(record: JobStateRecord): Promise<void>;
    prune(options?: JobStatePruneOptions): Promise<number>;
}
