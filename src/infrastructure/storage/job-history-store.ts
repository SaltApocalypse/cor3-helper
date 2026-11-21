import { z } from 'zod';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.job.history';
const SCHEMA_VERSION = 1;
const MAX_ENTRIES = 500;
const schema = z.object({
    entries: z.array(z.object({
        jobId: z.string(),
        name: z.string(),
        type: z.string(),
        serverName: z.string().nullable(),
        marketKey: z.string().optional(),
        status: z.enum(['done', 'failed', 'retry']),
        at: z.number(),
        error: z.string().optional(),
    }).strict()),
}).strict();

export type JobHistoryEntry = z.infer<typeof schema>['entries'][number];

export class JobHistoryStore {
    private readonly repository: VersionedRepository<z.infer<typeof schema>>;

    constructor(area: StorageArea, clock?: { now(): number }, logger?: { warn(scope: string, message: string, data?: unknown): void }) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema,
            schemaVersion: SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    async list(): Promise<readonly JobHistoryEntry[]> {
        return ((await this.repository.get()) ?? { entries: [] }).entries;
    }

    async append(entries: readonly JobHistoryEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const current = (await this.repository.get()) ?? { entries: [] };
        await this.repository.set({ entries: [...current.entries, ...entries].slice(-MAX_ENTRIES) });
    }
}
