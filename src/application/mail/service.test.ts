import { describe, expect, it } from 'vitest';
import { MailService, type MailPort, type MailStashPort } from './service.js';

function message(id: string, attachmentId: string) {
    return {
        id,
        status: 'PENDING',
        subject: 'Reward',
        attachments: [{
            id: attachmentId,
            source: 'EXPEDITION',
            sourceId: 'exp-1',
            name: 'Loot',
            itemId: 'item-1',
            quantity: 1,
            width: 1,
            height: 1,
            canRotate: false,
        }],
    };
}

const mailState = {
    messages: [message('m1', 'a1'), message('m2', 'a2')],
    pendingCount: 2,
};

const stash: MailStashPort = {
    getStash: async () => ({
        ok: true,
        value: {
            gridWidth: 12,
            usableRows: 10,
            items: [],
        },
    }),
};

describe('MailService', () => {
    it('claims every pending message', async () => {
        const claimed: string[] = [];
        const port: MailPort = {
            getMail: async () => ({ ok: true, value: mailState }),
            claimAll: async (messageId) => {
                claimed.push(messageId);
                return { ok: true, value: { results: [{ attachmentId: `a-${messageId}`, status: 'claimed' }] } };
            },
            claimItem: async () => ({ ok: true, value: undefined }),
        };
        const service = new MailService(port, stash, undefined, async () => undefined, 0);
        const result = await service.claimPending();
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value.claimed).toBe(2);
        expect(claimed).toEqual(['m1', 'm2']);
    });

    it('retries transient claim failures like v1', async () => {
        let attempts = 0;
        const port: MailPort = {
            getMail: async () => ({ ok: true, value: { messages: [message('m1', 'a1')], pendingCount: 1 } }),
            claimAll: async () => {
                attempts++;
                return attempts === 1
                    ? { ok: false, error: { code: 'MAIL_FAILED', message: 'temporary failure' } }
                    : { ok: true, value: { results: [{ status: 'claimed' }] } };
            },
            claimItem: async () => ({ ok: true, value: undefined }),
        };
        const service = new MailService(port, stash, undefined, async () => undefined, 0);
        const result = await service.claimPending();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.claimed).toBe(1);
            expect(result.value.failed).toEqual([]);
        }
        expect(attempts).toBe(2);
    });

    it('falls back to explicit placement when claim.all reports a rejected result', async () => {
        const placed: string[] = [];
        const port: MailPort = {
            getMail: async () => ({ ok: true, value: { messages: [message('m1', 'a1')], pendingCount: 1 } }),
            claimAll: async () => ({ ok: true, value: { results: [{ attachmentId: 'a1', status: 'rejected' }] } }),
            claimItem: async (attachmentId) => {
                placed.push(attachmentId);
                return { ok: true, value: undefined };
            },
        };
        const service = new MailService(port, stash, undefined, async () => undefined, 0);
        const result = await service.claimPending();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.claimed).toBe(1);
            expect(result.value.fallbackUsed).toBe(true);
        }
        expect(placed).toEqual(['a1']);
    });

    it('recognises the game stash-capacity errors used by the fallback path', async () => {
        const port: MailPort = {
            getMail: async () => ({ ok: true, value: { messages: [message('m1', 'a1')], pendingCount: 1 } }),
            claimAll: async () => ({ ok: false, error: { code: 'MAIL_FAILED', message: 'stash.error.insufficient' } }),
            claimItem: async () => ({ ok: true, value: undefined }),
        };
        const service = new MailService(port, stash, undefined, async () => undefined, 0);
        const result = await service.claimPending();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.claimed).toBe(1);
            expect(result.value.fallbackUsed).toBe(true);
        }
    });
});
