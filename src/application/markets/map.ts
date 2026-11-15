import type { MarketJobSummary, MarketLot, MarketReputation, MarketView } from '../../domains/markets/model.js';
import { rawMarketViewSchema, type RawMarketLot } from '../../contracts/market-view.js';

function numberOr(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mapLot(raw: RawMarketLot): MarketLot {
    const details = raw.details;
    return {
        id: raw.id ?? `${raw.category ?? 'LOT'}:${details?.name ?? 'unknown'}:${raw.price ?? 0}`,
        category: raw.category ?? 'OTHER',
        name: details?.name ?? 'Unknown',
        description: details?.description ?? '',
        price: numberOr(raw.price),
        priceModifier: numberOr(raw.priceModifier),
        accessLevel: raw.accessLevel ?? null,
        availableCount: raw.availableCount ?? null,
        manufacturer: details?.manufacturer ?? null,
        tier: details?.tier ?? null,
        lockedByQuest: raw.lockedByQuest ?? null,
        unavailableReason: raw.unavailableReason ?? null,
        specs: describeSpecs(details?.specs),
    };
}

function jobSummary(raw: unknown): MarketJobSummary | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : '';
    const name = typeof entry.name === 'string' ? entry.name : 'Unknown';
    if (!id) return null;
    return {
        id,
        name,
        rewardCredits: numberOr(entry.rewardCredits),
        rewardReputation: numberOr(entry.rewardReputation),
        completed: entry.isCompleted === true,
        expired: entry.isExpired === true,
        taken: entry.status === 'TAKEN',
    };
}

function mapReputation(raw: unknown): MarketReputation | null {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Record<string, unknown>;
    return {
        level: numberOr(entry.level),
        progress: numberOr(entry.progress),
        required: numberOr(entry.requiredReputation),
        levelLocked: entry.isLevelLocked === true,
        maxLevel: entry.isMaxLevel === true,
    };
}

export function mapMarketView(raw: unknown): MarketView | null {
    const parsed = rawMarketViewSchema.safeParse(raw);
    if (!parsed.success) return null;
    const options = parsed.data.options;
    if (!options.market?.id && !options.market?.marketName) return null;
    const lotsRaw = Array.isArray(parsed.data.lots) ? parsed.data.lots : parsed.data.lots.lots;
    const lots = lotsRaw.map(mapLot);
    const jobsContainer = Array.isArray(parsed.data.jobs) ? null : parsed.data.jobs;
    const jobsRaw = Array.isArray(parsed.data.jobs) ? parsed.data.jobs : jobsContainer?.jobs ?? [];
    const recentRaw = jobsContainer?.recentJobs ?? [];
    const jobs = jobsRaw.map(jobSummary).filter((job): job is MarketJobSummary => job !== null);
    const recentJobs = recentRaw.map(jobSummary).filter((job): job is MarketJobSummary => job !== null);
    return {
        marketId: options.market?.id ?? '',
        marketName: options.market?.marketName ?? 'Market',
        credits: numberOr(options.userCredits),
        reputation: mapReputation(options.reputation),
        lots,
        jobs,
        recentJobs,
        nextJobsResetAt: jobsContainer?.nextJobsResetAt ?? null,
    };
}


function describeSpecs(raw: unknown): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const spec = entry as Record<string, unknown>;
            const parts: string[] = [];
            if (typeof spec.type === 'string') parts.push(spec.type);
            if (Array.isArray(spec.power) && spec.power.length >= 2) parts.push(`${spec.power[0]}–${spec.power[1]}`);
            if (Array.isArray(spec.serverTypes)) parts.push(`servers: ${spec.serverTypes.join(', ')}`);
            if (Array.isArray(spec.fileTypes)) parts.push(`files: ${spec.fileTypes.join(', ')}`);
            return parts.length > 0 ? [parts.join(' · ')] : [];
        });
    }
    if (typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
    }
    return [];
}
