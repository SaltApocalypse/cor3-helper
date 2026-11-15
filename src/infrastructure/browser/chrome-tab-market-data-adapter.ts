import type { RawMarketSnapshot } from '../../contracts/market.js';
import { rawMarketSnapshotSchema } from '../../contracts/market.js';
import type { MarketSnapshotPort } from '../../application/network/market-sync.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabMarketDataAdapter implements MarketSnapshotPort {
    private readonly pending = new Map<string, Promise<Result<RawMarketSnapshot, GameError>>>();

    constructor(private readonly tabs: TabMessagePort) {}

    fetchMarket(marketId: string): Promise<Result<RawMarketSnapshot, GameError>> {
        const existing = this.pending.get(marketId);
        if (existing) return existing;
        const pending = this.readMarket(marketId);
        this.pending.set(marketId, pending);
        return pending.finally(() => {
            if (this.pending.get(marketId) === pending) this.pending.delete(marketId);
        });
    }

    private async readMarket(marketId: string): Promise<Result<RawMarketSnapshot, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_FETCH_MARKET', marketId });
            if (!response || typeof response !== 'object') {
                return err({ code: 'MARKET_COMMAND_FAILED', message: 'No market result' });
            }
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok !== true) {
                return err({
                    code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'MARKET_COMMAND_FAILED',
                    message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Market fetch failed',
                });
            }
            const parsed = rawMarketSnapshotSchema.safeParse(candidate.value);
            if (!parsed.success) return err({ code: 'MARKET_INVALID', message: 'Market data failed schema validation' });
            return ok(parsed.data);
        } catch (error) {
            return err({ code: 'MARKET_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
