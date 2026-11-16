import type { Result } from '../../kernel/result.js';
import { sleep as defaultSleep } from '../../kernel/sleep.js';
import { err, ok } from '../../kernel/result.js';
import type { MailMessage, MailState } from '../../domains/mail/model.js';
import { isStashCapacityError, pendingMessages } from '../../domains/mail/model.js';
import { mapMailState, describeMailPayload } from './map.js';
import { planAttachmentPlacements } from './placement.js';
import type { InventoryStash } from '../../domains/inventory/model.js';

export interface MailPort {
    getMail(): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    claimAll(messageId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>>;
    claimItem(attachmentId: string, x: number, y: number, rotated: boolean): Promise<Result<void, { readonly code: string; readonly message: string }>>;
}

export interface MailClaimFailure {
    readonly messageId: string;
    readonly message: string;
}

export interface MailClaimResult {
    readonly claimed: number;
    readonly failed: readonly MailClaimFailure[];
    readonly stashFull: boolean;
    readonly fallbackUsed: boolean;
}

export interface MailStashPort {
    getStash(): Promise<Result<InventoryStash, { readonly code: string; readonly message: string }>>;
}

export interface MailSourceTracker {
    isClaimed(source: string, sourceId: string): Promise<boolean>;
    markClaimed(source: string, sourceId: string): Promise<void>;
}

interface ClaimOutcome {
    readonly ok: boolean;
    readonly message: string | null;
    readonly stashFull: boolean;
    readonly fallbackUsed: boolean;
}


/** v1 retries non-capacity claim failures up to three times with a growing delay. */
const MAX_CLAIM_ATTEMPTS = 3;

function claimStatusFromResult(value: unknown): { readonly ok: boolean; readonly message: string | null } {
    if (!value || typeof value !== 'object') return { ok: true, message: null };
    const data = value as { results?: unknown };
    if (!Array.isArray(data.results)) return { ok: true, message: null };
    const failed = data.results.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const status = (entry as { status?: unknown }).status;
        return typeof status === 'string' && status.toLowerCase() !== 'claimed';
    });
    if (!failed) return { ok: true, message: null };
    const entry = failed as { status?: unknown; message?: unknown };
    return {
        ok: false,
        message: typeof entry.message === 'string'
            ? entry.message
            : typeof entry.status === 'string' ? `Claim status: ${entry.status}` : 'Claim was rejected',
    };
}

export class MailService {
    constructor(
        private readonly mail: MailPort,
        private readonly stash?: MailStashPort,
        private readonly sourceTracker?: MailSourceTracker,
        private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
        private readonly claimGapMs = 0,
        private readonly onInvalidPayload?: (message: string, data: unknown) => void,
    ) {}

    async view(): Promise<Result<MailState, { readonly code: string; readonly message: string }>> {
        const raw = await this.mail.getMail();
        if (!raw.ok) return raw;
        const state = mapMailState(raw.value);
        if (!state) {
            this.onInvalidPayload?.('Mail payload failed schema validation', describeMailPayload(raw.value));
            return err({ code: 'MAIL_INVALID', message: 'Mail payload failed schema validation' });
        }
        return ok(state);
    }

    async claimMessage(messageId: string): Promise<Result<unknown, { readonly code: string; readonly message: string }>> {
        return this.mail.claimAll(messageId);
    }

    async claimPending(): Promise<Result<MailClaimResult, { readonly code: string; readonly message: string }>> {
        const view = await this.viewWithRetry();
        if (!view.ok) return view;
        return ok(await this.claimMessages(pendingMessages(view.value)));
    }

    async claimForSource(source: string, sourceId: string): Promise<Result<MailClaimResult, { readonly code: string; readonly message: string }>> {
        if (this.sourceTracker && await this.sourceTracker.isClaimed(source, sourceId)) {
            return ok({ claimed: 0, failed: [], stashFull: false, fallbackUsed: false });
        }
        const view = await this.viewWithRetry();
        if (!view.ok) return view;
        const matching = pendingMessages(view.value).filter((message) =>
            message.attachments.some((attachment) => attachment.source === source && attachment.sourceId === sourceId),
        );
        const result = await this.claimMessages(matching);
        // A partial claim (stash full or a failed attachment) must stay
        // retryable. Marking the source complete after one successful
        // attachment would hide the remaining loot from later passes.
        if (result.claimed > 0 && result.failed.length === 0 && !result.stashFull && this.sourceTracker) {
            await this.sourceTracker.markClaimed(source, sourceId);
        }
        return ok(result);
    }

    private async viewWithRetry(): Promise<Result<MailState, { readonly code: string; readonly message: string }>> {
        let result = await this.view();
        // Another stash/mail room request can briefly hold the room. v1
        // tolerated this through its persistent push-driven mailbox state.
        for (let attempt = 0; attempt < 2 && !result.ok; attempt++) {
            if (result.error.code !== 'MAIL_TIMEOUT' && result.error.code !== 'MAIL_BUSY' && result.error.code !== 'MAIL_FAILED') break;
            await this.sleep(1500 * (attempt + 1));
            result = await this.view();
        }
        return result;
    }

    private async claimMessages(messages: readonly MailMessage[]): Promise<MailClaimResult> {
        const failed: MailClaimFailure[] = [];
        let claimed = 0;
        let stashFull = false;
        let fallbackUsed = false;
        for (const [index, message] of messages.entries()) {
            if (index > 0 && this.claimGapMs > 0) await this.sleep(this.claimGapMs);
            let outcome: ClaimOutcome | null = null;
            for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
                outcome = await this.claimOne(message);
                if (outcome.ok || outcome.stashFull) break;
                if (attempt < MAX_CLAIM_ATTEMPTS - 1) await this.sleep(1500 * (attempt + 1));
            }
            if (outcome?.ok) {
                claimed++;
                if (outcome.fallbackUsed) fallbackUsed = true;
                continue;
            }
            failed.push({ messageId: message.id, message: outcome?.message ?? 'Claim failed' });
            if (outcome?.stashFull) {
                stashFull = true;
                break;
            }
        }
        return { claimed, failed, stashFull, fallbackUsed };
    }

    private async claimOne(message: MailMessage): Promise<ClaimOutcome> {
        const result = await this.claimMessage(message.id);
        if (result.ok) {
            const status = claimStatusFromResult(result.value);
            if (status.ok) return { ok: true, message: null, stashFull: false, fallbackUsed: false };
            return this.tryFallback(message, status.message);
        }
        if (isStashCapacityError(result.error.message) && this.stash) {
            return this.tryFallback(message, result.error.message);
        }
        return { ok: false, message: result.error.message, stashFull: false, fallbackUsed: false };
    }

    private async tryFallback(message: MailMessage, claimError: string | null): Promise<ClaimOutcome> {
        if (!this.stash) {
            return { ok: false, message: claimError ?? 'Claim failed', stashFull: false, fallbackUsed: false };
        }
        const stash = await this.stash.getStash();
        if (!stash.ok) {
            return { ok: false, message: stash.error.message, stashFull: false, fallbackUsed: false };
        }
        const placements = planAttachmentPlacements(stash.value, message.attachments);
        if (!placements || placements.length === 0) {
            return { ok: false, message: claimError ?? 'Stash is full', stashFull: true, fallbackUsed: false };
        }
        for (const placement of placements) {
            const item = await this.mail.claimItem(placement.attachmentId, placement.x, placement.y, placement.rotated);
            if (!item.ok) {
                return { ok: false, message: item.error.message, stashFull: false, fallbackUsed: false };
            }
        }
        return { ok: true, message: null, stashFull: false, fallbackUsed: true };
    }
}
