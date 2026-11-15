import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { ExpeditionConfigCacheStore } from '../../../infrastructure/storage/expedition-config-cache-store.js';
import type { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import type { ExpeditionService } from '../../../application/expeditions/service.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger, EventPublisher, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { JobMarketSync } from './job-market-sync.js';
import type { JobRouting } from './job-routing.js';

export interface AutoExpeditionLast {
    readonly at: number;
    readonly decisions: number;
    readonly launched: boolean;
    readonly error: string | null;
    readonly message?: string;
    readonly paid?: number;
    readonly selectedMerc?: string | null;
    readonly marketKey?: string | null;
}

export interface ExpeditionPreparation {
    readonly id: string;
    readonly startedAt: number;
    readonly until: number;
    readonly mercenaryName: string;
    readonly marketKey: string;
    readonly marketLabel: string;
    readonly totalCost: number;
    readonly riskScore: number;
    readonly insurance: boolean;
    readonly locationName: string;
}

/** Mutable run state owned by AutoExpeditionCoordinator and shared with its runner. */
export interface ExpeditionRunState {
    running: boolean;
    last: AutoExpeditionLast | null;
    preparation: ExpeditionPreparation | null;
    preparationCancelled: boolean;
    lastViewAt: number;
}

export interface AutoExpeditionDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly logger: AutomationLogger;
    readonly clock: { now(): number };
    readonly events: EventPublisher;
    readonly state: AutomationStateStore;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly service: Pick<ExpeditionService, 'autoRespond' | 'payout' | 'overview' | 'locations' | 'candidates' | 'configure' | 'launch'>;
    readonly configCache: ExpeditionConfigCacheStore;
    readonly marketCache: Pick<MarketCacheStore, 'get'>;
    readonly marketSync: Pick<JobMarketSync, 'fetchOptionsView'>;
    readonly routing: Pick<JobRouting, 'routeToServer'>;
    readonly runAutoMail: () => Promise<void>;
    readonly humanDelay?: (minMs?: number, maxMs?: number) => Promise<void>;
}
