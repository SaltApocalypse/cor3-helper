import { z } from 'zod';
import {
    isCompletionUncertainRecord,
    jobStateRecordSchema,
    jobStateKeyId,
    normalizeJobStateRecord,
    type JobLifecycleStatus,
    type JobStateKey,
    type JobStateRecord,
} from '../../contracts/job-state.js';
import type {
    JobStateListResult,
    JobStatePruneOptions,
    JobStateRecordReadResult,
    JobStateShardHealth,
    JobStateStorePort,
} from '../../application/auto-job/job-state-port.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY_PREFIX = 'v2.job.state';
const SCHEMA_VERSION = 1;
/**
 * Records are split across fixed shards so a write only rewrites one bounded
 * object. Writes to different shards never merge into one storage value.
 */
const SHARD_COUNT = 8;
export const DEFAULT_JOB_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A taken/in-flight record may still be needed for recovery; never age it out. */
export const RECOVERABLE_JOB_STATUSES: ReadonlySet<JobLifecycleStatus> = new Set([
    'taking',
    'taken',
    'executing',
    'waiting-minigame',
    'ready-to-claim',
    'claiming',
]);

const shardSchema = z.object({
    records: z.record(z.string(), jobStateRecordSchema),
}).strict();

type JobStateShard = z.infer<typeof shardSchema>;

