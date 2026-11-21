import type { JobStateKey, JobStateRecord } from '../../contracts/job-state.js';

export interface JobStatePruneOptions {
    readonly now?: number;
    readonly maxAgeMs?: number;
}

/** Health-aware read of one stored record. */
export type JobStateRecordReadResult =
    | { readonly status: 'ok'; readonly record: JobStateRecord }
    | { readonly status: 'missing' }
    | { readonly status: 'corrupt'; readonly error?: string }
    | { readonly status: 'unavailable'; readonly error?: string };

export interface JobStateShardHealth {
    readonly shardIndex: number;
    readonly status: 'ok' | 'missing' | 'corrupt' | 'unavailable';
    readonly error?: string;
}

/**
 * A list read is only `loaded` when every shard could be confirmed. `partial`
 * retains the records from readable shards but must never be treated as proof
 * that no unconfirmed completion exists.
 */
export interface JobStateListResult {
    readonly records: readonly JobStateRecord[];
    readonly status: 'loaded' | 'partial' | 'unavailable';
    readonly shardResults: readonly JobStateShardHealth[];
}

/** Persistence port for local job lifecycle records. */
export interface JobStateStorePort {
    get(key: JobStateKey): Promise<JobStateRecord | null>;
    list(): Promise<readonly JobStateRecord[]>;
    upsert(record: JobStateRecord): Promise<void>;
    prune(options?: JobStatePruneOptions): Promise<number>;
    /** Health-aware variants; implementations used by critical barriers provide them. */
    getWithHealth?(key: JobStateKey): Promise<JobStateRecordReadResult>;
    listWithHealth?(): Promise<JobStateListResult>;
}
