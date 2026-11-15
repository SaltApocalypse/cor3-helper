import { z } from 'zod';

/**
 * Mail payloads are game data, not an API we control. The live game has
 * changed field types before (numeric ids, string quantities, null attachment
 * arrays), so the boundary schema stays deliberately permissive and the mapper
 * normalises each value. A malformed individual message/attachment is skipped
 * instead of rejecting the whole mailbox.
 */
const looseAttachmentSchema = z.record(z.string(), z.unknown());
const looseMessageSchema = z.record(z.string(), z.unknown());

const looseStateSchema = z.object({
    messages: z.array(z.unknown()).nullish(),
    pendingCount: z.union([z.number(), z.string()]).nullish(),
}).passthrough();

export const rawMailStateSchema = z.union([
    z.array(z.unknown()),
    looseStateSchema,
    // Some builds wrap the state under `mail` or `data`.
    z.object({
        mail: z.union([z.array(z.unknown()), looseStateSchema]),
    }).passthrough(),
    z.object({
        data: z.union([z.array(z.unknown()), looseStateSchema]),
    }).passthrough(),
]);

export type RawMailState = z.infer<typeof rawMailStateSchema>;
export type RawMailMessage = z.infer<typeof looseMessageSchema>;
export type RawMailAttachment = z.infer<typeof looseAttachmentSchema>;
