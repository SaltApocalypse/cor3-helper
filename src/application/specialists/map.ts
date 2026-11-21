import { rawSpecialistStateSchema } from '../../contracts/specialists.js';
import type { SpecialistState, StashExpansion, StashExpansionOffer } from '../../domains/specialists/model.js';

function toIsoString(value: string | number | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        // Accept both seconds and milliseconds since epoch.
        const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
        return new Date(milliseconds).toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function mapSpecialistState(raw: unknown): SpecialistState | null {
    const parsed = rawSpecialistStateSchema.safeParse(raw);
    if (!parsed.success) return null;
    const expansions: StashExpansion[] = [];
    const offers: StashExpansionOffer[] = [];
    for (const specialist of parsed.data.specialists ?? []) {
        if (!specialist) continue;
        const specialistId = specialist.id ?? '';
        const specialistType = specialist.specialistType ?? specialist.type ?? 'ENGINEER';
        for (const temporary of specialist.temporary ?? []) {
            if (!temporary) continue;
            const prices = (temporary.prices ?? []).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
            const price = prices.find((entry) => typeof entry.id === 'string' && entry.id.length > 0) ?? prices[0];
            const kind = temporary.kind ?? 'TEMPORARY';
            const level = temporary.level ?? 0;
            const bonusSlots = temporary.bonusSlots ?? 0;
            const owned = temporary.owned === true;
            // Missing status on an unowned priced row must not look active.
            // The game omits status on some offer payloads; only owned rows
            // default to ACTIVE.
            const status = temporary.status ?? (owned ? 'ACTIVE' : 'AVAILABLE');
            const expiresAt = toIsoString(temporary.expiresAt);
            if (temporary.owned === true && expiresAt) {
                expansions.push({
                    specialistId,
                    specialistType,
                    kind,
                    level,
                    bonusSlots,
                    expiresAt,
                    gracePeriodEndAt: toIsoString(temporary.gracePeriodEndAt),
                    status,
                    priceId: price?.id ?? null,
                    credits: price?.credits ?? null,
                });
                continue;
            }
            if (temporary.owned !== true && price?.id && bonusSlots > 0) {
                offers.push({
                    specialistId,
                    specialistType,
                    kind,
                    level,
                    bonusSlots,
                    status,
                    priceId: price.id,
                    credits: price.credits ?? null,
                });
            }
        }
    }
    return { expansions, offers, available: true };
}
