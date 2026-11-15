import { z } from 'zod';

/**
 * The specialist payload is tolerant because the game uses `null` for missing
 * values (expiry, grace period, price ids) and occasionally numbers for
 * timestamps. A strict schema here made the whole feature look unavailable
 * whenever one optional field was null.
 */
const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const timestamp = z.union([z.string(), z.number()]).nullable().optional();

export const rawSpecialistPriceSchema = z.object({
    id: nullableString,
    credits: nullableNumber,
    items: z.array(z.unknown()).nullable().optional(),
}).passthrough();

export const rawTemporarySpecialistSchema = z.object({
    owned: z.boolean().nullable().optional(),
    expiresAt: timestamp,
    gracePeriodEndAt: timestamp,
    bonusSlots: nullableNumber,
    kind: nullableString,
    level: nullableNumber,
    status: nullableString,
    prices: z.array(rawSpecialistPriceSchema.nullable()).nullable().optional(),
}).passthrough();

export const rawSpecialistSchema = z.object({
    id: nullableString,
    name: nullableString,
    type: nullableString,
    specialistType: nullableString,
    temporary: z.array(rawTemporarySpecialistSchema.nullable()).nullable().optional(),
}).passthrough();

export const rawSpecialistStateSchema = z.object({
    specialists: z.array(rawSpecialistSchema.nullable()).nullable().optional(),
}).passthrough();
