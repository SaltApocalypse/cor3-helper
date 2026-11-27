import type { AutomationStateStore } from '../../../infrastructure/storage/automation-state-store.js';
import type { ExpeditionConfigCacheStore } from '../../../infrastructure/storage/expedition-config-cache-store.js';
import type { MarketCacheStore } from '../../../infrastructure/storage/market-cache-store.js';
import type { ExpeditionService } from '../../../application/expeditions/service.js';
import type { ExpeditionDecisionOption } from '../../../domains/expeditions/model.js';
import type { NetworkSnapshotService } from '../../../application/network/snapshot-service.js';
import type { AutomationLogger, EventPublisher, SchedulerPort, SettingsPort } from '../../../application/automation/ports.js';
import type { JobMarketSync } from './job-market-sync.js';
import type { JobRouting } from './job-routing.js';

/** Persisted keys used by the expedition easter egg and internal payout log. */
export const MYSTERY_EGG_STATE_KEY = 'auto-expedition-egg';
export const EXPEDITION_PAYOUT_STATE_KEY = 'auto-expedition-payout';

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
    readonly insuranceCost: number | null;
    readonly locationName: string;
}

export interface ExpeditionDecisionState {
    readonly id: string;
    readonly expeditionId: string;
    readonly message: string;
    readonly riskScore: number | null;
    readonly lootScore: number | null;
    readonly deadline: string | null;
    readonly firstSeenAt: number;
    readonly autoRespondAt: number | null;
    readonly options: readonly ExpeditionDecisionOption[];
    readonly mode: 'simple' | 'score';
    readonly policy: string;
    readonly lootWeight: number;
    readonly riskWeight: number;
    readonly chosenOptionId: string | null;
    readonly resolvedAt: number | null;
    readonly resolvedBy: 'manual' | 'auto' | null;
}

/** Mutable run state owned by AutoExpeditionCoordinator and shared with its runner. */
export interface ExpeditionRunState {
    running: boolean;
    last: AutoExpeditionLast | null;
    preparation: ExpeditionPreparation | null;
    preparationCancelled: boolean;
    lastViewAt: number;
    lastDecision: ExpeditionDecisionState | null;
}

export interface AutoExpeditionDeps {
    readonly settings: SettingsPort;
    readonly scheduler: SchedulerPort;
    readonly logger: AutomationLogger;
    readonly clock: { now(): number };
    readonly events: EventPublisher;
    readonly state: AutomationStateStore;
    readonly snapshots: Pick<NetworkSnapshotService, 'get'>;
    readonly service: Pick<ExpeditionService, 'autoRespond' | 'respond' | 'payout' | 'overview' | 'locations' | 'candidates' | 'configure' | 'launch'>;
    readonly configCache: ExpeditionConfigCacheStore;
    readonly marketCache: Pick<MarketCacheStore, 'get'>;
    readonly marketSync: Pick<JobMarketSync, 'fetchOptionsView'>;
    readonly routing: Pick<JobRouting, 'routeToServer'>;
    readonly runAutoMail: () => Promise<void>;
    readonly humanDelay?: (minMs?: number, maxMs?: number) => Promise<void>;
}
