import { describe, expect, it } from 'vitest';
import { isStashCapacityError, isPendingMessage, pendingMessages } from './model.js';

describe('mail model', () => {
    it('recognises stash capacity errors from the game and fallback paths', () => {
        expect(isStashCapacityError('insufficient stash')).toBe(true);
        expect(isStashCapacityError('stash.error.insufficient')).toBe(true);
        expect(isStashCapacityError('Not enough capacity')).toBe(true);
        expect(isStashCapacityError('claim rejected')).toBe(false);
    });

    it('treats every non-claimed, non-expired message as pending', () => {
        const base = { subject: 'x', attachments: [] };
        expect(isPendingMessage({ ...base, id: 'a', status: 'PENDING' })).toBe(true);
        expect(isPendingMessage({ ...base, id: 'b', status: 'CLAIMED' })).toBe(false);
        expect(isPendingMessage({ ...base, id: 'c', status: 'EXPIRED' })).toBe(false);
        expect(pendingMessages({
            messages: [
                { ...base, id: 'a', status: 'PENDING' },
                { ...base, id: 'b', status: 'CLAIMED' },
            ],
            pendingCount: 1,
        }).map((message) => message.id)).toEqual(['a']);
    });
});
