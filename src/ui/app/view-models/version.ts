import { mergeBuildNumber } from '../../../kernel/version.js';

/** Footer version: release identity plus the bundle's build counter. */
export function displayVersion(versionName: string | null, build: string | null): string {
    return mergeBuildNumber(versionName, build);
}
