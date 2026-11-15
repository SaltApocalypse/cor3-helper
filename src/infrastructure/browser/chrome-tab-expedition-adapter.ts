import type { ExpeditionLaunchConfig, ExpeditionPort } from '../../application/expeditions/service.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabExpeditionAdapter implements ExpeditionPort {
    constructor(private readonly tabs: TabMessagePort) {}

    getActive(): Promise<Result<unknown, GameError>> { return this.action('getActive', {}); }
    getArchived(): Promise<Result<unknown, GameError>> { return this.action('getArchived', { cursor: null, limit: 20 }); }
    getMercenaries(marketId: string): Promise<Result<unknown, GameError>> { return this.action('getMercenaries', { marketId }); }
    getConfig(marketId: string): Promise<Result<unknown, GameError>> { return this.action('getConfig', { marketId }); }

    async respond(expeditionId: string, messageId: string, optionId: string): Promise<Result<void, GameError>> {
        const result = await this.action('respondEvent', { expeditionId, messageId, selectedOption: optionId });
        return result.ok ? ok(undefined) : result;
    }

    async configure(config: ExpeditionLaunchConfig): Promise<Result<unknown, GameError>> {
        return this.action('configure', config as unknown as Record<string, unknown>);
    }

    async launch(config: ExpeditionLaunchConfig): Promise<Result<void, GameError>> {
        const result = await this.action('launch', config as unknown as Record<string, unknown>);
        return result.ok ? ok(undefined) : result;
    }

    async openContainer(expeditionId: string): Promise<Result<void, GameError>> {
        const result = await this.action('openContainer', { expeditionId });
        return result.ok ? ok(undefined) : result;
    }

    private async action(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_EXPEDITION_ACTION', kind, payload });
            if (!response || typeof response !== 'object') return err({ code: 'EXPEDITION_FAILED', message: 'No expedition result' });
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'EXPEDITION_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Expedition command failed',
            });
        } catch (error) {
            return err({ code: 'EXPEDITION_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
