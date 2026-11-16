import { settingsPatchSchema, settingsV1Schema, type SettingsPatch, type SettingsV1 } from '../../contracts/storage.js';
import type { Logger } from '../logging/logger.js';
import type { StorageArea } from './storage-area.js';
import { VersionedRepository } from './versioned-repository.js';

const SETTINGS_KEY = 'v2.settings';
const SETTINGS_SCHEMA_VERSION = 1;

/**
 * Settings migrations run on every read and are idempotent. The envelope schema
 * version is bumped only when the stored shape itself changes; default-value
 * migrations stay here so they can be chained without discarding user data.
 */
const SETTINGS_MIGRATIONS: readonly ((settings: SettingsV1) => SettingsV1)[] = [
    // There was no UI to change this interval, so 30 was the old default.
    (settings) => settings.autoJobsIntervalMinutes === 30
        ? { ...settings, autoJobsIntervalMinutes: 60 }
        : settings,
    // Drone events have no veteran/mercenary data, so the drone dropdown no
    // longer offers "veterans first". Map an existing selection to the normal
    // loot-first policy instead of leaving a value the UI cannot display.
    (settings) => settings.droneDecisionPolicy === 'veterans'
        ? { ...settings, droneDecisionPolicy: 'loot' }
        : settings,
];

function migrateSettings(settings: SettingsV1): SettingsV1 {
    return SETTINGS_MIGRATIONS.reduce((current, migrate) => migrate(current), settings);
}

export class SettingsRepository {
    private readonly repository: VersionedRepository<SettingsV1>;
    /**
     * `update` is a read-modify-write over the whole settings object. The popup
     * updates panel open state while a switch can enable an automation at the
     * same time; without serialisation the later write can silently restore the
     * older copy and the switch appears to turn itself back off.
     */
    private writeQueue: Promise<unknown> = Promise.resolve();

    constructor(area: StorageArea, clock?: { now(): number }, logger?: Logger) {
        this.repository = new VersionedRepository({
            area,
            key: SETTINGS_KEY,
            schema: settingsV1Schema,
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            ...(clock ? { clock } : {}),
            ...(logger ? { logger } : {}),
        });
    }

    async get(): Promise<SettingsV1> {
        const current = await this.repository.get();
        if (!current) return settingsV1Schema.parse({});
        // Return migrated defaults without writing from a read path: writing
        // here can overwrite a concurrent settings.update() with stale data.
        return migrateSettings(current);
    }

    update(patch: SettingsPatch): Promise<SettingsV1> {
        const run = async (): Promise<SettingsV1> => {
            const stored = await this.repository.get();
            const base = stored ?? settingsV1Schema.parse({});
            const current = migrateSettings(base);
            const next = settingsV1Schema.parse({ ...current, ...settingsPatchSchema.parse(patch) });
            await this.repository.set(next);
            return next;
        };
        const next = this.writeQueue.then(run, run);
        this.writeQueue = next.then(() => undefined, () => undefined);
        return next;
    }
}
