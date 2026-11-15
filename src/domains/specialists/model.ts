export interface StashExpansion {
    readonly specialistId: string;
    readonly specialistType: string;
    readonly kind: string;
    readonly level: number;
    readonly bonusSlots: number;
    readonly expiresAt: string | null;
    readonly gracePeriodEndAt: string | null;
    readonly status: string;
    readonly priceId: string | null;
    readonly credits: number | null;
}

export interface StashExpansionOffer {
    readonly specialistId: string;
    readonly specialistType: string;
    readonly kind: string;
    readonly level: number;
    readonly bonusSlots: number;
    readonly status: string;
    readonly priceId: string;
    readonly credits: number | null;
}

export interface SpecialistState {
    readonly expansions: readonly StashExpansion[];
    /** Priced temporary-slot offers that are not owned yet. */
    readonly offers: readonly StashExpansionOffer[];
    /** Long-lived availability cache; false means the feature is locked. */
    readonly available: boolean;
}

export interface SpecialistPurchase {
    readonly specialistType: string;
    readonly kind: string;
    readonly level: number;
    readonly priceId: string;
}
