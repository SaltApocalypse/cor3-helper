import type { RawNetworkMap } from '../../contracts/map.js';
import { rawNetworkMapSchema } from '../../contracts/map.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabNetworkMapAdapter {
    constructor(private readonly tabs: TabMessagePort) {}

    async getMap(): Promise<Result<RawNetworkMap, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_GET_MAP' });
            if (!response || typeof response !== 'object') {
                return err({ code: 'GAME_MAP_EMPTY', message: 'Content returned no map result' });
            }
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } | unknown };
            if (candidate.ok !== true) {
                const error = candidate.error && typeof candidate.error === 'object'
                    ? candidate.error as { code?: unknown; message?: unknown }
                    : null;
                return err({
                    code: typeof error?.code === 'string' ? error.code : 'GAME_MAP_FAILED',
                    message: typeof error?.message === 'string' ? error.message : 'Content map request failed',
                });
            }
            const parsed = rawNetworkMapSchema.safeParse(candidate.value);
            if (!parsed.success) return err({ code: 'GAME_MAP_INVALID', message: 'Content map failed schema validation' });
            return ok(parsed.data);
        } catch (error) {
            return err({ code: 'GAME_MAP_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
