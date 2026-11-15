import type { Result } from '../../kernel/result.js';
import type { AuthStatus } from '../../contracts/storage.js';

export interface AuthError {
    readonly code: string;
    readonly message: string;
}

export interface AuthOperation {
    readonly operation: string;
    readonly payload: unknown;
}

/**
 * Content-mediated auth port. Popup/background may request an authenticated
 * operation, but they never receive or persist the underlying token.
 */
export interface AuthRequestPort {
    status(): Promise<AuthStatus>;
    execute<T>(operation: AuthOperation): Promise<Result<T, AuthError>>;
}
