import { z } from 'zod';
import type { MailSourceTracker } from '../../application/mail/service.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.mail.sources';
const SCHEMA_VERSION = 1;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const schema = z.object({
    claimed: z.array(z.object({
        source: z.string(),
        sourceId: z.string(),
        at: z.number(),
    }).strict()),
}).strict();

type MailSourceState = z.infer<typeof schema>;

export class ChromeStorageMailSourceTracker implements MailSourceTracker {
    private readonly repository: VersionedRepository<MailSourceState>;
    private writeQueue: Promise<unknown> = Promise.resolve();

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

    async isClaimed(source: string, sourceId: string): Promise<boolean> {
        const state = (await this.repository.get()) ?? { claimed: [] };
        const now = Date.now();
        return state.claimed.some((entry) =>
            entry.source === source
            && entry.sourceId === sourceId
            && now - entry.at <= MAX_AGE_MS,
        );
    }

    async markClaimed(source: string, sourceId: string): Promise<void> {
        const run = async (): Promise<void> => {
            const state = (await this.repository.get()) ?? { claimed: [] };
            const now = Date.now();
            const fresh = state.claimed.filter((entry) => now - entry.at <= MAX_AGE_MS);
            if (fresh.some((entry) => entry.source === source && entry.sourceId === sourceId)) {
                await this.repository.set({ claimed: fresh.slice(-MAX_ENTRIES) });
                return;
            }
            await this.repository.set({
                claimed: [...fresh, { source, sourceId, at: now }].slice(-MAX_ENTRIES),
            });
        };
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }
}
