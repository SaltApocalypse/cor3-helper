import { z } from 'zod';

/**
 * Typed payload schemas for the versioned background ↔ content tab protocol.
 * The transport wraps `{ type, ...payload }` in `contracts/tab.ts`; the
 * receiving side validates the payload with these schemas before dispatch.
 */
const empty = z.object({}).strict();
const actionPayload = z.object({
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
}).strict();
const marketId = z.object({ marketId: z.string().min(1) }).strict();
const jobCommand = z.object({
    marketId: z.string().min(1),
    jobId: z.string().min(1),
}).strict();
const moduleConfig = z.object({ moduleConfigId: z.string().min(1) }).strict();

export const tabCommandSchemas = {
    V2_AUTH_STATUS: empty,
    V2_AUTH_EXECUTE: z.object({
        operation: z.enum(['dailyOps', 'dailyRewards']),
        payload: z.unknown().optional(),
    }).strict(),
    V2_GAME_READINESS: empty,
    V2_GET_MAP: empty,
    V2_CONNECT_IP: z.object({ ip: z.string().min(1) }).strict(),
    V2_SET_ENDPOINT: z.object({ serverId: z.string().min(1) }).strict(),
    V2_LOGIN_STATUS: z.object({ serverId: z.string().min(1) }).strict(),
    V2_LOGIN_WITH_ACCESS: z.object({
        serverId: z.string().min(1),
        accessGrantId: z.string().min(1),
    }).strict(),
    V2_HACK_START: z.object({ serverId: z.string().min(1) }).strict(),
    V2_JOB_ACTION: actionPayload,
    V2_JOB_TAKE: jobCommand,
    V2_JOB_COMPLETE: jobCommand,
    V2_JOB_DISMISS: jobCommand,
    V2_MINIGAME_LOCK: empty,
    V2_SOLVE_MINIGAME: z.object({ timeoutMs: z.number().int().positive().optional() }).strict(),
    V2_CANCEL_MINIGAME: empty,
    V2_SET_AUTO_SOLVERS: z.object({
        decrypt: z.boolean(),
        iceWall: z.boolean(),
        simpleDecrypt: z.boolean(),
    }).strict(),
    V2_DAILY_OPS_GET: empty,
    V2_DAILY_REWARDS_GET: empty,
    V2_DAILY_HACK: z.object({ timeoutMs: z.number().int().positive().optional() }).strict(),
    V2_DAILY_HACK_CANCEL: empty,
    V2_MAIL_GET: empty,
    V2_MAIL_CLAIM_ALL: z.object({ messageId: z.string().min(1) }).strict(),
    V2_MAIL_CLAIM_ITEM: z.object({
        attachmentId: z.string().min(1),
        x: z.number(),
        y: z.number(),
        rotated: z.boolean(),
    }).strict(),
    V2_STASH_GET: empty,
    V2_STASH_SELL: z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().positive(),
    }).strict(),
    V2_STASH_MOVE: z.object({
        itemId: z.string().min(1),
        location: z.enum(['stash', 'sorting_table']),
        x: z.number(),
        y: z.number(),
        rotated: z.boolean(),
    }).strict(),
    V2_REQUEST_MARKET_JOBS: marketId,
    V2_MARKET_OPTIONS: marketId,
    V2_FETCH_MARKET: marketId,
    V2_LOADOUT_GET: empty,
    V2_EQUIP_HARDWARE: moduleConfig,
    V2_EQUIP_SOFTWARE: moduleConfig,
    V2_UNEQUIP_SOFTWARE: moduleConfig,
    V2_SPECIALISTS_GET: empty,
    V2_SPECIALISTS_PURCHASE: z.object({
        specialistType: z.string().min(1),
        kind: z.string().min(1),
        level: z.number().int().nonnegative(),
        priceId: z.string().min(1),
    }).strict(),
    V2_DRONE_ACTION: actionPayload,
    V2_EXPEDITION_ACTION: actionPayload,
    V2_VALUABLE_ACTION: actionPayload,
    V2_WS_LOGS: empty,
    V2_CLEAR_WS_LOGS: empty,
    V2_WS_SEND: z.object({ message: z.string().min(1) }).strict(),
} as const;

export type TabCommandType = keyof typeof tabCommandSchemas;

export function parseTabCommand(type: string, payload: unknown): Record<string, unknown> | null {
    const schema = tabCommandSchemas[type as TabCommandType];
    if (!schema) return null;
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data as Record<string, unknown> : null;
}

export const contentNoticeSchemas = {
    V2_GAME_READY: z.object({ readiness: z.unknown() }).strict(),
    V2_MARKET_CACHE: z.object({ marketId: z.string().min(1), snapshot: z.unknown() }).strict(),
    V2_EXPEDITION_DECISIONS: z.object({ decisions: z.array(z.unknown()) }).strict(),
    V2_WS_NOTICE: z.object({
        level: z.string(),
        message: z.string(),
        data: z.unknown().optional(),
    }).strict(),
} as const;

export type ContentNoticeType = keyof typeof contentNoticeSchemas;

export function parseContentNotice(type: string, payload: unknown): Record<string, unknown> | null {
    const schema = contentNoticeSchemas[type as ContentNoticeType];
    if (!schema) return null;
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data as Record<string, unknown> : null;
}
