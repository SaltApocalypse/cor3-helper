/**
 * Version label helpers.
 *
 * Local development artifacts append the build counter to the release label
 * (`2.0.5-salta.274`). Older artifacts could therefore carry two counters when
 * the manifest and the bundle were built at different times
 * (`2.0.5-salta.272.270`). Displays keep a single counter: the newest one.
 */

const RELEASE_LABEL = /^(\d+\.\d+\.\d+(?:-[^.]+)?)((?:\.\d+)*)$/;

/** Strip trailing build counters from a release label. */
export function splitVersionBuild(versionName: string): {
    readonly base: string;
    readonly build: number | null;
} {
    const match = RELEASE_LABEL.exec(versionName);
    if (!match?.[1]) return { base: versionName, build: null };
    const counters = (match[2] ?? '')
        .split('.')
        .filter((entry) => entry.length > 0)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));
    return {
        base: match[1],
        build: counters.length > 0 ? Math.max(...counters) : null,
    };
}

/** Build counter already embedded in a manifest `version_name`, if any. */
export function buildNumberFromVersionName(versionName: string | null | undefined): string | null {
    if (!versionName) return null;
    const { build } = splitVersionBuild(versionName);
    return build === null ? null : String(build);
}

/**
 * Returns a display version with exactly one build counter (the newest one).
 * A release label without a counter keeps the bundle build number.
 */
export function mergeBuildNumber(versionName: string | null, build: string | number | null): string {
    if (!versionName) return '2.0';
    const { base, build: embedded } = splitVersionBuild(versionName);
    const incoming = typeof build === 'string' ? Number(build) : build;
    const candidates = [embedded, Number.isFinite(incoming ?? Number.NaN) ? incoming : null]
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (candidates.length === 0) return base;
    return `${base}.${Math.max(...candidates)}`;
}
