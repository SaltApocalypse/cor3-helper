import type { EndpointCommandPort } from '../../application/network/route-executor.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { ServerId } from '../../kernel/ids.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabEndpointCommandAdapter implements EndpointCommandPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async setEndpoint(serverId: ServerId): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_SET_ENDPOINT', serverId });
            if (!response || typeof response !== 'object') {
                return err({ code: 'ENDPOINT_COMMAND_FAILED', message: 'No endpoint result' });
            }
            const candidate = response as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(undefined);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'ENDPOINT_COMMAND_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'set.endpoint failed',
            });
        } catch (error) {
            return err({ code: 'ENDPOINT_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
