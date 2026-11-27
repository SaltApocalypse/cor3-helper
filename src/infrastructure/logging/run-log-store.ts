import { redact, redactText } from './logger.js';

export interface RunLogLine {
    readonly at: number;
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

export function isRunLogLine(value: unknown): value is RunLogLine {
    if (!value || typeof value !== 'object') return false;
    const entry = value as { at?: unknown; level?: unknown; scope?: unknown; message?: unknown };
    return typeof entry.at === 'number'
        && (entry.level === 'debug' || entry.level === 'info' || entry.level === 'warn' || entry.level === 'error')
        && typeof entry.scope === 'string'
        && typeof entry.message === 'string';
}

/**
 * Per-run automation log. The lines are persisted through the `onChange`
 * callback so a service worker restart does not erase the run that just
 * happened; without that the UI's "run log" view was empty by the time a user
 * checked a failure from the previous evening.
 */
export class RunLogStore {
    private readonly runs = new Map<string, RunLogLine[]>();

    constructor(
        private readonly maxRuns = 20,
        private readonly maxLinesPerRun = 500,
        private readonly onChange?: () => void,
    ) {}

    add(runId: string, level: RunLogLine['level'], scope: string, message: string, data?: unknown): void {
        let lines = this.runs.get(runId);
        if (!lines) {
            lines = [];
            this.runs.set(runId, lines);
            while (this.runs.size > this.maxRuns) {
                const oldest = this.runs.keys().next().value;
                if (oldest === undefined) break;
                this.runs.delete(oldest);
            }
        }
        lines.push({
            at: Date.now(),
            level,
            scope,
            message: redactText(message),
            ...(data !== undefined ? { data: redact(data) } : {}),
        });
        if (lines.length > this.maxLinesPerRun) lines.splice(0, lines.length - this.maxLinesPerRun);
        this.onChange?.();
    }

    list(runId: string, limit = 300): readonly RunLogLine[] {
        return (this.runs.get(runId) ?? []).slice(-limit);
    }

    clear(runId: string): void {
        if (this.runs.delete(runId)) this.onChange?.();
    }

    /** Newest runs, for persistence. Bounded so the log buffer keeps its quota. */
    snapshot(limitRuns = 6): Record<string, readonly RunLogLine[]> {
        const entries = [...this.runs.entries()].slice(-limitRuns);
        return Object.fromEntries(entries);
    }

    /** Restore persisted runs; live lines always win over restored ones. */
    hydrate(raw: unknown): void {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        let restored = 0;
        for (const [runId, value] of Object.entries(raw)) {
            if (!Array.isArray(value) || this.runs.has(runId)) continue;
            const lines = value.filter(isRunLogLine).slice(-this.maxLinesPerRun);
            if (lines.length === 0) continue;
            this.runs.set(runId, [...lines]);
            restored += 1;
        }
        while (this.runs.size > this.maxRuns) {
            const oldest = this.runs.keys().next().value;
            if (oldest === undefined) break;
            this.runs.delete(oldest);
        }
        if (restored > 0) this.onChange?.();
    }
}
