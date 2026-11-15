/**
 * Fixed expedition targets.
 *
 * The game resolves these values by config ID, not by name. Names are localized
 * by the game client, so matching English names is not safe. Keep the IDs here
 * and display the canonical names below; update this table manually when the
 * game changes a target.
 */

export type MercExpeditionProfileKey = 'core' | 'usol';

export interface MercExpeditionProfile {
    readonly key: MercExpeditionProfileKey;
    readonly marketLabel: string;
    readonly locationName: string;
    readonly goalName: string;
    readonly locationConfigId: string;
    readonly zoneConfigId: string;
    readonly goalId: string;
}

export const MERC_EXPEDITION_PROFILES: Record<MercExpeditionProfileKey, MercExpeditionProfile> = {
    core: {
        key: 'core',
        marketLabel: 'CORE',
        locationName: 'Skylift Remains',
        goalName: 'Item Retrieval',
        locationConfigId: '019ce7b9-6b1c-7623-8439-110eed7ca91a',
        zoneConfigId: '019d814d-f9ad-77d2-a147-5dd4432b67cd',
        goalId: '019d76f5-044a-7c6a-bcac-49c5bb748fe8',
    },
    usol: {
        key: 'usol',
        marketLabel: 'USOL',
        locationName: 'Koute Mining and Reprocessing Outpost',
        goalName: 'Salvage Run',
        locationConfigId: '019f1a2b-3c4d-7e5f-80b6-505f68091014',
        zoneConfigId: '019f1a2b-3c4d-7e5f-80b7-5f68091014a5',
        goalId: '019f1a2b-3c4d-7e5f-80b8-68091014a5b6',
    },
};

/**
 * The five expedition markets use `home` for CORE, while mercenary selection
 * uses `core`. USOL Elite shares USOL's target.
 */
export function mercProfileKeyForMarket(marketKey: string | null | undefined): MercExpeditionProfileKey {
    return marketKey === 'usol' || marketKey === 'usol-elite' ? 'usol' : 'core';
}

export interface DroneExpeditionProfile {
    readonly locationName: string;
    readonly goalName: string;
    readonly locationConfigId: string;
    readonly missionConfigId: string;
}

export const DRONE_EXPEDITION_PROFILE: DroneExpeditionProfile = {
    locationName: 'The Surface of Mars',
    goalName: 'Surface Exploration',
    locationConfigId: '019f7ef6-b720-7d74-a21f-629f48acf812',
    missionConfigId: '019f7ef6-b720-7ca9-b426-aec91235a611',
};

export interface ExpeditionTargetIds {
    readonly locationConfigId: string;
    readonly zoneConfigId?: string;
    readonly goalId?: string;
    readonly missionConfigId?: string;
}

/** Verify a static profile against the live game config before dispatching. */
export function mercProfileMatchesLocations(
    profile: MercExpeditionProfile,
    locations: readonly { readonly id: string; readonly zones: readonly { readonly id: string; readonly goals: readonly { readonly id: string }[] }[] }[],
): boolean {
    const location = locations.find((entry) => entry.id === profile.locationConfigId);
    if (!location) return false;
    const zone = location.zones.find((entry) => entry.id === profile.zoneConfigId);
    if (!zone) return false;
    return zone.goals.some((goal) => goal.id === profile.goalId);
}
