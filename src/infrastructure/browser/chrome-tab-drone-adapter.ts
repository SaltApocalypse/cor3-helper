import type { DronePort } from '../../application/drone/service.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabDroneAdapter implements DronePort {
    constructor(private readonly tabs: TabMessagePort) {}

    getOptions(): Promise<Result<unknown, GameError>> { return this.action('getOptions', {}); }
    getArchived(): Promise<Result<unknown, GameError>> { return this.action('getArchived', { cursor: null, limit: 20 }); }
    getLatestEvent(): Promise<Result<unknown, GameError>> { return this.action('getEvent', {}); }
    getCompleted(): Promise<Result<unknown, GameError>> { return this.action('getCompleted', {}); }
    async launch(locationConfigId: string, missionConfigId: string): Promise<Result<void, GameError>> {
        const result = await this.action('launch', { locationConfigId, missionConfigId });
        return result.ok ? ok(undefined) : result;
    }
    async resolve(eventId: string, optionId: string): Promise<Result<void, GameError>> {
        const result = await this.action('resolveEvent', { eventId, optionId });
        return result.ok ? ok(undefined) : result;
    }
    async repair(targetDurability: number): Promise<Result<void, GameError>> {
        const result = await this.action('repair', { targetDurability });
        return result.ok ? ok(undefined) : result;
    }

    private async action(kind: string, payload: Record<string, unknown>): Promise<Result<unknown, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_DRONE_ACTION', kind, payload });
            if (!response || typeof response !== 'object') return err({ code: 'DRONE_FAILED', message: 'No drone result' });
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok === true) return ok(candidate.value);
            return err({
                code: typeof candidate.error?.code === 'string' ? candidate.error.code : 'DRONE_FAILED',
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Drone command failed',
            });
        } catch (error) {
            return err({ code: 'DRONE_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
