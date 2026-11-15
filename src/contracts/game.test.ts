import { describe, expect, it } from 'vitest';
import { parseGameEventEnvelope } from './game.js';

describe('gameEventEnvelopeSchema', () => {
    it('accepts an event with data', () => {
        expect(parseGameEventEnvelope({ event: 'loadout', action: 'get.options', data: {} }))
            .toEqual({ event: 'loadout', action: 'get.options', data: {} });
    });

    it('rejects an event without an action', () => {
        expect(() => parseGameEventEnvelope({ event: 'loadout', data: {} })).toThrow();
    });
});
