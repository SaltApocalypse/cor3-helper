import { redact, redactText } from './logger.js';

export interface RunLogLine {
    readonly at: number;
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

export class RunLogStore {
    private readonly runs = new Map<string, RunLogLine[]>();

    constructor(
        private readonly maxRuns = 20,
        private readonly maxLinesPerRun = 500,
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
    }

    list(runId: string, limit = 300): readonly RunLogLine[] {
        return (this.runs.get(runId) ?? []).slice(-limit);
    }

    clear(runId: string): void {
        this.runs.delete(runId);
    }
}
