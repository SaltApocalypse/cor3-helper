import { describe, expect, it } from 'vitest';
import { decodeTabRequest, decodeTabResponse, encodeTabRequest, encodeTabResponse } from './tab.js';
import { parseContentNotice, parseTabCommand } from './tab-commands.js';

describe('tab protocol envelope', () => {
    it('encodes a legacy message with a version and request id', () => {
        const envelope = encodeTabRequest({ type: 'V2_STASH_GET', marketId: 'm1' });
        expect(envelope).toMatchObject({
            protocol: 'v2-tab',
            version: 2,
            type: 'V2_STASH_GET',
            payload: { marketId: 'm1' },
        });
        expect(envelope?.requestId).toBeTruthy();
    });

    it('decodes the envelope back to the legacy shape', () => {
        const envelope = encodeTabRequest({ type: 'V2_STASH_GET', marketId: 'm1' });
        expect(decodeTabRequest(envelope)).toEqual({ type: 'V2_STASH_GET', marketId: 'm1' });
    });

    it('leaves unrelated messages untouched', () => {
        expect(encodeTabRequest({ message: 'no type' })).toBeNull();
        expect(decodeTabRequest({ type: 'V2_STASH_GET' })).toBeNull();
    });

    it('validates command payloads by type', () => {
        expect(parseTabCommand('V2_STASH_GET', {})).toEqual({});
        expect(parseTabCommand('V2_STASH_SELL', { itemId: 'a', quantity: 1 })).toEqual({ itemId: 'a', quantity: 1 });
        expect(parseTabCommand('V2_STASH_SELL', { itemId: 'a', quantity: 'one' })).toBeNull();
        expect(parseTabCommand('V2_UNKNOWN', {})).toBeNull();
    });

    it('validates content notices', () => {
        expect(parseContentNotice('V2_WS_NOTICE', { level: 'info', message: 'hi' })).toEqual({ level: 'info', message: 'hi' });
        expect(parseContentNotice('V2_WS_NOTICE', { level: 'info' })).toBeNull();
        expect(parseContentNotice('V2_GAME_READY', { readiness: {} })).toEqual({ readiness: {} });
    });

    it('wraps and unwraps responses with the request id', () => {
        const envelope = encodeTabResponse('request-1', { ok: true, value: 42 });
        expect(envelope).toMatchObject({ protocol: 'v2-tab', version: 2, requestId: 'request-1' });
        expect(decodeTabResponse(envelope)).toEqual({ ok: true, value: 42 });
        expect(decodeTabResponse({ ok: true })).toEqual({ ok: true });
    });
});
