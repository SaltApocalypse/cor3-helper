import type { GameReadiness } from '../../../application/game/readiness.js';
import type { ChromeTabGameReadinessAdapter } from '../../../infrastructure/browser/chrome-tab-game-readiness-adapter.js';
import type { EventPublisher, SettingsPort } from '../../../application/automation/ports.js';
import type { AutoJobsCoordinator } from './auto-jobs.js';

export interface PreferredTabPort {
    getPreferredTabId(): number | null;
    setPreferredTabId(tabId: number | null): void;
}

export interface ReadinessDeps {
    readonly adapter: Pick<ChromeTabGameReadinessAdapter, 'read'>;
    readonly tabs: PreferredTabPort;
    readonly settings: SettingsPort;
    readonly events: EventPublisher;
    readonly autoJobs: Pick<AutoJobsCoordinator, 'ensureInfo' | 'scheduleNextRefresh' | 'allMarketsCompletedForCurrentReset'>;
    readonly syncAutoSolvers: (current: {
        readonly autoDecryptEnabled: boolean;
        readonly autoIceWallEnabled: boolean;
        readonly autoSimpleDecryptEnabled: boolean;
        readonly helperMode: boolean;
    }) => Promise<void>;
    /** Called when a game tab becomes ready; loadout/inventory may have changed. */
    readonly onReady?: (tabId: number) => void;
}

/** Sole owner of per-tab game readiness and duplicate ready notices. */
export class ReadinessRegistry {
    private readonly readinessByTab = new Map<number, GameReadiness>();
    private readonly autoReadyKeys = new Set<string>();

    constructor(private readonly deps: ReadinessDeps) {}

    summary(): readonly { readonly tabId: number; readonly readiness: GameReadiness }[] {
        return [...this.readinessByTab.entries()].map(([tabId, readiness]) => ({ tabId, readiness }));
    }

    async handle(tabId: number, readiness: GameReadiness): Promise<void> {
        this.readinessByTab.set(tabId, readiness);
        this.deps.events.publish('game.readiness', { tabId, readiness });
        if (!readiness.ready || readiness.readyAt === null) {
            if (this.deps.tabs.getPreferredTabId() === tabId) this.deps.tabs.setPreferredTabId(null);
            return;
        }
        this.deps.tabs.setPreferredTabId(tabId);
        const key = `${tabId}:${readiness.readyAt}`;
        if (this.autoReadyKeys.has(key)) return;
        this.autoReadyKeys.add(key);
        this.deps.onReady?.(tabId);
        void this.deps.settings.get().then(this.deps.syncAutoSolvers);
        while (this.autoReadyKeys.size > 50) {
            const oldest = this.autoReadyKeys.values().next().value;
            if (oldest === undefined) break;
            this.autoReadyKeys.delete(oldest);
        }
        if (!this.deps.autoJobs.allMarketsCompletedForCurrentReset()) void this.deps.autoJobs.ensureInfo('ready', true, tabId);
        else void this.deps.autoJobs.scheduleNextRefresh();
    }

    async refreshFromTab(): Promise<void> {
        const snapshot = await this.deps.adapter.read();
        if (snapshot) await this.handle(snapshot.tabId, snapshot.readiness);
    }

    removeTab(tabId: number): void {
        this.readinessByTab.delete(tabId);
        if (this.deps.tabs.getPreferredTabId() === tabId) this.deps.tabs.setPreferredTabId(null);
        this.deps.events.publish('game.readiness', { tabId, readiness: null });
    }
}
