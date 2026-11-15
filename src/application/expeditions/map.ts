import {
    rawActiveExpeditionsSchema,
    rawExpeditionConfigSchema,
    rawMercenariesSchema,
    rawDecisionSchema,
} from '../../contracts/expedition.js';
import {
    isExpeditionReady,
    type ActiveExpedition,
    type ExpeditionDecision,
    type ExpeditionLocation,
    type ExpeditionMercenary,
    type ExpeditionOverview,
} from '../../domains/expeditions/model.js';

type RawDecision = import('zod').infer<typeof rawDecisionSchema>;

function mapDecision(raw: RawDecision): ExpeditionDecision | null {
    if (raw.isResolved === true) return null;
    return {
        id: raw.id ?? raw.messageId ?? '',
        expeditionId: raw.expeditionId ?? '',
        message: raw.message ?? raw.title ?? raw.content ?? 'Decision',
        options: (raw.options ?? raw.decisionOptions ?? []).map((option) => ({
            id: option.id ?? option.value ?? option.key ?? option.optionId ?? '',
            label: option.label ?? option.id ?? option.value ?? 'Option',
            successChance: option.successChance ?? null,
            risk: option.risk ?? null,
            lootModifier: option.lootModifier ?? option.lootDelta ?? option.effect?.lootDelta ?? 0,
            riskModifier: option.riskModifier ?? option.riskDelta ?? option.effect?.riskDelta ?? 0,
            requiredModuleId: option.requiredModuleId ?? option.requiredModule ?? null,
        })).filter((option) => option.id.length > 0),
    };
}

function mapExpedition(raw: unknown): ActiveExpedition | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    const mercenary = entry.mercenary;
    const mercenaryName = typeof mercenary === 'string'
        ? mercenary
        : mercenary && typeof mercenary === 'object'
            ? (typeof (mercenary as { callsign?: unknown }).callsign === 'string'
                ? (mercenary as { callsign: string }).callsign
                : typeof (mercenary as { name?: unknown }).name === 'string' ? (mercenary as { name: string }).name : null)
            : null;
    return {
        id: typeof entry.id === 'string' ? entry.id : '',
        status: typeof entry.status === 'string' ? entry.status : 'UNKNOWN',
        locationName: typeof entry.locationName === 'string' ? entry.locationName : 'Unknown location',
        mercenaryName,
        totalCost: typeof entry.totalCost === 'number' ? entry.totalCost : null,
        riskScore: typeof entry.riskScore === 'number' ? entry.riskScore : null,
        hasInsurance: typeof entry.hasInsurance === 'boolean' ? entry.hasInsurance : null,
        endsAt: typeof entry.endsAt === 'string'
            ? entry.endsAt
            : typeof entry.endTime === 'string' ? entry.endTime : null,
    };
}

export function mapLocations(raw: unknown): ExpeditionLocation[] {
    const parsed = rawExpeditionConfigSchema.safeParse(raw);
    if (!parsed.success) return [];
    return (parsed.data.locations ?? []).map((location) => ({
        id: location.id ?? '',
        name: location.name ?? 'Location',
        zones: (location.zones ?? []).map((zone) => ({
            id: zone.id ?? '',
            name: zone.name ?? 'Zone',
            goals: (zone.goals ?? []).map((goal) => ({ id: goal.id ?? '', name: goal.name ?? 'Goal' })),
        })),
    }));
}

export function mapMercenaries(raw: unknown): ExpeditionMercenary[] {
    const parsed = rawMercenariesSchema.safeParse(raw);
    if (!parsed.success) return [];
    const mercs: { merc: NonNullable<ReturnType<typeof rawMercenariesSchema.parse>['mercenaries']>[number]; elite: boolean }[] = [];
    for (const merc of parsed.data.mercenaries ?? []) mercs.push({ merc, elite: false });
    for (const slot of parsed.data.eliteSlots ?? []) if (slot.mercenary) mercs.push({ merc: slot.mercenary, elite: true });
    const seen = new Set<string>();
    return mercs
        .filter(({ merc }) => {
            if (seen.has(merc.id)) return false;
            seen.add(merc.id);
            return true;
        })
        .map(({ merc, elite }) => ({
            id: merc.id,
            name: merc.callsign ?? merc.name ?? merc.id,
            level: merc.level ?? 0,
            rarity: merc.rarity ?? 'UNKNOWN',
            price: merc.price ?? 0,
            totalCost: merc.totalCost ?? null,
            riskScore: merc.riskScore ?? null,
            status: merc.status ?? 'UNKNOWN',
            faction: merc.faction?.label ?? merc.faction?.key ?? 'UNKNOWN',
            elite,
        }));
}

interface ExtractedExpeditions {
    readonly expeditions: readonly unknown[];
    readonly decisions: readonly RawDecision[];
}

