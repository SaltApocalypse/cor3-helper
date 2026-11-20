import type { GameCommand } from '../../contracts/game.js';
import type { Result } from '../../kernel/result.js';

export interface GameError {
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly retryAt?: number;
    readonly lockExpiresAt?: number;
    readonly stage?: string;
    /** Transport/response ambiguity: the remote command may have executed. */
    readonly unconfirmed?: boolean;
}

export interface GameCommandPort {
    send(command: GameCommand): Promise<Result<void, GameError>>;
}

export interface GameEvent {
    readonly event: string;
    readonly action: string;
    readonly data: unknown;
}

export interface GameEventSource {
    subscribe(listener: (event: GameEvent) => void): () => void;
}

export interface GameMapSnapshot {
    readonly servers: readonly unknown[];
    readonly connections: readonly unknown[];
}

export interface GameMapSource {
    getMap(): Promise<Result<GameMapSnapshot, GameError>>;
}
