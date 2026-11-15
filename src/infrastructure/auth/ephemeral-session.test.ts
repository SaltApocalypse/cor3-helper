import { describe, expect, it } from 'vitest';
import { EphemeralAuthSessionStore } from './ephemeral-session.js';

describe('EphemeralAuthSessionStore', () => {
    it('keeps a session in memory and clears it', () => {
        const store = new EphemeralAuthSessionStore();
        expect(store.status()).toEqual({ authenticated: false, source: 'none' });
        store.set({ token: 'secret', acquiredAt: 1, expiresAt: 2 });
        expect(store.status()).toEqual({ authenticated: true, source: 'content', expiresAt: 2 });
        expect(store.get()?.token).toBe('secret');
        store.clear();
        expect(store.status()).toEqual({ authenticated: false, source: 'none' });
    });

    it('has no storage imports or persistence path', () => {
        const store = new EphemeralAuthSessionStore();
        store.set({ token: 'secret', acquiredAt: 1 });
        expect(JSON.stringify(store.status())).not.toContain('secret');
    });
});
