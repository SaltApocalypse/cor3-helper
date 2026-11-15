import { describe, expect, it } from 'vitest';
import { collectDecisionObjects, collectExpeditionObjects, isMinigameSocketUrl, looksLikeExpeditionData, looksLikeSpecialistState, pickActiveSocket } from './game-socket-hub.js';

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