function extractExpeditions(raw: unknown): ExtractedExpeditions {
    if (Array.isArray(raw)) return { expeditions: raw, decisions: [] };
    if (raw && typeof raw === 'object') {
        const entry = raw as {
            data?: unknown;
            expeditions?: unknown;
            active?: unknown;
            activeExpeditions?: unknown;
            expedition?: unknown;
            decisions?: unknown;
            id?: unknown;
        };
        if (entry.data !== undefined) return extractExpeditions(entry.data);
        const decisions = Array.isArray(entry.decisions) ? entry.decisions : [];
        if (Array.isArray(entry.expeditions)) {
            return { expeditions: entry.expeditions, decisions: decisions as RawDecision[] };
        }
        if (Array.isArray(entry.active)) {
            return { expeditions: entry.active, decisions: decisions as RawDecision[] };
        }
        if (Array.isArray(entry.activeExpeditions)) {
            return { expeditions: entry.activeExpeditions, decisions: decisions as RawDecision[] };
        }
        if (entry.expedition !== undefined && entry.expedition !== null) {
            return { expeditions: [entry.expedition], decisions: decisions as RawDecision[] };
        }
        if (typeof entry.id === 'string') {
            return { expeditions: [raw], decisions: decisions as RawDecision[] };
        }
        const values = Object.values(entry)
            .filter((value): value is Record<string, unknown> =>
                !!value
                && typeof value === 'object'
                && !Array.isArray(value)
                && ('id' in value || 'status' in value || 'locationName' in value));
        if (values.length > 0) return { expeditions: values, decisions: decisions as RawDecision[] };
    }
    const parsed = rawActiveExpeditionsSchema.safeParse(raw);
    return parsed.success
        ? { expeditions: parsed.data.expeditions ?? [], decisions: (parsed.data.decisions ?? []) as RawDecision[] }
        : { expeditions: [], decisions: [] };
}

function decisionsFromMessages(expeditions: readonly unknown[]): RawDecision[] {
    const result: RawDecision[] = [];
    for (const raw of expeditions) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const entry = raw as { id?: unknown; messages?: unknown };
        if (!Array.isArray(entry.messages)) continue;
        for (const rawMessage of entry.messages) {
            const message = rawDecisionSchema.safeParse(rawMessage);
            if (!message.success) continue;
            if (message.data.isResolved === true) continue;
            const hasOptions = (message.data.decisionOptions?.length ?? 0) > 0
                || (message.data.options?.length ?? 0) > 0;
            if (!hasOptions) continue;
            const deadline = message.data.decisionDeadline ? Date.parse(message.data.decisionDeadline) : Number.NaN;
            if (Number.isFinite(deadline) && deadline <= Date.now()) continue;
            result.push({
                ...message.data,
                expeditionId: typeof entry.id === 'string' ? entry.id : undefined,
                message: message.data.content ?? message.data.message,
            });
        }
    }
    return result;
}

export function mapExpeditionOverview(
    activeRaw: unknown,
    archivedRaw: unknown,
    mercenariesRaw: unknown,
    configRaw: unknown,
): ExpeditionOverview {
    const active = extractExpeditions(activeRaw);
    const archived = extractExpeditions(archivedRaw);
    const decisionMap = new Map<string, RawDecision>();
    for (const decision of [...active.decisions, ...archived.decisions, ...decisionsFromMessages(active.expeditions), ...decisionsFromMessages(archived.expeditions)]) {
        const key = `${decision.expeditionId ?? ''}:${decision.id ?? decision.messageId ?? ''}`;
        if (!decisionMap.has(key)) decisionMap.set(key, decision);
    }
    const mappedActive = active.expeditions.map(mapExpedition).filter((entry): entry is ActiveExpedition => entry !== null);
    const mappedArchived = archived.expeditions.map(mapExpedition).filter((entry): entry is ActiveExpedition => entry !== null);
    // Some game builds keep the in-progress expedition in the archived room
    // while the active room is momentarily empty. Surface those entries as
    // active rather than showing "No active expedition".
    const fromArchive = mappedArchived.filter((entry) => {
        const status = entry.status.toUpperCase();
        return !isExpeditionReady(entry) && !status.includes('FAILED') && !status.includes('EXPIRED');
    });
    const activeById = new Map(mappedActive.map((entry) => [entry.id, entry]));
    for (const entry of fromArchive) {
        if (entry.id.length > 0 && !activeById.has(entry.id)) activeById.set(entry.id, entry);
    }
    const archivedActiveIds = new Set(fromArchive.map((entry) => entry.id));
    const decisions = [...decisionMap.values()]
        .map(mapDecision)
        .filter((decision): decision is ExpeditionDecision => decision !== null);
    for (const decision of decisions) {
        if (decision.expeditionId.length === 0 || activeById.has(decision.expeditionId)) continue;
        activeById.set(decision.expeditionId, {
            id: decision.expeditionId,
            status: 'DECISION_PENDING',
            locationName: 'Unknown location',
            mercenaryName: null,
            totalCost: null,
            riskScore: null,
            hasInsurance: null,
            endsAt: null,
        });
    }
    return {
        active: [...activeById.values()],
        archived: mappedArchived.filter((entry) => !(entry.id.length > 0 && archivedActiveIds.has(entry.id))),
        mercenaries: mapMercenaries(mercenariesRaw),
        locations: mapLocations(configRaw),
        decisions,
    };
}
