export function formatRemaining(timestamp: string, now: number): string {
    const target = new Date(timestamp).getTime();
    if (!Number.isFinite(target)) return timestamp;
    const remaining = Math.max(0, target - now);
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
}

/** Compact age for "last sync" style status lines. */
export function formatAge(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '--';
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
}
