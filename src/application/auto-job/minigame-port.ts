import type { Result } from '../../kernel/result.js';
import type { GameError } from '../game/ports.js';

export interface MinigameOutcome {
    readonly kind: 'simple-decrypt' | 'config-hack' | 'ice-wall' | 'none';
    readonly solved: boolean;
    readonly message?: string;
}

export interface MinigamePort {
    solve(timeoutMs?: number): Promise<Result<MinigameOutcome, GameError>>;
    cancel(): Promise<Result<void, GameError>>;
}
