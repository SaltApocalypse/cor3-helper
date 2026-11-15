import { z } from 'zod';
import type { MarketView } from '../../domains/markets/model.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const KEY = 'v2.market.cache';
const SCHEMA_VERSION = 1;
const reputationSchema = z.object({
    level: z.number(),
    progress: z.number(),
    required: z.number(),
    levelLocked: z.boolean(),
    maxLevel: z.boolean(),
}).strict();
const lotSchema = z.object({
    id: z.string(),
    category: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    priceModifier: z.number(),
    accessLevel: z.number().nullable(),
    availableCount: z.number().nullable(),
    manufacturer: z.string().nullable(),
    tier: z.string().nullable(),
    lockedByQuest: z.string().nullable(),
    unavailableReason: z.string().nullable(),
    specs: z.array(z.string()),
}).strict();
const jobSchema = z.object({
    id: z.string(),
    name: z.string(),
    rewardCredits: z.number(),
    rewardReputation: z.number(),
    completed: z.boolean(),
    expired: z.boolean(),
    taken: z.boolean(),
}).strict();
const viewSchema = z.object({
    marketId: z.string(),
    marketName: z.string(),
    credits: z.number(),
    reputation: reputationSchema.nullable(),
    lots: z.array(lotSchema),
    jobs: z.array(jobSchema),
    recentJobs: z.array(jobSchema),
    nextJobsResetAt: z.string().nullable(),
}).strict();
const schema = z.object({
    markets: z.record(z.string(), z.object({
        at: z.number(),
        view: viewSchema,
    }).strict()),
}).strict();

type MarketCacheState = z.infer<typeof schema>;

export interface CachedMarket {
    readonly at: number;
    readonly view: MarketView;
}

export class MarketCacheStore {
    private readonly repository: VersionedRepository<MarketCacheState>;
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

    async get(marketKey: string, maxAgeMs?: number): Promise<CachedMarket | null> {
        const state = (await this.repository.get()) ?? { markets: {} };
        const entry = state.markets[marketKey];
        if (!entry) return null;
        if (maxAgeMs !== undefined && Date.now() - entry.at > maxAgeMs) return null;
        const view = viewSchema.safeParse(entry.view);
        return view.success ? { at: entry.at, view: view.data } : null;
    }

    async set(marketKey: string, view: MarketView): Promise<void> {
        const run = async (): Promise<void> => {
            const state = (await this.repository.get()) ?? { markets: {} };
            await this.repository.set({
                markets: {
                    ...state.markets,
                    [marketKey]: { at: Date.now(), view: viewSchema.parse(view) },
                },
            });
        };
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }
}
