import type { BridgeResult } from '../../../contracts/bridge.js';
import { ok } from '../../../kernel/result.js';
import { ChromeRuntimeBridgeTransport } from '../../../infrastructure/bridge/chrome-runtime-transport.js';
import { BridgeServer, type BridgeAuditEvent } from '../../../infrastructure/bridge/bridge-server.js';
import { BufferedLogger, ConsoleLogger, redact, type LogEvent } from '../../../infrastructure/logging/logger.js';
import { RunLogStore } from '../../../infrastructure/logging/run-log-store.js';
import { ChromeTabAuthAdapter } from '../../../infrastructure/auth/chrome-tab-auth-adapter.js';
import { ChromeTabsMessagePort } from '../../../infrastructure/auth/chrome-tabs-message-port.js';
import { UpdateChecker } from '../../../infrastructure/update/update-checker.js';
import { ChromeStorageArea } from '../../../infrastructure/storage/storage-area.js';
import { SettingsRepository } from '../../../infrastructure/storage/settings-repository.js';
import { AutoFinishStateStore } from '../../../infrastructure/storage/auto-finish-state-store.js';
import { AutoJobsSnapshotStore } from '../../../infrastructure/storage/auto-jobs-snapshot-store.js';
import { DailyOpsCacheStore } from '../../../infrastructure/storage/daily-ops-cache-store.js';
import { ChromeStorageMailSourceTracker } from '../../../infrastructure/storage/mail-source-store.js';
import { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import { FeatureAvailabilityStore } from '../../../infrastructure/storage/feature-availability-store.js';
import { ExpeditionConfigCacheStore } from '../../../infrastructure/storage/expedition-config-cache-store.js';
import { DroneDataCacheStore } from '../../../infrastructure/storage/drone-data-cache-store.js';
import { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import { JobHistoryStore } from '../../../infrastructure/storage/job-history-store.js';
import { NetworkSnapshotStore } from '../../../infrastructure/storage/network-snapshot-store.js';
import { NetworkOperationQueue } from '../../../application/network/operation-queue.js';
import type { EventPublisher } from '../../../application/automation/ports.js';

const manifest = chrome.runtime.getManifest();
export const VERSION = manifest.version_name ?? manifest.version;
export const PHASE = 'v2';

const SESSION_LOG_KEY = 'v2.sessionLogs';
const LOG_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface BackgroundEvent {
    readonly type: string;
    readonly at: number;
    readonly payload?: unknown;
}

export function isLogEvent(value: unknown): value is LogEvent {
    if (!value || typeof value !== 'object') return false;
    const entry = value as { at?: unknown; level?: unknown; scope?: unknown; message?: unknown };
    return typeof entry.at === 'number'
        && (entry.level === 'debug' || entry.level === 'info' || entry.level === 'warn' || entry.level === 'error')
        && typeof entry.scope === 'string'
        && typeof entry.message === 'string';
}

export function isFreshLogEvent(value: unknown): value is LogEvent {
    return isLogEvent(value) && Date.now() - value.at < LOG_RETENTION_MS;
}

export interface CoreRuntime {
    readonly logger: BufferedLogger;
    readonly runLogs: RunLogStore;
    readonly transport: ChromeRuntimeBridgeTransport;
    readonly server: BridgeServer;
    readonly bridgeAudits: BridgeAuditEvent[];
    readonly appVersion: () => string;
    readonly storageArea: ChromeStorageArea;
    readonly settings: SettingsRepository;
    readonly tabs: ChromeTabsMessagePort;
    readonly auth: ChromeTabAuthAdapter;
    readonly updateChecker: UpdateChecker;
    readonly networkOps: NetworkOperationQueue;
    readonly events: EventPublisher;
    readonly sessionLogArea: ChromeStorageArea | null;
    readonly sessionLogKey: string;
    readonly stores: {
        readonly autoFinish: AutoFinishStateStore;
        readonly autoJobsSnapshot: AutoJobsSnapshotStore;
        readonly mailSource: ChromeStorageMailSourceTracker;
        readonly marketCache: MarketCacheStore;
        readonly featureAvailability: FeatureAvailabilityStore;
        readonly expeditionConfigCache: ExpeditionConfigCacheStore;
        readonly droneDataCache: DroneDataCacheStore;
        readonly automationState: AutomationStateStore;
        readonly dailyOpsCache: DailyOpsCacheStore;
        readonly jobHistory: JobHistoryStore;
        readonly networkSnapshot: NetworkSnapshotStore;
    };
    readonly helperModeEnabled: () => Promise<boolean>;
    readonly helperModeError: { readonly code: 'HELPER_MODE'; readonly message: string };
    readonly runBridgeExclusive: <T>(
        request: { readonly owner: string; readonly reason: string; readonly priority?: number },
        run: () => Promise<BridgeResult<T>>,
    ) => Promise<BridgeResult<T>>;
    readonly syncAutoSolvers: (current: {
        readonly autoDecryptEnabled: boolean;
        readonly autoIceWallEnabled: boolean;
        readonly autoSimpleDecryptEnabled: boolean;
        readonly helperMode: boolean;
    }) => Promise<void>;
}

export function createCoreRuntime(): CoreRuntime {
    const sessionLogArea = chrome.storage.session ? new ChromeStorageArea(chrome.storage.session) : null;
    let sessionLogTimer: ReturnType<typeof setTimeout> | null = null;
    const persistSessionLogs = (): void => {
        if (!sessionLogArea || sessionLogTimer !== null) return;
        sessionLogTimer = setTimeout(() => {
            sessionLogTimer = null;
            void sessionLogArea.set({ [SESSION_LOG_KEY]: logger.events().filter(isFreshLogEvent) }).catch(() => undefined);
        }, 200);
    };
    const logger = new BufferedLogger(new ConsoleLogger(), 500, () => persistSessionLogs());
    if (sessionLogArea) {
        void sessionLogArea.get(SESSION_LOG_KEY).then((raw) => {
            const stored = raw[SESSION_LOG_KEY];
            if (Array.isArray(stored)) logger.hydrate(stored.filter(isFreshLogEvent));
        }).catch(() => undefined);
    }
    const runLogs = new RunLogStore();
    setInterval(() => {
        logger.prune(isFreshLogEvent);
    }, 60 * 60 * 1000);

    const transport = new ChromeRuntimeBridgeTransport('background');
    const bridgeAudits: BridgeAuditEvent[] = [];
    const server = new BridgeServer('background', logger, (event) => {
        let payloadPreview = '';
        try {
            payloadPreview = JSON.stringify(redact(event.payload)).slice(0, 1200);
        } catch {
            payloadPreview = '[unserializable]';
        }
        bridgeAudits.push({ ...event, payload: payloadPreview });
        if (bridgeAudits.length > 300) bridgeAudits.splice(0, bridgeAudits.length - 300);
    });

    const eventPorts = new Set<chrome.runtime.Port>();
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== 'v2-events') return;
        eventPorts.add(port);
        port.onDisconnect.addListener(() => eventPorts.delete(port));
        try {
            port.postMessage({ type: 'events.ready', at: Date.now() } satisfies BackgroundEvent);
        } catch {
            eventPorts.delete(port);
        }
    });

    const events: EventPublisher = {
        publish: (type, payload) => {
            const event: BackgroundEvent = { type, at: Date.now(), ...(payload !== undefined ? { payload } : {}) };
            for (const port of eventPorts) {
                try {
                    port.postMessage(event);
                } catch {
                    eventPorts.delete(port);
                }
            }
        },
    };

    const storageArea = new ChromeStorageArea(chrome.storage.local);
    const settings = new SettingsRepository(storageArea, undefined, logger);
    const HELPER_MODE_ERROR = { code: 'HELPER_MODE', message: 'Disable Helper Mode in Settings before starting automation' } as const;
    const helperModeEnabled = async (): Promise<boolean> => (await settings.get()).helperMode;

    const stores = {
        autoFinish: new AutoFinishStateStore(storageArea, undefined, logger),
        autoJobsSnapshot: new AutoJobsSnapshotStore(storageArea, undefined, logger),
        mailSource: new ChromeStorageMailSourceTracker(storageArea, undefined, logger),
        marketCache: new MarketCacheStore(storageArea, undefined, logger),
        featureAvailability: new FeatureAvailabilityStore(storageArea),
        expeditionConfigCache: new ExpeditionConfigCacheStore(storageArea),
        droneDataCache: new DroneDataCacheStore(storageArea),
        automationState: new AutomationStateStore(storageArea),
        dailyOpsCache: new DailyOpsCacheStore(storageArea),
        jobHistory: new JobHistoryStore(storageArea, undefined, logger),
        networkSnapshot: new NetworkSnapshotStore(storageArea, undefined, logger),
    } as const;

    const tabs = new ChromeTabsMessagePort();
    const auth = new ChromeTabAuthAdapter(tabs);
    const updateChecker = new UpdateChecker();
    const networkOps = new NetworkOperationQueue({
        onChange: (status) => events.publish('network.queue', status),
    });

    const syncAutoSolvers = async (current: {
        readonly autoDecryptEnabled: boolean;
        readonly autoIceWallEnabled: boolean;
        readonly autoSimpleDecryptEnabled: boolean;
        readonly helperMode: boolean;
    }): Promise<void> => {
        const tabId = await tabs.findCor3Tab();
        if (tabId === null) return;
        try {
            await tabs.send(tabId, {
                type: 'V2_SET_AUTO_SOLVERS',
                decrypt: current.autoDecryptEnabled && !current.helperMode,
                iceWall: current.autoIceWallEnabled && !current.helperMode,
                simpleDecrypt: current.autoSimpleDecryptEnabled && !current.helperMode,
            });
        } catch (error) {
            logger.warn('minigame', 'Failed to sync auto solver settings', { message: error instanceof Error ? error.message : String(error) });
        }
    };

    const runBridgeExclusive = async <T>(
        request: { readonly owner: string; readonly reason: string; readonly priority?: number },
        run: () => Promise<BridgeResult<T>>,
    ): Promise<BridgeResult<T>> => {
        const queued = await networkOps.enqueue<T, { readonly code: string; readonly message: string }>(request, run);
        if (!queued.ok) return { ok: false, error: { code: queued.error.code, message: queued.error.message } };
        return ok(queued.value);
    };

    return {
        logger,
        runLogs,
        transport,
        server,
        bridgeAudits,
        appVersion: () => VERSION,
        storageArea,
        settings,
        tabs,
        auth,
        updateChecker,
        networkOps,
        events,
        sessionLogArea,
        sessionLogKey: SESSION_LOG_KEY,
        stores,
        helperModeEnabled,
        helperModeError: HELPER_MODE_ERROR,
        runBridgeExclusive,
        syncAutoSolvers,
    };
}
