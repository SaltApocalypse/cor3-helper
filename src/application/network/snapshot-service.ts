import type { NetworkSnapshot } from '../../domains/network/model.js';
import type { GameError } from '../game/ports.js';
import type { Clock } from '../../kernel/clock.js';
import { ok, type Result } from '../../kernel/result.js';

export interface NetworkSnapshotSource {
    getSnapshot(): Promise<Result<NetworkSnapshot, GameError>>;
}

interface CacheEntry {
    readonly snapshot: NetworkSnapshot;
    readonly fetchedAt: number;
}

export interface NetworkSnapshotServiceOptions {
    readonly ttlMs?: number;
    /** How old a cached map may be before it is no longer a safe fallback. */
    readonly fallbackMaxAgeMs?: number;
    readonly logger?: { warn(scope: string, message: string, data?: unknown): void };
    readonly onUpdate?: (snapshot: NetworkSnapshot) => void | Promise<void>;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_FALLBACK_MAX_AGE_MS = 30 * 60_000;

export class NetworkSnapshotService {
    private cached: CacheEntry | null = null;
    private lastWarning: { readonly key: string; readonly at: number } | null = null;
    private readonly ttlMs: number;
    private readonly fallbackMaxAgeMs: number;
    private readonly logger: NetworkSnapshotServiceOptions['logger'];
    private readonly onUpdate: NetworkSnapshotServiceOptions['onUpdate'];

    constructor(
        private readonly source: NetworkSnapshotSource,
        private readonly clock: Clock,
        options: NetworkSnapshotServiceOptions = {},
    ) {
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.fallbackMaxAgeMs = options.fallbackMaxAgeMs ?? DEFAULT_FALLBACK_MAX_AGE_MS;
        this.logger = options.logger;
        this.onUpdate = options.onUpdate;
    }

    async get(force = false): Promise<Result<NetworkSnapshot, GameError>> {
        const now = this.clock.now();
        if (!force && this.cached && now - this.cached.fetchedAt < this.ttlMs) {
            return ok(this.cached.snapshot);
        }
        const result = await this.source.getSnapshot();
        if (result.ok) {
            this.cached = { snapshot: result.value, fetchedAt: now };
            this.lastWarning = null;
            if (this.onUpdate) {
                try {
                    await this.onUpdate(result.value);
                } catch (error) {
                    this.logger?.warn('network', 'Failed to persist network snapshot', {
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return result;
        }
        const cacheAgeMs = this.cached ? now - this.cached.snapshot.capturedAt : null;
        const usableCache = this.cached !== null
            && cacheAgeMs !== null
            && cacheAgeMs <= this.fallbackMaxAgeMs;
        const key = `${result.error.code}:${result.error.message}`;
        if (!this.lastWarning || this.lastWarning.key !== key || now - this.lastWarning.at >= 30_000) {
            this.logger?.warn(
                'network',
                usableCache
                    ? `Using last known network snapshot after refresh failure (${result.error.code}: ${result.error.message})`
                    : `Network snapshot refresh failed and no recent fallback is available (${result.error.code}: ${result.error.message})`,
                {
                    code: result.error.code,
                    message: result.error.message,
                    cacheAgeMs,
                    fallbackMaxAgeMs: this.fallbackMaxAgeMs,
                },
            );
            this.lastWarning = { key, at: now };
        }
        if (usableCache && this.cached) return ok(this.cached.snapshot);
        return result;
    }

    /** Restore the last known good map after a service-worker restart. */
    hydrate(snapshot: NetworkSnapshot): void {
        this.cached = { snapshot, fetchedAt: snapshot.capturedAt };
    }

    invalidate(): void {
        this.cached = null;
    }

    getCached(): NetworkSnapshot | null {
        return this.cached?.snapshot ?? null;
    }

    getCachedAgeMs(): number | null {
        return this.cached ? this.clock.now() - this.cached.snapshot.capturedAt : null;
    }
}
