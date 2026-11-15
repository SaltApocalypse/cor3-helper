/** Footer version: release identity plus the bundle's build counter. */
export function displayVersion(versionName: string | null, build: string | null): string {
    if (!versionName) return '2.0';
    if (!build || versionName.endsWith(`.${build}`)) return versionName;
    return `${versionName}.${build}`;
}
