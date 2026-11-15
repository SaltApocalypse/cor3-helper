import { settingsV1Schema, type SettingsV1 } from '../../contracts/storage.js';

/** The settings envelope shared by the content-script QoL and SAI helpers. */
export const CONTENT_SETTINGS_KEY = 'v2.settings';

export function parseContentSettings(raw: unknown): SettingsV1 | null {
    if (raw === null || typeof raw !== 'object') return null;
    const envelope = raw as { data?: unknown };
    const parsed = settingsV1Schema.safeParse(envelope.data);
    return parsed.success ? parsed.data : null;
}
