import type { MailPort } from '../../application/mail/service.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabMailAdapter implements MailPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async getMail(): Promise<Result<unknown, GameError>> {
        return this.request({ type: 'V2_MAIL_GET' }, 25000);
    }

    async claimAll(messageId: string): Promise<Result<unknown, GameError>> {
        return this.request({ type: 'V2_MAIL_CLAIM_ALL', messageId }, 20000);
    }

    async claimItem(attachmentId: string, x: number, y: number, rotated: boolean): Promise<Result<void, GameError>> {
        const result = await this.request({ type: 'V2_MAIL_CLAIM_ITEM', attachmentId, x, y, rotated }, 20000);
        return result.ok ? ok(undefined) : result;
    }

    private async request(message: Record<string, unknown>, timeoutMs: number): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const response = await Promise.race([
                this.tabs.send(tabId, message),
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`Mail command timed out after ${timeoutMs}ms`)), timeoutMs);
                }),
            ]).finally(() => {
                if (timer !== undefined) clearTimeout(timer);
            });
            if (!response || typeof response !== 'object') return err({ code: 'MAIL_FAILED', message: 'No mail result' });
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'MAIL_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Mail command failed',
            });
        } catch (error) {
            return err({
                code: 'MAIL_FAILED',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
