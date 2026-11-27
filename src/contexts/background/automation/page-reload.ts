import type { SettingsPort, AutomationLogger, EventPublisher } from '../../../application/automation/ports.js';
import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';

const PAGE_RELOAD_STATE_KEY = 'page-reload';
const PAGE_RELOAD_WINDOW_MS = 10 * 60_000;
const PAGE_RELOAD_MAX_ATTEMPTS = 2;

interface PageReloadState {
    readonly windowStartedAt: number;
    readonly attempts: number;
    readonly pending: boolean;
    readonly tabId: number | null;
    readonly reason: string | null;
    readonly requestedAt: number | null;
}

function readState(value: unknown): PageReloadState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (typeof entry.windowStartedAt !== 'number' || typeof entry.attempts !== 'number') return null;
    return {
        windowStartedAt: entry.windowStartedAt,
        attempts: entry.attempts,
        pending: entry.pending === true,
        tabId: typeof entry.tabId === 'number' ? entry.tabId : null,
        reason: typeof entry.reason === 'string' ? entry.reason : null,
        requestedAt: typeof entry.requestedAt === 'number' ? entry.requestedAt : null,
    };
}

export interface PageReloadDeps {
    readonly tabs: {
        findCor3Tab(): Promise<number | null>;
        reload(tabId: number): Promise<void>;
    };
    readonly settings: SettingsPort;
    readonly state: AutomationStateStore;
    readonly autoJobs: {
        isRunning(): boolean;
        cancel(): void;
        resetAfterPageReload(): void;
        ensureInfo(reason: string, force?: boolean, tabIdHint?: number, forceAll?: boolean): Promise<void>;
    };
    readonly autoFinish: {
        isRunning(): boolean;
        cancel(): Promise<void>;
        runExclusive?: (owner: string, options: { readonly forceRefresh?: boolean }) => Promise<unknown>;
    };
    readonly logger: AutomationLogger;
    readonly events: EventPublisher;
    readonly clock: { now(): number };
}

/**
 * Owns the guarded page reload used when a minigame room stops responding.
 * Reloads are limited to automation runs and to two attempts in a ten-minute
 * window so a broken game build cannot trap the tab in a reload loop.
 */
export class PageReloadCoordinator {
    private reloading = false;

    constructor(private readonly deps: PageReloadDeps) {}

    async request(reason: string, kind: string | null = null): Promise<boolean> {
        const now = this.deps.clock.now();
        const stored = await this.deps.state.get(PAGE_RELOAD_STATE_KEY);
        const previous = readState(stored.payload.pageReload);
        if (this.reloading) {
            // A page that never reports readiness must not disable recovery
            // forever. Two minutes is well beyond a normal cor3.gg reload.
            if (!previous?.pending || previous.requestedAt === null || now - previous.requestedAt < 2 * 60_000) return false;
            this.reloading = false;
        }
        const current = await this.deps.settings.get();
        if (current.helperMode || (!current.autoJobsEnabled && !current.autoFinishEnabled)) return false;
        if (!this.deps.autoJobs.isRunning() && !this.deps.autoFinish.isRunning()) return false;
        const withinWindow = previous !== null && now - previous.windowStartedAt < PAGE_RELOAD_WINDOW_MS;
        const attempts = withinWindow ? previous.attempts : 0;
        if (withinWindow && attempts >= PAGE_RELOAD_MAX_ATTEMPTS) {
            this.deps.logger.warn('auto-jobs', 'Page reload skipped: cooldown attempt limit reached', {
                reason,
                kind,
                attempts,
            });
            return false;
        }

        const tabId = await this.deps.tabs.findCor3Tab();
        if (tabId === null) return false;

        const next: PageReloadState = {
            windowStartedAt: withinWindow ? (previous?.windowStartedAt ?? now) : now,
            attempts: attempts + 1,
            pending: true,
            tabId,
            reason,
            requestedAt: now,
        };
        await this.deps.state.set(PAGE_RELOAD_STATE_KEY, {
            phase: 'waiting',
            runId: null,
            nextActionAt: null,
            lastError: null,
            payload: { pageReload: next },
        });
        this.deps.autoJobs.cancel();
        await this.deps.autoFinish.cancel();
        this.reloading = true;
        this.deps.logger.warn('auto-jobs', 'Reloading game tab to recover a stuck minigame room', {
            tabId,
            reason,
            kind,
            attempt: next.attempts,
        });
        try {
            await this.deps.tabs.reload(tabId);
            return true;
        } catch (error) {
            this.reloading = false;
            this.deps.logger.error('auto-jobs', 'Game tab reload failed', {
                tabId,
                message: error instanceof Error ? error.message : String(error),
            });
            await this.deps.state.set(PAGE_RELOAD_STATE_KEY, {
                phase: 'idle',
                lastError: error instanceof Error ? error.message : String(error),
                payload: { pageReload: { ...next, pending: false } },
            });
            return false;
        }
    }

    /** Called after the reloaded page reports game readiness. */
    async handleGameReady(tabId: number): Promise<void> {
        const stored = await this.deps.state.get(PAGE_RELOAD_STATE_KEY);
        const previous = readState(stored.payload.pageReload);
        if (!previous?.pending) return;
        if (previous.tabId !== null && previous.tabId !== tabId) return;

        this.reloading = false;
        this.deps.autoJobs.resetAfterPageReload();
        await this.deps.state.set(PAGE_RELOAD_STATE_KEY, {
            phase: 'idle',
            runId: null,
            nextActionAt: null,
            lastError: null,
            payload: { pageReload: { ...previous, pending: false } },
        });
        this.deps.logger.info('auto-jobs', 'Reloaded game tab is ready; resuming automation', {
            tabId,
            reason: previous.reason,
            attempt: previous.attempts,
        });
        this.deps.events.publish('game.reload.completed', {
            tabId,
            reason: previous.reason,
            attempts: previous.attempts,
        });
        const current = await this.deps.settings.get();
        if (current.autoJobsEnabled) {
            void this.deps.autoJobs.ensureInfo('reload-ready', true, tabId, true);
        } else if (current.autoFinishEnabled && this.deps.autoFinish.runExclusive) {
            void this.deps.autoFinish.runExclusive('reload-ready', { forceRefresh: true });
        }
    }
}
