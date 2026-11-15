import { describe, expect, it } from 'vitest';
import { mapMailState } from './map.js';

describe('mapMailState', () => {
    it('maps the current object shape', () => {
        const state = mapMailState({
            messages: [{
                id: 'm1',
                status: 'PENDING',
                subject: 'Reward',
                attachments: [{ id: 'a1', source: 'EXPEDITION', sourceId: 'e1', width: 2, height: 1, quantity: 3 }],
            }],
            pendingCount: 1,
        });
        expect(state?.messages).toHaveLength(1);
        expect(state?.messages[0]?.attachments[0]).toMatchObject({ id: 'a1', width: 2, height: 1, quantity: 3 });
        expect(state?.pendingCount).toBe(1);
    });

    it('normalises numeric/string fields from the live game', () => {
        const state = mapMailState({
            messages: [{
                id: 42,
                status: 'PENDING',
                attachments: [{ id: 7, width: '2', height: '3', quantity: '4', canRotate: 'true' }],
            }],
        });
        expect(state?.messages[0]?.id).toBe('42');
        expect(state?.messages[0]?.attachments[0]).toMatchObject({
            id: '7', width: 2, height: 3, quantity: 4, canRotate: true,
        });
    });

    it('accepts null attachments and skips malformed entries', () => {
        const state = mapMailState({
            messages: [
                { id: 'm1', attachments: null },
                { id: 'm2' },
                { attachments: [{ id: 'orphan' }] },
                null,
            ],
        });
        expect(state?.messages.map((message) => message.id)).toEqual(['m1', 'm2']);
    });

    it('accepts a raw message array or a nested mail wrapper', () => {
        expect(mapMailState([{ id: 'm1' }])?.messages).toHaveLength(1);
        expect(mapMailState({ mail: { messages: [{ id: 'm2' }] } })?.messages[0]?.id).toBe('m2');
        expect(mapMailState({ data: { messages: [{ id: 'm3' }] } })?.messages[0]?.id).toBe('m3');
    });

    it('rejects payloads that cannot be a mailbox', () => {
        expect(mapMailState(null)).toBeNull();
        expect(mapMailState({ foo: true })).toBeNull();
        expect(mapMailState('mail')).toBeNull();
    });
});
