import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabDailyOpsAdapter {
    constructor(private readonly tabs: TabMessagePort) {}

    async getDailyOps(): Promise<Result<unknown, GameError>> {
        return this.request({ type: 'V2_DAILY_OPS_GET' });
    }

    async getRewards(): Promise<Result<unknown, GameError>> {
        return this.request({ type: 'V2_DAILY_REWARDS_GET' });
    }

    async solveHack(): Promise<Result<unknown, GameError>> {
        return this.request({ type: 'V2_DAILY_HACK' });
    }

    async cancelHack(): Promise<Result<void, GameError>> {
        const result = await this.request({ type: 'V2_DAILY_HACK_CANCEL' });
        return result.ok ? ok(undefined) : result;
    }

    private async request(message: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, message);
            if (!response || typeof response !== 'object') return err({ code: 'DAILY_FAILED', message: 'No daily ops result' });
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'DAILY_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Daily ops command failed',
            });
        } catch (error) {
            return err({ code: 'DAILY_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
