import type { JobCommandPort } from '../../application/auto-job/ports.js';
import type { GameError } from '../../application/game/ports.js';
import { err, ok, type Result } from '../../kernel/result.js';
import type { TabMessagePort } from '../auth/chrome-tab-auth-adapter.js';

export class ChromeTabJobCommandAdapter implements JobCommandPort {
    constructor(private readonly tabs: TabMessagePort) {}

    take(marketId: string, jobId: string): Promise<Result<void, GameError>> {
        return this.command('V2_JOB_TAKE', marketId, jobId);
    }

    complete(marketId: string, jobId: string): Promise<Result<void, GameError>> {
        return this.command('V2_JOB_COMPLETE', marketId, jobId);
    }

    dismiss(marketId: string, jobId: string): Promise<Result<void, GameError>> {
        return this.command('V2_JOB_DISMISS', marketId, jobId);
    }

    private async command(type: string, marketId: string, jobId: string): Promise<Result<void, GameError>> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return err({ code: 'NO_COR3_TAB', message: 'No cor3.gg tab found' });
        try {
            const response = await this.tabs.send(tabId, { type, marketId, jobId });
            if (!response || typeof response !== 'object') {
                return err({ code: 'JOB_COMMAND_FAILED', message: 'No job result', unconfirmed: true });
            }
            const candidate = response as { ok?: unknown; error?: { code?: unknown; message?: unknown; unconfirmed?: unknown } };
            if (candidate.ok === true) return ok(undefined);
            const code = typeof candidate.error?.code === 'string' ? candidate.error.code : 'JOB_COMMAND_FAILED';
            return err({
                code,
                message: typeof candidate.error?.message === 'string' ? candidate.error.message : 'Job command failed',
                ...(code === 'JOB_COMMAND_FAILED' || candidate.error?.unconfirmed === true ? { unconfirmed: true } : {}),
            });
        } catch (error) {
            return err({ code: 'JOB_COMMAND_FAILED', message: error instanceof Error ? error.message : String(error), unconfirmed: true });
        }
    }
}
