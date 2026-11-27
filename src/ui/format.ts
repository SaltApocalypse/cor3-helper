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

export interface FormattableLogLine {
    readonly at: number;
    readonly level: string;
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

/** Compact JSON for a log line's payload; long payloads are truncated. */
export function compactLogData(data: unknown): string {
    if (data === undefined) return '';
    try {
        const text = JSON.stringify(data);
        if (typeof text !== 'string') return '';
        return text.length > 500 ? `${text.slice(0, 497)}...` : text;
    } catch {
        return '[unserializable]';
    }
}

/** Plain-text log format shared by the console view, copy and export. */
export function formatLogLines(lines: readonly FormattableLogLine[]): string {
    return lines
        .map((line) => {
            const data = compactLogData(line.data);
            return `${new Date(line.at).toLocaleTimeString()} [${line.level}] ${line.scope}: ${line.message}${data ? ` | ${data}` : ''}`;
        })
        .join('\n');
}
