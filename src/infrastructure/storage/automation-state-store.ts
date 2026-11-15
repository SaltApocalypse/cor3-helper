import { z } from 'zod';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.automationState';
const SCHEMA_VERSION = 1;

export const AUTOMATION_PHASES = [
    'idle',
    'preparing',
    'running',
    'waiting',
    'blocked',
    'done',
] as const;

export type AutomationPhase = typeof AUTOMATION_PHASES[number];

export const automationStateSchema = z.object({
    phase: z.enum(AUTOMATION_PHASES).default('idle'),
    runId: z.string().nullable().default(null),
    startedAt: z.number().default(0),
    updatedAt: z.number().default(0),
    nextActionAt: z.number().nullable().default(null),
    attempts: z.number().int().nonnegative().default(0),
    lastError: z.string().nullable().default(null),
    payload: z.record(z.string(), z.unknown()).default({}),
    leaseOwner: z.string().nullable().default(null),
    leaseExpiresAt: z.number().nullable().default(null),
}).strict();

export type AutomationState = z.infer<typeof automationStateSchema>;
export type AutomationStatePatch = Partial<Omit<AutomationState, 'updatedAt'>>;

const cacheSchema = z.record(z.string(), automationStateSchema);

type AutomationCache = z.infer<typeof cacheSchema>;
const EMPTY: AutomationState = automationStateSchema.parse({});

export class AutomationStateStore {
    private memory: AutomationCache | null = null;
    private writeQueue: Promise<unknown> = Promise.resolve();
    private readonly repository: VersionedRepository<AutomationCache>;

    constructor(
        area: StorageArea,
        private readonly now: () => number = () => Date.now(),
    ) {
        this.repository = new VersionedRepository({
            area,
            key: KEY,
            schema: cacheSchema,
            schemaVersion: SCHEMA_VERSION,
            migrate: (data) => {
                const parsed = cacheSchema.safeParse(data);
                return parsed.success ? parsed.data : null;
            },
        });
    }

    private enqueue<T>(run: () => Promise<T>): Promise<T> {
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }

    private async load(): Promise<AutomationCache> {
        if (this.memory) return this.memory;
        this.memory = (await this.repository.get()) ?? {};
        return this.memory;
    }

    private async save(): Promise<void> {
        if (!this.memory) return;
        await this.repository.set(this.memory);
    }

    async get(key: string): Promise<AutomationState> {
        const cache = await this.load();
        return cache[key] ?? EMPTY;
    }

    async set(key: string, patch: AutomationStatePatch): Promise<AutomationState> {
        return this.enqueue(async () => {
            const cache = await this.load();
            const next = automationStateSchema.parse({
                ...(cache[key] ?? EMPTY),
                ...patch,
                updatedAt: this.now(),
            });
            cache[key] = next;
            await this.save();
            return next;
        });
    }

    async clear(key: string): Promise<void> {
        return this.enqueue(async () => {
            const cache = await this.load();
            delete cache[key];
            await this.save();
        });
    }

    async acquireLease(key: string, owner: string, ttlMs: number): Promise<boolean> {
        return this.enqueue(async () => {
            const cache = await this.load();
            const current = cache[key] ?? EMPTY;
            const now = this.now();
            if (current.leaseOwner !== null && current.leaseOwner !== owner && (current.leaseExpiresAt ?? 0) > now) {
                return false;
            }
            cache[key] = automationStateSchema.parse({
                ...current,
                leaseOwner: owner,
                leaseExpiresAt: now + ttlMs,
                updatedAt: now,
            });
            await this.save();
            return true;
        });
    }

    async releaseLease(key: string, owner: string): Promise<void> {
        return this.enqueue(async () => {
            const cache = await this.load();
            const current = cache[key];
            if (!current || current.leaseOwner !== owner) return;
            cache[key] = automationStateSchema.parse({
                ...current,
                leaseOwner: null,
                leaseExpiresAt: null,
                updatedAt: this.now(),
            });
            await this.save();
        });
    }
}
