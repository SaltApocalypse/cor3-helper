import type { DiscoveryCommandPort } from '../../application/network/discovery.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabDiscoveryCommandAdapter implements DiscoveryCommandPort {
    constructor(private readonly tabs: TabMessagePort) {}

    async connectIp(ip: string): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_CONNECT_IP', ip });
            if (!response || typeof response !== 'object') {
                return err({ code: 'DISCOVERY_COMMAND_FAILED', message: 'Content returned no connect.ip result' });
            }
            const candidate = response as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(undefined);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'DISCOVERY_COMMAND_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'connect.ip failed',
            });
        } catch (error) {
            return err({ code: 'DISCOVERY_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
