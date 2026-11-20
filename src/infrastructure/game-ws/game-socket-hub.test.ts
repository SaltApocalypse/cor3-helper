import { describe, expect, it } from 'vitest';
import { gameError, interpretJobCommandResponse, parseGameFrame, collectDecisionObjects, collectExpeditionObjects, isMinigameSocketUrl, looksLikeExpeditionData, looksLikeSpecialistState, parseOutgoingMarketRequest, pickActiveSocket } from './game-socket-hub.js';

describe('isMinigameSocketUrl', () => {
    it('excludes minigame sockets from active selection', () => {
        expect(isMinigameSocketUrl('wss://cor3.gg/ice-wall-break')).toBe(true);
        expect(isMinigameSocketUrl('wss://cor3.gg/minigame/socket')).toBe(true);
        expect(isMinigameSocketUrl('wss://cor3.gg/socket.io/?EIO=4')).toBe(false);
    });
});

describe('pickActiveSocket', () => {
    const socket = (url: string, minigame: boolean, lastActivityAt: number, readyState = 1) => ({
        url,
        minigame,
        lastActivityAt,
        readyState,
    });

    it('ignores minigame sockets even when they are the newest', () => {
        const selected = pickActiveSocket([
            socket('wss://cor3.gg/socket.io/', false, 100),
            socket('wss://cor3.gg/ice-wall-break', true, 900),
        ]);
        expect(selected?.url).toBe('wss://cor3.gg/socket.io/');
    });

    it('falls back to the game socket after the minigame socket closes', () => {
        const selected = pickActiveSocket([socket('wss://cor3.gg/socket.io/', false, 100)]);
        expect(selected?.url).toBe('wss://cor3.gg/socket.io/');
    });

    it('picks the most recently active open game socket', () => {
        const selected = pickActiveSocket([
            socket('wss://cor3.gg/a', false, 100),
            socket('wss://cor3.gg/b', false, 500),
            socket('wss://cor3.gg/c', false, 900, 3),
        ]);
        expect(selected?.url).toBe('wss://cor3.gg/b');
    });

    it('returns null when only minigame or closed sockets exist', () => {
        expect(pickActiveSocket([
            socket('wss://cor3.gg/ice-wall-break', true, 900),
            socket('wss://cor3.gg/socket.io/', false, 100, 3),
        ])).toBeNull();
    });
});

describe('looksLikeExpeditionData', () => {
    it('accepts active expedition payloads', () => {
        expect(looksLikeExpeditionData([])).toBe(true);
        expect(looksLikeExpeditionData({ expeditions: [] })).toBe(true);
        expect(looksLikeExpeditionData({ active: [] })).toBe(true);
        expect(looksLikeExpeditionData([{ id: 'exp-1', status: 'IN_PROGRESS', locationName: 'Skylift Remains' }])).toBe(true);
        expect(looksLikeExpeditionData({ id: 'exp-1', status: 'IN_PROGRESS', locationName: 'Skylift Remains' })).toBe(true);
    });

    it('rejects mercenary and decision payloads', () => {
        expect(looksLikeExpeditionData([{ id: 'merc-1', status: 'AVAILABLE', price: 100 }])).toBe(false);
        expect(looksLikeExpeditionData({ decisions: [{ id: 'msg-1' }] })).toBe(false);
        expect(looksLikeExpeditionData(null)).toBe(false);
    });
});


describe('looksLikeSpecialistState', () => {
    it('accepts specialist state pushes with empty or null lists', () => {
        expect(looksLikeSpecialistState({ specialists: [] })).toBe(true);
        expect(looksLikeSpecialistState({ specialists: null })).toBe(true);
        expect(looksLikeSpecialistState({ specialists: [{ id: 'engineer-1' }] })).toBe(true);
    });

    it('rejects unrelated payloads', () => {
        expect(looksLikeSpecialistState(null)).toBe(false);
        expect(looksLikeSpecialistState({ data: { specialists: [] } })).toBe(false);
    });
});

describe('expedition event extraction', () => {
    it('captures expedition objects that carry decision messages', () => {
        const expeditions = collectExpeditionObjects({
            expeditions: [{
                id: 'exp-1',
                status: 'IN_PROGRESS',
                locationName: 'Skylift Remains',
                messages: [{ id: 'msg-1', options: [{ id: 'opt-1' }] }],
            }],
        });
        expect(expeditions).toHaveLength(1);
        expect(expeditions[0]?.id).toBe('exp-1');
    });

    it('captures explicit decision arrays from event payloads', () => {
        expect(collectDecisionObjects({ decisions: [{ id: 'msg-1' }] })).toHaveLength(1);
    });

    it('captures a single decision object or a nested event decision', () => {
        expect(collectDecisionObjects({ id: 'msg-1', expeditionId: 'exp-1', options: [{ id: 'a' }] })).toHaveLength(1);
        expect(collectDecisionObjects({
            expeditionId: 'exp-1',
            messageId: 'msg-2',
            event: { id: 'event-2', options: [{ id: 'b' }] },
        })).toHaveLength(1);
    });
});

describe('parseOutgoingMarketRequest', () => {
    it('captures manual market refresh frames', () => {
        expect(parseOutgoingMarketRequest('42' + JSON.stringify([
            'event',
            { event: { name: 'market', action: 'get.jobs' }, data: { marketId: 'usol-market' } },
        ]))).toEqual({ action: 'get.jobs', marketId: 'usol-market' });
    });

    it('ignores other events and malformed frames', () => {
        expect(parseOutgoingMarketRequest('42' + JSON.stringify([
            'event',
            { event: { name: 'market', action: 'take.job' }, data: { marketId: 'usol-market' } },
        ]))).toBeNull();
        expect(parseOutgoingMarketRequest('42not-json')).toBeNull();
        expect(parseOutgoingMarketRequest('40{"token":"x"}')).toBeNull();
    });
});