function bucketOf(id: string): number {
    // FNV-1a over the stable job identity. The exact distribution is not
    // important; only determinism and a small bounded shard size are.
    let hash = 0x811c9dc5;
    for (let index = 0; index < id.length; index++) {
        hash ^= id.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % SHARD_COUNT;
}

function emptyShard(): JobStateShard {
    return { records: {} };
}

/**
 * Durable lifecycle records for Auto Jobs. Each shard is an independent
 * versioned storage entry, and every read-modify-write is serialized per shard
 * so two jobs in different shards cannot clobber each other's records.
 */
export class JobStateStore implements JobStateStorePort {
    private readonly repositories: VersionedRepository<JobStateShard>[];
    private readonly memory: Array<JobStateShard | null>;
    private readonly memoryStatus: Array<'ok' | 'missing' | null>;
    private readonly queues: Array<Promise<unknown>>;
    private readonly now: () => number;

    constructor(
        area: StorageArea,
        clock?: { now(): number },
        logger?: { warn(scope: string, message: string, data?: unknown): void },
    ) {
        this.now = clock?.now ?? (() => Date.now());
        this.repositories = Array.from({ length: SHARD_COUNT }, (_, index) => new VersionedRepository({
            area,
            key: `${KEY_PREFIX}.${index}`,
            schema: shardSchema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        }));
        this.memory = Array.from({ length: SHARD_COUNT }, () => null);
        this.memoryStatus = Array.from({ length: SHARD_COUNT }, () => null);
        this.queues = Array.from({ length: SHARD_COUNT }, () => Promise.resolve());
    }

    private enqueue<T>(bucket: number, run: () => Promise<T>): Promise<T> {
        const next = this.queues[bucket]!.then(run, run);
        this.queues[bucket] = next.then(() => undefined, () => undefined);
        return next;
    }

    private cache(bucket: number, shard: JobStateShard, status: 'ok' | 'missing'): void {
        this.memory[bucket] = shard;
        this.memoryStatus[bucket] = status;
    }

    /**
     * Read one shard with health. Successful reads (including a genuinely
     * missing key) are cached; corrupt/unavailable results are never cached as
     * an empty shard so a later health read cannot mistake damage for absence.
     */
    private async readShard(bucket: number): Promise<
        | { readonly status: 'ok'; readonly shard: JobStateShard }
        | { readonly status: 'missing'; readonly shard: JobStateShard }
        | { readonly status: 'corrupt'; readonly error?: string }
        | { readonly status: 'unavailable'; readonly error?: string }
    > {
        const cached = this.memory[bucket];
        if (cached) {
            return this.memoryStatus[bucket] === 'missing'
                ? { status: 'missing', shard: cached }
                : { status: 'ok', shard: cached };
        }
        const result = await this.repositories[bucket]!.read();
        if (result.status === 'ok') {
            this.cache(bucket, result.value, 'ok');
            return { status: 'ok', shard: result.value };
        }
        if (result.status === 'missing') {
            const shard = emptyShard();
            this.cache(bucket, shard, 'missing');
            return { status: 'missing', shard };
        }
        return result.error === undefined
            ? { status: result.status }
            : { status: result.status, error: result.error };
    }

    private async load(bucket: number): Promise<JobStateShard> {
        const cached = this.memory[bucket];
        if (cached) return cached;
        const result = await this.repositories[bucket]!.read();
        if (result.status === 'ok') {
            this.cache(bucket, result.value, 'ok');
            return result.value;
        }
        if (result.status === 'missing') {
            const shard = emptyShard();
            this.cache(bucket, shard, 'missing');
            return shard;
        }
        if (result.status === 'unavailable') {
            throw new Error(result.error ?? 'Job state storage unavailable');
        }
        // Preserve the legacy list()/get() view of a corrupt shard as empty,
        // but do not cache it: health reads must still see the corruption.
        return emptyShard();
    }

    private async settled(bucket: number): Promise<void> {
        await this.queues[bucket]!.catch(() => undefined);
    }

    async get(key: JobStateKey): Promise<JobStateRecord | null> {
        const id = jobStateKeyId(key);
        const bucket = bucketOf(id);
        await this.settled(bucket);
        const shard = await this.load(bucket);
        const record = shard.records[id];
        return record ? normalizeJobStateRecord(record) : null;
    }

    async getWithHealth(key: JobStateKey): Promise<JobStateRecordReadResult> {
        const id = jobStateKeyId(key);
        const bucket = bucketOf(id);
        await this.settled(bucket);
        const shard = await this.readShard(bucket);
        if (shard.status === 'corrupt' || shard.status === 'unavailable') {
            return shard.error === undefined
                ? { status: shard.status }
                : { status: shard.status, error: shard.error };
        }
        const record = shard.shard.records[id];
        return record ? { status: 'ok', record: normalizeJobStateRecord(record) } : { status: 'missing' };
    }

    async list(): Promise<readonly JobStateRecord[]> {
        await Promise.all(this.queues.map((queue) => queue.catch(() => undefined)));
        const shards = await Promise.all(this.memory.map((cached, index) => cached ?? this.load(index)));
        return shards.flatMap((shard) => Object.values(shard.records).map(normalizeJobStateRecord));
    }

    async listWithHealth(): Promise<JobStateListResult> {
        await Promise.all(this.queues.map((queue) => queue.catch(() => undefined)));
        const shards = await Promise.all(this.memory.map((_, index) => this.readShard(index)));
        const records: JobStateRecord[] = [];
        const shardResults: JobStateShardHealth[] = [];
        let readable = 0;
        for (let index = 0; index < shards.length; index++) {
            const result = shards[index]!;
            if (result.status === 'ok' || result.status === 'missing') {
                readable += 1;
                records.push(...Object.values(result.shard.records).map(normalizeJobStateRecord));
                shardResults.push({ shardIndex: index, status: result.status });
                continue;
            }
            shardResults.push(result.error === undefined
                ? { shardIndex: index, status: result.status }
                : { shardIndex: index, status: result.status, error: result.error });
        }
        const status = readable === SHARD_COUNT ? 'loaded' : readable > 0 ? 'partial' : 'unavailable';
        return { records, status, shardResults };
    }

    async upsert(record: JobStateRecord): Promise<void> {
        const normalized = normalizeJobStateRecord(jobStateRecordSchema.parse(record));
        const id = jobStateKeyId(normalized);
        const bucket = bucketOf(id);
        await this.enqueue(bucket, async () => {
            const shard = await this.load(bucket);
            shard.records[id] = normalized;
            await this.repositories[bucket]!.set(shard);
            this.cache(bucket, shard, 'ok');
        });
    }

    /**
     * Removes aged terminal/observational records. In-flight statuses are kept
     * indefinitely because they may still be the only local hint that a job
     * was taken before the worker or browser stopped.
     */
    async prune(options: JobStatePruneOptions = {}): Promise<number> {
        const now = options.now ?? this.now();
        const maxAgeMs = options.maxAgeMs ?? DEFAULT_JOB_STATE_MAX_AGE_MS;
        const removed = await Promise.all(this.repositories.map((_, bucket) => this.enqueue(bucket, async () => {
            const shard = await this.load(bucket);
            let count = 0;
            for (const [id, record] of Object.entries(shard.records)) {
                if (RECOVERABLE_JOB_STATUSES.has(record.status)) continue;
                // An unresolved Complete Unknown is a durable barrier, not an
                // ordinary aged observation. Keep it until an explicit
                // completion/terminal path (or an explicit clear) resolves it.
                if (isCompletionUncertainRecord(record)) continue;
                const updatedAt = Date.parse(record.updatedAt);
                if (Number.isFinite(updatedAt) && now - updatedAt <= maxAgeMs) continue;
                delete shard.records[id];
                count += 1;
            }
            if (count > 0) {
                await this.repositories[bucket]!.set(shard);
                this.cache(bucket, shard, 'ok');
            }
            return count;
        })));
        return removed.reduce((sum, count) => sum + count, 0);
    }

    async clear(): Promise<void> {
        await Promise.all(this.repositories.map((repository, bucket) => this.enqueue(bucket, async () => {
            await repository.clear();
            this.cache(bucket, emptyShard(), 'missing');
        })));
    }
}
