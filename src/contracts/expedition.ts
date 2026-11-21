import { z } from 'zod';

export const rawGoalSchema = z.object({ id: z.string().nullable().optional(), name: z.string().nullable().optional() }).passthrough();
export const rawZoneSchema = z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    goals: z.array(rawGoalSchema).nullable().optional(),
}).passthrough();
export const rawLocationSchema = z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    zones: z.array(rawZoneSchema).nullable().optional(),
}).passthrough();
export const rawExpeditionConfigSchema = z.object({ locations: z.array(rawLocationSchema).nullable().optional() }).passthrough();

export const rawMercenarySchema = z.object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    callsign: z.string().nullable().optional(),
    level: z.number().nullable().optional(),
    rarity: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
    totalCost: z.number().nullable().optional(),
    riskScore: z.number().nullable().optional(),
    status: z.string().nullable().optional(),
    restUntil: z.string().nullable().optional(),
    faction: z.object({ key: z.string().nullable().optional(), label: z.string().nullable().optional() }).passthrough().nullable().optional(),
}).passthrough();
export const rawMercenariesSchema = z.object({
    mercenaries: z.array(rawMercenarySchema).nullable().optional(),
    eliteSlots: z.array(z.object({ mercenary: rawMercenarySchema.nullable().optional() }).passthrough()).nullable().optional(),
}).passthrough();

const rawDecisionOptionSchema = z.object({
    id: z.string().nullable().optional(),
    value: z.string().nullable().optional(),
    key: z.string().nullable().optional(),
    optionId: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    successChance: z.number().nullable().optional(),
    risk: z.number().nullable().optional(),
    loot: z.number().nullable().optional(),
    lootScore: z.number().nullable().optional(),
    lootValue: z.number().nullable().optional(),
    lootModifier: z.number().nullable().optional(),
    lootDelta: z.number().nullable().optional(),
    riskModifier: z.number().nullable().optional(),
    riskDelta: z.number().nullable().optional(),
    effect: z.object({ lootDelta: z.number().nullable().optional(), riskDelta: z.number().nullable().optional() }).passthrough().nullable().optional(),
    requiredModuleId: z.string().nullable().optional(),
    requiredModule: z.string().nullable().optional(),
}).passthrough();

export const rawDecisionSchema = z.object({
    id: z.string().nullable().optional(),
    expeditionId: z.string().nullable().optional(),
    messageId: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    riskScore: z.number().nullable().optional(),
    lootScore: z.number().nullable().optional(),
    loot: z.number().nullable().optional(),
    lootValue: z.number().nullable().optional(),
    selectedOption: z.string().nullable().optional(),
    decisionDeadline: z.string().nullable().optional(),
    isResolved: z.boolean().nullable().optional(),
    isAutoResolved: z.boolean().nullable().optional(),
    decisionOptions: z.array(rawDecisionOptionSchema).nullable().optional(),
    options: z.array(rawDecisionOptionSchema).nullable().optional(),
}).passthrough();

export const rawExpeditionSchema = z.object({
    id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    locationName: z.string().nullable().optional(),
    zoneName: z.string().nullable().optional(),
    mercenary: z.union([z.object({ callsign: z.string().nullable().optional(), name: z.string().nullable().optional() }).passthrough(), z.string()]).nullable().optional(),
    totalCost: z.number().nullable().optional(),
    riskScore: z.number().nullable().optional(),
    lootScore: z.number().nullable().optional(),
    lootValue: z.number().nullable().optional(),
    hasInsurance: z.boolean().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    decision: z.unknown().optional(),
    messages: z.array(z.unknown()).nullable().optional(),
}).passthrough();
export const rawActiveExpeditionsSchema = z.object({
    expeditions: z.array(rawExpeditionSchema).nullable().optional(),
    active: z.array(rawExpeditionSchema).nullable().optional(),
    decisions: z.array(rawDecisionSchema).nullable().optional(),
}).passthrough();
