export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
    readonly at: number;
    readonly level: LogLevel;
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

export interface Logger {
    debug(scope: string, message: string, data?: unknown): void;
    info(scope: string, message: string, data?: unknown): void;
    warn(scope: string, message: string, data?: unknown): void;
    error(scope: string, message: string, data?: unknown): void;
}

const SENSITIVE_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|jwt[_-]?token|jwt|session(?:id)?|password|secret|api[_-]?key|bearer)$/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function redactText(input: string): string {
    return input
        .replace(BEARER, 'Bearer [REDACTED]')
        .replace(JWT, '[REDACTED_JWT]');
}

export function redact(input: unknown): unknown {
    const seen = new WeakSet<object>();

    function visit(value: unknown, key?: string): unknown {
        if (key && SENSITIVE_KEY.test(key)) return '[REDACTED]';
        if (typeof value === 'string') return redactText(value);
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        if (Array.isArray(value)) return value.map((entry) => visit(entry));
        if (value instanceof Error) {
            return { name: value.name, message: redactText(value.message), stack: value.stack ? redactText(value.stack) : undefined };
        }
        const result: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            result[childKey] = visit(childValue, childKey);
        }
        return result;
    }

    return visit(input);
}

export class ConsoleLogger implements Logger {
    constructor(private readonly clock: { now(): number } = { now: () => Date.now() }) {}

    debug(scope: string, message: string, data?: unknown): void {
        this.write('debug', scope, message, data);
    }

    info(scope: string, message: string, data?: unknown): void {
        this.write('info', scope, message, data);
    }

    warn(scope: string, message: string, data?: unknown): void {
        this.write('warn', scope, message, data);
    }

    error(scope: string, message: string, data?: unknown): void {
        this.write('error', scope, message, data);
    }

    private write(level: LogLevel, scope: string, message: string, data?: unknown): void {
        const event: LogEvent = {
            at: this.clock.now(),
            level,
            scope,
            message: redactText(message),
        };
        if (data !== undefined) {
            (event as { data?: unknown }).data = redact(data);
        }
        const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error';
        console[method]('[cor3-helper 2.0]', event);
    }
}

export class CapturingLogger implements Logger {
    readonly events: LogEvent[] = [];

    constructor(private readonly clock: { now(): number } = { now: () => Date.now() }) {}

    debug(scope: string, message: string, data?: unknown): void { this.capture('debug', scope, message, data); }
    info(scope: string, message: string, data?: unknown): void { this.capture('info', scope, message, data); }
    warn(scope: string, message: string, data?: unknown): void { this.capture('warn', scope, message, data); }
    error(scope: string, message: string, data?: unknown): void { this.capture('error', scope, message, data); }

    private capture(level: LogLevel, scope: string, message: string, data?: unknown): void {
        const event: LogEvent = {
            at: this.clock.now(),
            level,
            scope,
            message: redactText(message),
        };
        if (data !== undefined) {
            (event as { data?: unknown }).data = redact(data);
        }
        this.events.push(event);
    }
}

/**
 * Rough serialized size of one event. Used to keep the ring buffer inside the
 * storage quota without stringifying the whole buffer on every log call.
 */
function estimateLogEventBytes(event: LogEvent): number {
    let bytes = (event.scope.length + event.message.length + 64) * 2;
    if (event.data !== undefined) {
        try {
            bytes += (JSON.stringify(event.data)?.length ?? 0) * 2;
        } catch {
            bytes += 128;
        }
    }
    return bytes;
}

export class BufferedLogger implements Logger {
    private readonly buffer: LogEvent[] = [];
    /** Parallel to `buffer`; keeps the byte budget cheap to maintain. */
    private readonly sizes: number[] = [];
    private bytes = 0;

    constructor(
        private readonly inner: Logger,
        private readonly maxEntries = 500,
        private readonly onChange?: (events: readonly LogEvent[]) => void,
        /** 0 disables the byte budget. */
        private readonly maxBytes = 0,
    ) {}

    debug(scope: string, message: string, data?: unknown): void { this.capture('debug', scope, message, data); }
    info(scope: string, message: string, data?: unknown): void { this.capture('info', scope, message, data); }
    warn(scope: string, message: string, data?: unknown): void { this.capture('warn', scope, message, data); }
    error(scope: string, message: string, data?: unknown): void { this.capture('error', scope, message, data); }

    events(): readonly LogEvent[] {
        return this.buffer;
    }

    clear(): void {
        this.buffer.splice(0, this.buffer.length);
        this.sizes.splice(0, this.sizes.length);
        this.bytes = 0;
        this.onChange?.(this.buffer);
    }

    prune(keep: (event: LogEvent) => boolean): void {
        const next: LogEvent[] = [];
        const nextSizes: number[] = [];
        let bytes = 0;
        for (let index = 0; index < this.buffer.length; index += 1) {
            const event = this.buffer[index];
            if (!event || !keep(event)) continue;
            next.push(event);
            const size = this.sizes[index] ?? estimateLogEventBytes(event);
            nextSizes.push(size);
            bytes += size;
        }
        if (next.length === this.buffer.length) return;
        this.buffer.splice(0, this.buffer.length, ...next);
        this.sizes.splice(0, this.sizes.length, ...nextSizes);
        this.bytes = bytes;
        this.onChange?.(this.buffer);
    }

    hydrate(events: readonly LogEvent[]): void {
        if (events.length === 0) return;
        const merged = [...events, ...this.buffer]
            .sort((left, right) => left.at - right.at)
            .slice(-this.maxEntries);
        this.buffer.splice(0, this.buffer.length, ...merged);
        this.sizes.splice(0, this.sizes.length, ...merged.map(estimateLogEventBytes));
        this.bytes = this.sizes.reduce((sum, size) => sum + size, 0);
        this.trimToBudget();
        this.onChange?.(this.buffer);
    }

    private capture(level: LogLevel, scope: string, message: string, data?: unknown): void {
        const event: LogEvent = {
            at: Date.now(),
            level,
            scope,
            message: redactText(message),
        };
        if (data !== undefined) (event as { data?: unknown }).data = redact(data);
        this.buffer.push(event);
        this.sizes.push(estimateLogEventBytes(event));
        this.bytes += this.sizes[this.sizes.length - 1] ?? 0;
        this.trimToBudget();
        this.onChange?.(this.buffer);
        if (level === 'debug') this.inner.debug(scope, message, data);
        else if (level === 'info') this.inner.info(scope, message, data);
        else if (level === 'warn') this.inner.warn(scope, message, data);
        else this.inner.error(scope, message, data);
    }

    private trimToBudget(): void {
        let drop = this.buffer.length - this.maxEntries;
        if (this.maxBytes > 0) {
            let excess = this.bytes - this.maxBytes;
            for (let index = 0; excess > 0 && index < this.sizes.length; index += 1) {
                excess -= this.sizes[index] ?? 0;
                drop = Math.max(drop, index + 1);
            }
        }
        if (drop <= 0) return;
        this.buffer.splice(0, drop);
        const removed = this.sizes.splice(0, drop);
        this.bytes -= removed.reduce((sum, size) => sum + size, 0);
    }
}
