import { describe, expect, it } from 'vitest';
import { parseBridgeEnvelope } from './bridge.js';

const valid = {
    version: 1,
    id: 'req-1',
    source: 'popup',
    target: 'background',
    type: 'PING',
    payload: { at: 1 },
};

describe('bridgeEnvelopeSchema', () => {
    it('accepts a valid request envelope', () => {
        expect(parseBridgeEnvelope(valid)).toMatchObject(valid);
    });

    it('rejects an unknown context', () => {
        expect(() => parseBridgeEnvelope({ ...valid, target: 'unknown' })).toThrow();
    });

    it('rejects a missing request id', () => {
        const { id: _id, ...withoutId } = valid;
        expect(() => parseBridgeEnvelope(withoutId)).toThrow();
    });
});
