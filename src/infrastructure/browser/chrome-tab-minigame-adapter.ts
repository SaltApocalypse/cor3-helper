import type { MinigameOutcome, MinigamePort } from '../../application/auto-job/minigame-port.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabMinigameAdapter implements MinigamePort {
    constructor(private readonly tabs: TabMessagePort) {}

    async solve(timeoutMs = 180_000): Promise<Result<MinigameOutcome, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_SOLVE_MINIGAME', timeoutMs });
            if (!response || typeof response !== 'object') {
                return err({ code: 'MINIGAME_FAILED', message: 'No minigame result' });
            }
            const candidate = response as { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } };
            if (candidate.ok !== true) {
                const error = candidate.error as { code?: unknown; message?: unknown; retryAt?: unknown; lockExpiresAt?: unknown } | undefined;
                return err({
                    code: typeof error?.code === 'string' ? error.code : 'MINIGAME_FAILED',
                    message: typeof error?.message === 'string' ? error.message : 'Minigame failed',
                    ...(typeof error?.retryAt === 'number' ? { retryAt: error.retryAt } : {}),
                    ...(typeof error?.lockExpiresAt === 'number' ? { lockExpiresAt: error.lockExpiresAt } : {}),
                });
            }
            const value = candidate.value as { kind?: unknown; solved?: unknown; message?: unknown } | null;
            const kind = value?.kind;
            if (kind !== 'simple-decrypt' && kind !== 'config-hack' && kind !== 'ice-wall' && kind !== 'none') {
                return err({ code: 'MINIGAME_INVALID', message: 'Unknown minigame result' });
            }
            return ok({
                kind,
                solved: value?.solved === true,
                ...(typeof value?.message === 'string' ? { message: value.message } : {}),
            });
        } catch (error) {
            return err({ code: 'MINIGAME_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }

    async cancel(): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_CANCEL_MINIGAME' });
            return response && typeof response === 'object' && (response as { ok?: unknown }).ok === true
                ? ok(undefined)
                : err({ code: 'MINIGAME_CANCEL_FAILED', message: 'Could not cancel minigame' });
        } catch (error) {
            return err({ code: 'MINIGAME_CANCEL_FAILED', message: error instanceof Error ? error.message : String(error) });
        }
    }
}
