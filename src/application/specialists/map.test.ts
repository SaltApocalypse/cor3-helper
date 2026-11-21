import { describe, expect, it } from 'vitest';
import { mapSpecialistState } from './map.js';

describe('mapSpecialistState', () => {
    it('maps owned temporary expansions and unowned offers', () => {
        const state = mapSpecialistState({
            specialists: [{
                id: 'engineer-1',
                specialistType: 'ENGINEER',
                temporary: [
                    {
                        owned: true,
                        expiresAt: '2026-01-02T00:00:00.000Z',
                        status: 'ACTIVE',
                        kind: 'TEMPORARY',
                        level: 1,
                        bonusSlots: 20,
                        prices: [{ id: 'renew-20', credits: 5000 }],
                    },
                    {
                        owned: false,
                        status: 'AVAILABLE',
                        kind: 'TEMPORARY',
                        level: 1,
                        bonusSlots: 10,
                        prices: [{ id: 'buy-10', credits: 2500 }],
                    },
                ],
            }],
        });
        expect(state).not.toBeNull();
        expect(state?.expansions).toHaveLength(1);
        expect(state?.expansions[0]).toMatchObject({ bonusSlots: 20, priceId: 'renew-20', credits: 5000 });
        expect(state?.offers).toHaveLength(1);
        expect(state?.offers[0]).toMatchObject({ bonusSlots: 10, priceId: 'buy-10', credits: 2500 });
        expect(state?.available).toBe(true);
    });

    it('accepts null optional fields from the live game payload', () => {
        const state = mapSpecialistState({
            specialists: [{
                id: 'engineer-1',
                specialistType: 'ENGINEER',
                temporary: [{
                    owned: true,
                    expiresAt: '2026-01-02T00:00:00.000Z',
                    gracePeriodEndAt: null,
                    bonusSlots: 20,
                    kind: 'TEMPORARY',
                    level: 1,
                    status: 'ACTIVE',
                    prices: [{ id: 'renew-20', credits: null }],
                }],
            }],
        });
        expect(state).not.toBeNull();
        expect(state?.expansions[0]).toMatchObject({
            expiresAt: '2026-01-02T00:00:00.000Z',
            gracePeriodEndAt: null,
            credits: null,
        });
    });

    it('normalizes numeric expiry timestamps', () => {
        const state = mapSpecialistState({
            specialists: [{
                id: 'engineer-1',
                temporary: [{
                    owned: true,
                    expiresAt: 1735776000,
                    bonusSlots: 10,
                }],
            }],
        });
        expect(state?.expansions[0]?.expiresAt).toBe(new Date(1735776000 * 1000).toISOString());
    });

    it('treats a null specialists list as an empty available state', () => {
        expect(mapSpecialistState({ specialists: null })).toEqual({ expansions: [], offers: [], available: true });
    });

    it('returns null for an invalid payload', () => {
        expect(mapSpecialistState({ specialists: 'nope' })).toBeNull();
    });
});

describe('mapSpecialistState status defaults', () => {
    it('does not label an unowned offer as active when the game omits status', () => {
        const state = mapSpecialistState({
            specialists: [{
                id: 'engineer-1',
                specialistType: 'ENGINEER',
                temporary: [{
                    owned: false,
                    kind: 'TEMPORARY',
                    level: 1,
                    bonusSlots: 10,
                    prices: [{ id: 'buy-10', credits: 2500 }],
                }],
            }],
        });
        expect(state?.offers[0]?.status).toBe('AVAILABLE');
        expect(state?.expansions).toEqual([]);
    });

    it('still treats an owned expansion without a status as active', () => {
        const state = mapSpecialistState({
            specialists: [{
                id: 'engineer-1',
                temporary: [{
                    owned: true,
                    expiresAt: '2026-01-02T00:00:00.000Z',
                    bonusSlots: 20,
                    prices: [{ id: 'renew-20', credits: 5000 }],
                }],
            }],
        });
        expect(state?.expansions[0]?.status).toBe('ACTIVE');
    });
});
