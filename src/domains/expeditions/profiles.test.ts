import { describe, expect, it } from 'vitest';
import {
    DRONE_EXPEDITION_PROFILE,
    MERC_EXPEDITION_PROFILES,
    mercProfileKeyForMarket,
    mercProfileMatchesLocations,
} from './profiles.js';

describe('expedition profiles', () => {
    it('maps CORE/home and USOL/elite to the correct fixed profile', () => {
        expect(mercProfileKeyForMarket('home')).toBe('core');
        expect(mercProfileKeyForMarket('core')).toBe('core');
        expect(mercProfileKeyForMarket('usol')).toBe('usol');
        expect(mercProfileKeyForMarket('usol-elite')).toBe('usol');
    });

    it('validates the CORE profile against a matching config', () => {
        const profile = MERC_EXPEDITION_PROFILES.core;
        const locations = [{
            id: profile.locationConfigId,
            zones: [{
                id: profile.zoneConfigId,
                goals: [{ id: profile.goalId }],
            }],
        }];
        expect(mercProfileMatchesLocations(profile, locations)).toBe(true);
    });

    it('rejects a config that does not contain the fixed IDs', () => {
        const profile = MERC_EXPEDITION_PROFILES.usol;
        const locations = [{
            id: profile.locationConfigId,
            zones: [{
                id: profile.zoneConfigId,
                goals: [{ id: 'wrong-goal' }],
            }],
        }];
        expect(mercProfileMatchesLocations(profile, locations)).toBe(false);
    });

    it('has the expected fixed drone target', () => {
        expect(DRONE_EXPEDITION_PROFILE.locationConfigId).toBe('019f7ef6-b720-7d74-a21f-629f48acf812');
        expect(DRONE_EXPEDITION_PROFILE.missionConfigId).toBe('019f7ef6-b720-7ca9-b426-aec91235a611');
    });
});
