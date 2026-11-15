import { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import { NetworkDiscoveryService } from '../../../application/network/discovery.js';
import { InMemoryEndpointLeaseService } from '../../../application/network/endpoint-lease.js';
import { InMemoryEndpointMutex } from '../../../application/network/endpoint-mutex.js';
import { RouteExecutor } from '../../../application/network/route-executor.js';
import { MarketPathService } from '../../../application/network/market-path.js';
import { MarketSyncService } from '../../../application/network/market-sync.js';
import { LoadoutService } from '../../../application/loadout/service.js';
import { InventorySortService } from '../../../application/inventory/sorter.js';
import { InventoryFilterSellService, InventoryItemSellService } from '../../../application/inventory/batch.js';
import { MailService } from '../../../application/mail/service.js';
import { ExpeditionService } from '../../../application/expeditions/service.js';
import { DroneService } from '../../../application/drone/service.js';
import { DroneAutoService } from '../../../application/drone/auto.js';
import { ValuableSellerService } from '../../../application/valuable/seller.js';
import { DismissFailedJobsService } from '../../../application/auto-job/dismiss.js';
import { SystemClock } from '../../../kernel/clock.js';
import { asServerId } from '../../../kernel/ids.js';
import { ok } from '../../../kernel/result.js';
import { ChromeTabGameReadinessAdapter } from '../../../infrastructure/browser/chrome-tab-game-readiness-adapter.js';
import { ChromeStorageDiscoveryProgressStore } from '../../../infrastructure/storage/discovery-progress-store.js';
import { ChromeTabNetworkMapAdapter } from '../../../infrastructure/browser/chrome-tab-network-map-adapter.js';
import { ChromeTabNetworkSnapshotAdapter } from '../../../infrastructure/browser/chrome-tab-network-snapshot-adapter.js';
import { ChromeTabDiscoveryCommandAdapter } from '../../../infrastructure/browser/chrome-tab-discovery-command-adapter.js';
import { ChromeTabEndpointCommandAdapter } from '../../../infrastructure/browser/chrome-tab-endpoint-command-adapter.js';
import { ChromeTabServerAccessAdapter } from '../../../infrastructure/browser/chrome-tab-server-access-adapter.js';
import { ChromeTabMarketRequestAdapter } from '../../../infrastructure/browser/chrome-tab-market-request-adapter.js';
import { ChromeTabMarketDataAdapter } from '../../../infrastructure/browser/chrome-tab-market-data-adapter.js';
import { ChromeTabLoadoutAdapter } from '../../../infrastructure/browser/chrome-tab-loadout-adapter.js';
import { ChromeTabJobCommandAdapter } from '../../../infrastructure/browser/chrome-tab-job-command-adapter.js';
import { ChromeTabJobActionAdapter } from '../../../infrastructure/browser/chrome-tab-job-action-adapter.js';
import { ChromeTabMinigameAdapter } from '../../../infrastructure/browser/chrome-tab-minigame-adapter.js';
import { ChromeTabValuableActionAdapter } from '../../../infrastructure/browser/chrome-tab-valuable-action-adapter.js';
import { ChromeTabInventoryAdapter } from '../../../infrastructure/browser/chrome-tab-inventory-adapter.js';
import { ChromeTabMailAdapter } from '../../../infrastructure/browser/chrome-tab-mail-adapter.js';
import { ChromeTabDailyOpsAdapter } from '../../../infrastructure/browser/chrome-tab-daily-ops-adapter.js';
import { ChromeTabSpecialistAdapter } from '../../../infrastructure/browser/chrome-tab-specialist-adapter.js';
import { ChromeTabExpeditionAdapter } from '../../../infrastructure/browser/chrome-tab-expedition-adapter.js';
import { ChromeTabDroneAdapter } from '../../../infrastructure/browser/chrome-tab-drone-adapter.js';
import type { CoreRuntime } from './core.js';

export interface GameRuntime {
    readonly snapshots: NetworkSnapshotService;
    readonly networkMap: ChromeTabNetworkMapAdapter;
    readonly marketPath: MarketPathService;
    readonly marketSync: MarketSyncService;
    readonly discovery: NetworkDiscoveryService;
    readonly endpointLeases: InMemoryEndpointLeaseService;
    readonly endpointMutex: InMemoryEndpointMutex;
    readonly routeExecutor: RouteExecutor;
    readonly endpointCommands: ChromeTabEndpointCommandAdapter;
    readonly serverAccess: ChromeTabServerAccessAdapter;
    readonly loadout: LoadoutService;
    readonly loadoutAdapter: ChromeTabLoadoutAdapter;
    readonly jobCommands: ChromeTabJobCommandAdapter;
    readonly jobActions: ChromeTabJobActionAdapter;
    readonly dismissFailedJobs: DismissFailedJobsService;
    readonly inventoryAdapter: ChromeTabInventoryAdapter;
    readonly inventorySorter: InventorySortService;
    readonly inventoryFilterSell: InventoryFilterSellService;
    readonly inventoryItemSell: InventoryItemSellService;
    readonly mailService: MailService;
    readonly dailyOpsAdapter: ChromeTabDailyOpsAdapter;
    readonly specialistAdapter: ChromeTabSpecialistAdapter;
    readonly expeditionAdapter: ChromeTabExpeditionAdapter;
    readonly expeditionService: ExpeditionService;
    readonly droneAdapter: ChromeTabDroneAdapter;
    readonly droneService: DroneService;
    readonly droneAuto: DroneAutoService;
    readonly minigames: ChromeTabMinigameAdapter;
    readonly valuableAdapter: ChromeTabValuableActionAdapter;
    readonly valuableSeller: ValuableSellerService;
    readonly gameReadinessAdapter: ChromeTabGameReadinessAdapter;
}

export function createGameRuntime(core: CoreRuntime): GameRuntime {
    const { logger, tabs, storageArea, stores } = core;

    const gameReadinessAdapter = new ChromeTabGameReadinessAdapter(tabs);
    const networkMap = new ChromeTabNetworkMapAdapter(tabs);
    const snapshots = new NetworkSnapshotService(
        new ChromeTabNetworkSnapshotAdapter(networkMap, { now: () => Date.now() }),
        new SystemClock(),
        {
            ttlMs: 15000,
            fallbackMaxAgeMs: 30 * 60_000,
            logger,
            onUpdate: (snapshot) => stores.networkSnapshot.set(snapshot),
        },
    );
    void stores.networkSnapshot.get().then((snapshot) => {
        if (snapshot) snapshots.hydrate(snapshot);
    }).catch((error: unknown) => {
        logger.warn('network', 'Failed to restore network snapshot', { message: error instanceof Error ? error.message : String(error) });
    });
    const endpointLeases = new InMemoryEndpointLeaseService(new SystemClock());
    const endpointMutex = new InMemoryEndpointMutex();
    const loadoutAdapter = new ChromeTabLoadoutAdapter(tabs);
    const loadout = new LoadoutService(loadoutAdapter, loadoutAdapter, undefined, (message, data) => logger.info('loadout', message, data));
    const jobCommands = new ChromeTabJobCommandAdapter(tabs);
    const dismissFailedJobs = new DismissFailedJobsService({
        dismiss: (job) => jobCommands.dismiss(job.marketId, job.id),
    });
    const inventoryAdapter = new ChromeTabInventoryAdapter(tabs);
    const inventorySorter = new InventorySortService(inventoryAdapter, undefined, 250);
    const inventoryFilterSell = new InventoryFilterSellService(inventoryAdapter, undefined, 800, 200);
    const inventoryItemSell = new InventoryItemSellService(inventoryAdapter);
    const mailAdapter = new ChromeTabMailAdapter(tabs);
    const mailService = new MailService(mailAdapter, inventoryAdapter, stores.mailSource, undefined, 650, (message, data) => logger.warn('auto-mail', message, data));
    const dailyOpsAdapter = new ChromeTabDailyOpsAdapter(tabs);
    const specialistAdapter = new ChromeTabSpecialistAdapter(tabs);
    const expeditionAdapter = new ChromeTabExpeditionAdapter(tabs);
    const expeditionService = new ExpeditionService(expeditionAdapter, undefined, (message, data) => logger.info('auto-expedition', message, data));
    const droneAdapter = new ChromeTabDroneAdapter(tabs);
    const droneService = new DroneService(droneAdapter, stores.droneDataCache);
    const droneAuto = new DroneAutoService(droneService, (message, data) => logger.info('auto-drone', message, data));
    const minigames = new ChromeTabMinigameAdapter(tabs);
    const serverAccess = new ChromeTabServerAccessAdapter(tabs, undefined, loadout, minigames);
    const endpointCommands = new ChromeTabEndpointCommandAdapter(tabs);
    const routeExecutor = new RouteExecutor(endpointCommands, serverAccess, endpointLeases, new SystemClock(), endpointMutex);
    const valuableAdapter = new ChromeTabValuableActionAdapter(tabs);
    const valuableSeller = new ValuableSellerService(
        snapshots,
        routeExecutor,
        valuableAdapter,
        valuableAdapter,
        new SystemClock(),
        async (serverId, serverTypeName) => {
            const result = await loadout.ensure({ ability: 'SEARCH', target: serverTypeName ?? serverId, requiredPower: 0 });
            if (!result.ok) {
                // v1 kept scanning with the current loadout when no matching
                // SEARCH software was owned. Skipping the server would hide
                // valuable files that the equipped loadout can still reveal.
                logger.warn('valuable', `SEARCH loadout unavailable for ${serverTypeName ?? serverId}; continuing with the current loadout`, {
                    code: result.error.code,
                    message: result.error.message,
                });
            }
            return ok(undefined);
        },
        undefined,
        {
            ensureAccess: (serverId, context) => serverAccess.ensureAccess(asServerId(serverId), context),
        },
    );
    const marketPath = new MarketPathService(snapshots, routeExecutor, new ChromeTabMarketRequestAdapter(tabs), new SystemClock());
    const marketSync = new MarketSyncService(snapshots, routeExecutor, new ChromeTabMarketDataAdapter(tabs), new SystemClock());
    const discovery = new NetworkDiscoveryService(snapshots, new ChromeTabDiscoveryCommandAdapter(tabs), new ChromeStorageDiscoveryProgressStore(storageArea), new SystemClock(), undefined, endpointLeases);

    return {
        snapshots,
        networkMap,
        marketPath,
        marketSync,
        discovery,
        endpointLeases,
        endpointMutex,
        routeExecutor,
        endpointCommands,
        serverAccess,
        loadout,
        loadoutAdapter,
        jobCommands,
        jobActions: new ChromeTabJobActionAdapter(tabs),
        dismissFailedJobs,
        inventoryAdapter,
        inventorySorter,
        inventoryFilterSell,
        inventoryItemSell,
        mailService,
        dailyOpsAdapter,
        specialistAdapter,
        expeditionAdapter,
        expeditionService,
        droneAdapter,
        droneService,
        droneAuto,
        minigames,
        valuableAdapter,
        valuableSeller,
        gameReadinessAdapter,
    };
}
