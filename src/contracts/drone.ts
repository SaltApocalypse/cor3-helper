import { z } from 'zod';

export const rawDroneBatterySchema = z.object({
    current: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    restoreSeconds: z.number().nullable().optional(),
}).passthrough();

export const rawDroneSchema = z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    durability: z.number().nullable().optional(),
    maxDurability: z.number().nullable().optional(),
    isRepairing: z.boolean().nullable().optional(),
    isDestroyed: z.boolean().nullable().optional(),
    repairSecondsRemaining: z.number().nullable().optional(),
    battery: rawDroneBatterySchema.nullable().optional(),
}).passthrough();

export const rawDroneMissionSchema = z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    batteryCost: z.number().nullable().optional(),
    locationConfigId: z.string().nullable().optional(),
    missionConfigId: z.string().nullable().optional(),
    durationSeconds: z.number().nullable().optional(),
}).passthrough();
export const rawDroneLocationSchema = z.object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    baseRisk: z.number().nullable().optional(),
    missions: z.array(rawDroneMissionSchema).nullable().optional(),
}).passthrough();

export const rawDroneOptionsSchema = z.object({
    drone: rawDroneSchema.nullable().optional(),
    missions: z.array(rawDroneMissionSchema).nullable().optional(),
    availableMissions: z.array(rawDroneMissionSchema).nullable().optional(),
    locations: z.array(rawDroneLocationSchema).nullable().optional(),
    battery: rawDroneBatterySchema.nullable().optional(),
    activeMissionId: z.string().nullable().optional(),
    activeMission: z.object({
        id: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        drone: rawDroneSchema.nullable().optional(),
    }).passthrough().nullable().optional(),
}).passthrough();

export const rawDroneArchivedSchema = z.object({
    items: z.array(z.object({ id: z.string().optional(), name: z.string().optional() }).passthrough()).optional(),
}).passthrough();

export const rawDroneEventOptionSchema = z.object({
    id: z.string().optional(),
    label: z.string().optional(),
    lootDelta: z.number().optional(),
    riskDelta: z.number().optional(),
    effect: z.object({ lootDelta: z.number().optional(), riskDelta: z.number().optional() }).passthrough().optional(),
    requiredModuleId: z.string().optional(),
}).passthrough();

export const rawDroneEventSchema = z.object({
    missionId: z.string().optional(),
    eventId: z.string().optional(),
    type: z.string().optional(),
    event: z.object({
        eventId: z.string().optional(),
        missionId: z.string().optional(),
        type: z.string().optional(),
        isResolvable: z.boolean().optional(),
        isResolved: z.boolean().optional(),
        options: z.array(rawDroneEventOptionSchema).optional(),
    }).passthrough().optional(),
    options: z.array(rawDroneEventOptionSchema).optional(),
    mission: z.object({ id: z.string().optional(), missionId: z.string().optional() }).passthrough().optional(),
}).passthrough();