describe('gameError provenance', () => {
    it('marks a server error without a string code as an unconfirmed fallback', () => {
        const result = gameError({ message: 'job-conditions-not-met' }, 'GAME_JOB_FAILED');
        expect(result).toMatchObject({
            code: 'GAME_JOB_FAILED',
            message: 'job-conditions-not-met',
            unconfirmed: true,
        });
    });

    it('marks non-object and structurally invalid errors as unconfirmed fallbacks', () => {
        for (const error of ['rate-limited', [], true, 1, {}, { code: null, message: 'x' }, { code: 123, message: 'x' }]) {
            expect(gameError(error, 'GAME_JOB_FAILED')).toMatchObject({
                code: 'GAME_JOB_FAILED',
                unconfirmed: true,
            });
        }
        expect(gameError('rate-limited', 'GAME_JOB_FAILED')).toMatchObject({
            code: 'GAME_JOB_FAILED',
            message: 'rate-limited',
            unconfirmed: true,
        });
    });

    it('preserves a server-provided string code and optional retry metadata', () => {
        expect(gameError({ code: 'GAME_JOB_FAILED', message: 'rejected', retryAt: 42, lockExpiresAt: 7 }, 'FALLBACK'))
            .toEqual({ code: 'GAME_JOB_FAILED', message: 'rejected', retryAt: 42, lockExpiresAt: 7 });
    });
});

describe('parseGameFrame', () => {
    const frame = (payload: unknown, eventName: unknown = 'market') => `42${JSON.stringify([eventName, payload])}`;

    it('parses a matching protocol frame and exposes action/data/error', () => {
        const parsed = parseGameFrame(frame({ event: { action: 'job.complete' }, data: { jobId: 'job-1' } }));
        expect(parsed).toMatchObject({
            eventName: 'market',
            action: 'job.complete',
            data: { jobId: 'job-1' },
            error: undefined,
        });
    });

    it('rejects unparseable, truncated, or non-protocol frames', () => {
        for (const text of [
            '',
            '40{"token":"x"}',
            '42not-json',
            frame(undefined),
            frame(null),
            frame('payload'),
            frame([]),
        ]) {
            expect(parseGameFrame(text)).toBeNull();
        }
        expect(parseGameFrame(`42${JSON.stringify([])}`)).toBeNull();
        expect(parseGameFrame(`42${JSON.stringify(['market'])}`)).toBeNull();
        expect(parseGameFrame(`42${JSON.stringify([42, { event: { action: 'job.complete' } }])}`)).toBeNull();
    });

    it('keeps a frame with no action for push handlers, but no command can match it', () => {
        const parsed = parseGameFrame(frame({ data: { files: [] } }));
        expect(parsed).toMatchObject({ eventName: 'market', action: undefined, data: { files: [] } });
        expect(parsed?.action).toBeUndefined();
        expect(parseGameFrame(frame({ event: { action: 123 } }))?.action).toBeUndefined();
    });

    it('exposes a different action for an unrelated frame', () => {
        const parsed = parseGameFrame(frame({ event: { action: 'get.jobs' }, data: {} }));
        expect(parsed?.action).toBe('get.jobs');
        expect(parsed?.action).not.toBe('job.complete');
    });
});

describe('interpretJobCommandResponse', () => {
    it('classifies frame-level fallback errors as unconfirmed', () => {
        const frames = [
            { message: 'job-conditions-not-met' },
            { message: 'market-not-reachable' },
            { message: 'rate-limited' },
            {},
            { code: null, message: 'x' },
            { code: 123, message: 'x' },
            'rate-limited',
            [],
            true,
        ];
        for (const error of frames) {
            const result = interpretJobCommandResponse({ data: { jobId: 'job-1' }, error });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.code).toBe('GAME_JOB_FAILED');
                expect(result.error.unconfirmed).toBe(true);
            }
        }
    });

    it('keeps a server-provided GAME_JOB_FAILED code without local unconfirmed', () => {
        const result = interpretJobCommandResponse({
            data: undefined,
            error: { code: 'GAME_JOB_FAILED', message: 'rejected' },
        });
        expect(result).toMatchObject({ ok: false, error: { code: 'GAME_JOB_FAILED', message: 'rejected' } });
        if (!result.ok) expect(result.error.unconfirmed).toBeUndefined();
    });

    it('accepts empty ACKs for matching responses without an error', () => {
        for (const data of [undefined, null, {}, [], '', 0, false]) {
            expect(interpretJobCommandResponse({ data, error: undefined }))
                .toEqual({ ok: true, value: data });
        }
        expect(interpretJobCommandResponse({ data: undefined, error: null }))
            .toEqual({ ok: true, value: undefined });
    });

    it('accepts non-empty payloads without assuming field semantics', () => {
        for (const data of [{ jobId: 'job-1' }, 'ok', 1, true, [1]]) {
            expect(interpretJobCommandResponse({ data, error: undefined }))
                .toEqual({ ok: true, value: data });
        }
    });

    it('rejects a matching response with a truthy error', () => {
        const result = interpretJobCommandResponse({
            data: { jobId: 'job-1' },
            error: { code: 'GAME_JOB_FAILED', message: 'rejected' },
        });
        expect(result).toMatchObject({ ok: false, error: { code: 'GAME_JOB_FAILED', message: 'rejected' } });
    });
});
