import { z } from 'zod';
import type { StorageEnvelope } from '../../contracts/storage.js';
import type { StorageReadResult } from '../../contracts/storage-health.js';
import type { StorageArea } from './storage-area.js';

/**
 * A migration receives the stored payload and the version it was written with.
 * Version `0` means a legacy, unversioned value. Returning `null` means the
 * value cannot be migrated and should be treated as absent.
 */
export type StorageMigration<T> = (data: unknown, fromVersion: number) => T | null;

export interface VersionedRepositoryOptions<T> {
    readonly area: StorageArea;
    readonly key: string;
    readonly schema: z.ZodType<T>;
    readonly schemaVersion: number;
    readonly clock?: { now(): number };
    readonly logger?: { warn(scope: string, message: string, data?: unknown): void };
    readonly migrate?: StorageMigration<T>;
}

/**
 * The envelope is parsed separately from the payload so a future schema can
 * migrate the inner data instead of discarding the whole record.
 */
const envelopeSchema = z.object({
    schemaVersion: z.number().int().nonnegative(),
    writtenAt: z.number().int().nonnegative(),
    data: z.unknown(),
}).strict();

export class VersionedRepository<T> {
    private readonly clock: { now(): number };
    private readonly logger: { warn(scope: string, message: string, data?: unknown): void } | undefined;

    constructor(private readonly options: VersionedRepositoryOptions<T>) {
        this.clock = options.clock ?? { now: () => Date.now() };
        this.logger = options.logger;
    }

    async get(): Promise<T | null> {
        const raw = (await this.options.area.get(this.options.key))[this.options.key];
        if (raw === undefined) return null;

        const envelope = envelopeSchema.safeParse(raw);
        if (envelope.success) {
            if (envelope.data.schemaVersion === this.options.schemaVersion) {
                return this.parseData(envelope.data.data);
            }
            const migrated = this.options.migrate?.(envelope.data.data, envelope.data.schemaVersion);
            if (migrated !== null && migrated !== undefined) return migrated;
            this.logger?.warn('storage', 'Ignoring incompatible storage schema', {
                key: this.options.key,
                expected: this.options.schemaVersion,
                actual: envelope.data.schemaVersion,
            });
            return null;
        }

        // Legacy stores wrote their payload directly, without an envelope.
        const migrated = this.options.migrate?.(raw, 0);
        if (migrated !== null && migrated !== undefined) return migrated;
        this.logger?.warn('storage', 'Ignoring invalid storage value', { key: this.options.key });
        return null;
    }

    /**
     * Health-aware read used where "absent" and "unreadable" must not collapse
     * into the same value. Legacy `get()` keeps its `T | null` contract.
     */
    async read(): Promise<StorageReadResult<T>> {
        let raw: unknown;
        try {
            raw = (await this.options.area.get(this.options.key))[this.options.key];
        } catch {
            return { status: 'unavailable', error: 'Storage read failed' };
        }
        if (raw === undefined) return { status: 'missing' };

        const envelope = envelopeSchema.safeParse(raw);
        if (envelope.success) {
            if (envelope.data.schemaVersion === this.options.schemaVersion) {
                const parsed = this.options.schema.safeParse(envelope.data.data);
                if (parsed.success) return { status: 'ok', value: parsed.data };
                const migrated = this.migrate(envelope.data.data, this.options.schemaVersion);
                if (migrated.ok) return { status: 'ok', value: migrated.value };
                this.logger?.warn('storage', 'Ignoring malformed storage data', { key: this.options.key });
                return { status: 'corrupt', error: 'Stored payload is invalid' };
            }
            const migrated = this.migrate(envelope.data.data, envelope.data.schemaVersion);
            if (migrated.ok) return { status: 'ok', value: migrated.value };
            this.logger?.warn('storage', 'Ignoring incompatible storage schema', {
                key: this.options.key,
                expected: this.options.schemaVersion,
                actual: envelope.data.schemaVersion,
            });
            return { status: 'corrupt', error: 'Incompatible storage schema version' };
        }

        // Legacy stores wrote their payload directly, without an envelope.
        const migrated = this.migrate(raw, 0);
        if (migrated.ok) return { status: 'ok', value: migrated.value };
        this.logger?.warn('storage', 'Ignoring invalid storage value', { key: this.options.key });
        return { status: 'corrupt', error: 'Stored envelope is invalid' };
    }

    private migrate(data: unknown, fromVersion: number): { readonly ok: true; readonly value: T } | { readonly ok: false } {
        if (!this.options.migrate) return { ok: false };
        try {
            const migrated = this.options.migrate(data, fromVersion);
            if (migrated !== null && migrated !== undefined) return { ok: true, value: migrated };
            return { ok: false };
        } catch {
            return { ok: false };
        }
    }

    async set(value: T): Promise<void> {
        const data = this.options.schema.parse(value);
        const envelope: StorageEnvelope<T> = {
            schemaVersion: this.options.schemaVersion,
            writtenAt: this.clock.now(),
            data,
        };
        await this.options.area.set({ [this.options.key]: envelope });
    }

    async clear(): Promise<void> {
        await this.options.area.remove(this.options.key);
    }

    private parseData(value: unknown): T | null {
        const parsed = this.options.schema.safeParse(value);
        if (parsed.success) return parsed.data;
        const migrated = this.options.migrate?.(value, this.options.schemaVersion);
        if (migrated !== null && migrated !== undefined) return migrated;
        this.logger?.warn('storage', 'Ignoring malformed storage data', { key: this.options.key });
        return null;
    }
}
