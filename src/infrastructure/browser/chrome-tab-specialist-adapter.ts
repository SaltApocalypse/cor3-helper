import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabSpecialistAdapter {
    constructor(private readonly tabs: TabMessagePort) {}

    getState(): Promise<Result<unknown, GameError>> {
        return this.action({ type: 'V2_SPECIALISTS_GET' });
    }

    purchase(purchase: import('../../domains/specialists/model.js').SpecialistPurchase): Promise<Result<void, GameError>> {
        return this.action({ type: 'V2_SPECIALISTS_PURCHASE', ...purchase }).then((result) => result.ok ? ok(undefined) : result);
    }

    private async action(message: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, message);
            if (!response || typeof response !== 'object') return err({ code: 'SPECIALIST_FAILED', message: 'No specialist result' });
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'SPECIALIST_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Specialist command failed',
            });
        } catch (error) {
            return err({ code: 'SPECIALIST_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
