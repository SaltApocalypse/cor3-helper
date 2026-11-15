import { gameReadinessSchema, type GameReadiness } from '../../application/game/readiness.js';

interface TabPort {
    findCor3Tab(): Promise<number | null>;
    send(tabId: number, message: unknown): Promise<unknown>;
}

export class ChromeTabGameReadinessAdapter {
    constructor(private readonly tabs: TabPort) {}

    async read(): Promise<{ readonly tabId: number; readonly readiness: GameReadiness } | null> {
        const tabId = await this.tabs.findCor3Tab();
        if (tabId === null) return null;
        try {
            const response = await this.tabs.send(tabId, { type: 'V2_GAME_READINESS' });
            if (!response || typeof response !== 'object') return null;
            const candidate = response as { ok?: unknown; value?: unknown };
            if (candidate.ok !== true) return null;
            const parsed = gameReadinessSchema.safeParse(candidate.value);
            return parsed.success ? { tabId, readiness: parsed.data } : null;
        } catch {
            return null;
        }
    }
}
