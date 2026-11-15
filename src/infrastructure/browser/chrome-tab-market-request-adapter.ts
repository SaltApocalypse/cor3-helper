import type { MarketRequestPort } from '../../application/network/market-path.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabMarketRequestAdapter implements MarketRequestPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async requestMarket(marketId: string): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_REQUEST_MARKET_JOBS', marketId });
            if (!response || typeof response !== 'object') {
                return err({ code: 'MARKET_COMMAND_FAILED', message: 'No market result' });
            }
            const candidate = response as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(undefined);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'MARKET_COMMAND_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Market request failed',
            });
        } catch (error) {
            return err({ code: 'MARKET_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
