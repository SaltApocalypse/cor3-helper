export interface AuthSession {
    readonly token: string;
    readonly acquiredAt: number;
    readonly expiresAt?: number;
}

export interface AuthSessionStore {
    get(): AuthSession | null;
    set(session: AuthSession): void;
    clear(): void;
    status(): import('../../contracts/storage.js').AuthStatus;
}

/**
 * Session-only token store. It intentionally has no storage dependency.
 * The content context will own the live session adapter in a later phase.
 */
export class EphemeralAuthSessionStore implements AuthSessionStore {
    private session: AuthSession | null = null;

    get(): AuthSession | null {
        return this.session;
    }

    set(session: AuthSession): void {
        this.session = session;
    }

    clear(): void {
        this.session = null;
    }

    status(): import('../../contracts/storage.js').AuthStatus {
        return {
            authenticated: this.session !== null,
            source: this.session ? 'content' : 'none',
            ...(this.session?.expiresAt !== undefined ? { expiresAt: this.session.expiresAt } : {}),
        };
    }
}
