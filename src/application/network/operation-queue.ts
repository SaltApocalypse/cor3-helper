import { err, type Result } from '../../kernel/result.js';

export interface NetworkOperationRequest {
    readonly id?: string;
    readonly owner: string;
    readonly reason: string;
    readonly priority?: number;
}

export interface NetworkOperationInfo {
    readonly id: string;
    readonly owner: string;
    readonly reason: string;
    readonly priority: number;
    readonly enqueuedAt: number;
    readonly startedAt?: number;
}

export interface NetworkOperationQueueStatus {
    readonly running: NetworkOperationInfo | null;
    readonly waiting: readonly NetworkOperationInfo[];
    readonly updatedAt: number;
}

export interface NetworkOperationError {
    readonly code: 'NETWORK_OPERATION_CANCELLED' | 'NETWORK_OPERATION_FAILED';
    readonly message: string;
}

interface WaitingOperation {
    readonly id: string;
    readonly owner: string;
    readonly reason: string;
    readonly priority: number;
    readonly enqueuedAt: number;
    readonly run: (context: NetworkOperationContext) => Promise<unknown>;
    readonly resolve: (result: Result<unknown, NetworkOperationError>) => void;
    cancelled: boolean;
}

export interface NetworkOperationContext {
    readonly id: string;
    readonly owner: string;
    readonly reason: string;
    readonly isCancelled: () => boolean;
}

export interface NetworkOperationQueueOptions {
    readonly now?: () => number;
    readonly onChange?: (status: NetworkOperationQueueStatus) => void;
}

export class NetworkOperationQueue {
    private readonly now: () => number;
    private readonly onChange: ((status: NetworkOperationQueueStatus) => void) | undefined;
    private running: WaitingOperation | null = null;
    private runningStartedAt: number | null = null;
    private waiting: WaitingOperation[] = [];
    private sequence = 0;
    private updatedAt: number;

    constructor(options: NetworkOperationQueueOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.onChange = options.onChange;
        this.updatedAt = this.now();
    }

    enqueue<T, E = never>(
        request: NetworkOperationRequest,
        run: (context: NetworkOperationContext) => Promise<Result<T, E>>,
    ): Promise<Result<T, E | NetworkOperationError>> {
        const id = request.id ?? `${request.owner}:${++this.sequence}`;
        return new Promise((resolve) => {
            const operation: WaitingOperation = {
                id,
                owner: request.owner,
                reason: request.reason,
                priority: request.priority ?? 0,
                enqueuedAt: this.now(),
                run: run as (context: NetworkOperationContext) => Promise<unknown>,
                resolve: resolve as (result: Result<unknown, NetworkOperationError>) => void,
                cancelled: false,
            };
            this.waiting.push(operation);
            this.waiting.sort((left, right) => right.priority - left.priority || left.enqueuedAt - right.enqueuedAt || left.id.localeCompare(right.id));
            this.notify();
            this.pump();
        });
    }

    cancel(id: string): boolean {
        const running = this.running;
        if (running?.id === id) {
            running.cancelled = true;
            this.notify();
            return true;
        }
        const index = this.waiting.findIndex((operation) => operation.id === id);
        if (index < 0) return false;
        const [operation] = this.waiting.splice(index, 1);
        if (operation) {
            operation.resolve(err({ code: 'NETWORK_OPERATION_CANCELLED', message: `Network operation ${id} was cancelled` }));
        }
        this.notify();
        return true;
    }

    status(): NetworkOperationQueueStatus {
        this.updatedAt = this.now();
        const running = this.running
            ? {
                id: this.running.id,
                owner: this.running.owner,
                reason: this.running.reason,
                priority: this.running.priority,
                enqueuedAt: this.running.enqueuedAt,
                ...(this.runningStartedAt !== null ? { startedAt: this.runningStartedAt } : {}),
            }
            : null;
        return {
            running,
            waiting: this.waiting.map((operation) => ({
                id: operation.id,
                owner: operation.owner,
                reason: operation.reason,
                priority: operation.priority,
                enqueuedAt: operation.enqueuedAt,
            })),
            updatedAt: this.updatedAt,
        };
    }

    private pump(): void {
        if (this.running) return;
        const next = this.waiting.shift();
        if (!next) return;
        if (next.cancelled) {
            next.resolve(err({ code: 'NETWORK_OPERATION_CANCELLED', message: `Network operation ${next.id} was cancelled` }));
            this.pump();
            return;
        }
        this.running = next;
        this.runningStartedAt = this.now();
        this.notify();
        void (async () => {
            try {
                const result = await next.run({
                    id: next.id,
                    owner: next.owner,
                    reason: next.reason,
                    isCancelled: () => next.cancelled,
                });
                next.resolve(result as Result<unknown, NetworkOperationError>);
            } catch (error) {
                next.resolve(err({
                    code: 'NETWORK_OPERATION_FAILED',
                    message: error instanceof Error ? error.message : String(error),
                }));
            } finally {
                this.running = null;
                this.runningStartedAt = null;
                this.notify();
                this.pump();
            }
        })();
    }

    private notify(): void {
        this.updatedAt = this.now();
        this.onChange?.(this.status());
    }
}
