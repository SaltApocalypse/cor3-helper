import type { MailAttachment, MailMessage, MailState } from '../../domains/mail/model.js';
import { rawMailStateSchema } from '../../contracts/mail.js';

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function asNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
    const parsed = Math.floor(asNumber(value, fallback));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
    return false;
}

function extractMessages(raw: unknown): unknown[] | null {
    if (Array.isArray(raw)) return raw;
    if (!isRecord(raw)) return null;
    if (Array.isArray(raw.messages)) return raw.messages;
    if (isRecord(raw.messages)) return Object.values(raw.messages);
    if (raw.mail !== undefined) {
        const nested = extractMessages(raw.mail);
        if (nested) return nested;
    }
    if (raw.data !== undefined) {
        const nested = extractMessages(raw.data);
        if (nested) return nested;
    }
    return null;
}

function extractPendingCount(raw: unknown): number | null {
    if (!isRecord(raw)) return null;
    if (raw.pendingCount !== undefined) return asNumber(raw.pendingCount, -1);
    if (raw.mail !== undefined) return extractPendingCount(raw.mail);
    if (raw.data !== undefined) return extractPendingCount(raw.data);
    return null;
}

function mapAttachment(raw: unknown): MailAttachment | null {
    if (!isRecord(raw)) return null;
    const id = asString(raw.id ?? raw.attachmentId);
    if (!id) return null;
    const itemId = asString(raw.itemId);
    return {
        id,
        source: asString(raw.source),
        sourceId: asString(raw.sourceId),
        name: asString(raw.name) ?? itemId ?? id,
        itemId,
        quantity: asPositiveInt(raw.quantity, 1),
        width: asPositiveInt(raw.width, 1),
        height: asPositiveInt(raw.height, 1),
        canRotate: asBoolean(raw.canRotate),
    };
}

function mapMessage(raw: unknown): MailMessage | null {
    if (!isRecord(raw)) return null;
    const id = asString(raw.id ?? raw.messageId ?? raw.mailId);
    if (!id) return null;
    const rawAttachments = Array.isArray(raw.attachments)
        ? raw.attachments
        : isRecord(raw.attachments) ? Object.values(raw.attachments) : [];
    return {
        id,
        status: asString(raw.status) ?? 'PENDING',
        subject: asString(raw.subject) ?? asString(raw.title) ?? 'Mail',
        attachments: rawAttachments
            .map(mapAttachment)
            .filter((attachment): attachment is MailAttachment => attachment !== null),
    };
}

export function describeMailPayload(raw: unknown): Record<string, unknown> {
    if (Array.isArray(raw)) {
        return { type: 'array', length: raw.length };
    }
    if (!isRecord(raw)) return { type: typeof raw };
    const rawMessages = extractMessages(raw);
    const first = rawMessages?.find(isRecord);
    const firstAttachments = first && Array.isArray(first.attachments) ? first.attachments : [];
    const firstAttachment = firstAttachments.find(isRecord);
    return {
        type: 'object',
        keys: Object.keys(raw).slice(0, 12),
        messages: Array.isArray(rawMessages) ? rawMessages.length : 'missing',
        messageKeys: first ? Object.keys(first).slice(0, 12) : [],
        attachmentKeys: firstAttachment ? Object.keys(firstAttachment).slice(0, 12) : [],
    };
}

export function mapMailState(raw: unknown): MailState | null {
    const parsed = rawMailStateSchema.safeParse(raw);
    if (!parsed.success) return null;
    const rawMessages = extractMessages(raw);
    if (rawMessages === null) {
        // An empty object is a valid "no mail" push in some game builds.
        if (isRecord(raw) && Object.keys(raw).length === 0) {
            return { messages: [], pendingCount: 0 };
        }
        return null;
    }
    const messages = rawMessages
        .map(mapMessage)
        .filter((message): message is MailMessage => message !== null);
    const explicitPending = extractPendingCount(raw);
    return {
        messages,
        pendingCount: explicitPending !== null && explicitPending >= 0
            ? explicitPending
            : messages.filter((message) => message.status !== 'CLAIMED').length,
    };
}
