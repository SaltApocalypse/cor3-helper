import type { BridgeResult } from '../../contracts/bridge.js';
import type { AutoJobsSkippedJob } from '../../contracts/auto-jobs.js';
import type { AuthStatus, SettingsPatch, SettingsV1 } from '../../contracts/storage.js';
import type { NetworkMapSummary } from '../network/summary.js';
import type { DiscoveryResult } from '../network/discovery.js';
import type { GameReadiness } from '../game/readiness.js';
import type { NetworkOperationQueueStatus } from '../network/operation-queue.js';

import type { JobOffer } from '../../domains/jobs/model.js';
import type { JobMarketDefinition } from '../../domains/jobs/markets.js';
import type { MarketReputation, MarketView } from '../../domains/markets/model.js';
import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import type { SpecialistPurchase, SpecialistState } from '../../domains/specialists/model.js';
import type { ExpeditionOverview } from '../../domains/expeditions/model.js';
import type { ExpeditionDecisionOption } from '../../domains/expeditions/model.js';

import type { DroneState } from '../../domains/drone/model.js';
import type { LoadoutView } from '../loadout/view.js';
import type { LoadoutDumpFile } from '../../contracts/loadout.js';

export type { LoadoutView } from '../loadout/view.js';

import type { AutoFinishFailure, AutoFinishLastRun, AutoFinishMarketResult, AutoFinishRunResult, AutoFinishUnknownJob } from '../../contracts/auto-finish.js';
import type { AutoJobsMarketSelection, AutoJobsSnapshot } from '../../contracts/auto-jobs.js';
import type { MarketCompletedJobsState } from '../../contracts/market-completed-jobs.js';
import type { UpdateCheckResult } from '../../contracts/update-check.js';

export type { AutoFinishFailure, AutoFinishLastRun, AutoFinishMarketResult, AutoFinishRunResult, AutoFinishUnknownJob, AutoJobsSnapshot, MarketCompletedJobsState };

export interface JobRouteNode {
    readonly id: string;
    readonly name: string;
}

export interface JobMarketSyncResult {
    readonly route: readonly JobRouteNode[];
    readonly jobs: readonly JobOffer[];
    readonly skipped: number;
    readonly failed?: number;
    readonly expired?: number;
    readonly skippedJobs?: readonly AutoJobsSkippedJob[];
    readonly resetAt: string | null;
}

export interface DismissFailedSummary {
    readonly dismissed: number;
    readonly failed: number;
    readonly markets: readonly string[];
    readonly errors: readonly string[];
}

export interface JobMarketFailure {
    readonly marketKey: string;
    readonly label: string;
    readonly ok: false;
    readonly skipped: number;
    readonly failed?: number;
    readonly expired?: number;
    readonly skippedJobs?: readonly AutoJobsSkippedJob[];
    readonly error: string;
    readonly errorCode?: string;
}

export interface JobAllMarketsResult {
    readonly jobs: readonly JobOffer[];
    readonly markets: readonly ({
        readonly marketKey: string;
        readonly label: string;
        readonly ok: true;
        readonly skipped: number;
        readonly failed?: number;
        readonly expired?: number;
        readonly skippedJobs?: readonly AutoJobsSkippedJob[];
        readonly resetAt: string | null;
    } | JobMarketFailure)[];
}

export interface JobQueueFailure {
    readonly jobId: string;
    readonly name: string;
    readonly serverName: string | null;
    /** Market-scoped identity; failure must not be mapped by jobId alone. */
    readonly marketKey: string;
    readonly code: string;
    readonly message: string;
    readonly retryable?: boolean;
    readonly unconfirmed?: boolean;
    readonly retryAt?: number;
    readonly lockExpiresAt?: number;
    readonly stage?: string;
}

export interface JobQueueResult {
    readonly stopped: boolean;
    /** Market-scoped job identity strings (`jobIdentityKey`), not raw job ids. */
    readonly done: readonly string[];
    readonly failed: readonly JobQueueFailure[];
}

export interface JobHistoryEntry {
    readonly jobId: string;
    readonly name: string;
    readonly type: string;
    readonly serverName: string | null;
    /** Optional for legacy history entries; new entries carry market identity. */
    readonly marketKey?: string;
    readonly status: 'done' | 'failed' | 'retry';
    readonly at: number;
    readonly error?: string;
}

export interface JobQueueProgress {
    readonly index: number;
    readonly total: number;
    readonly jobId: string;
    readonly jobName: string;
    readonly marketKey: string;
    readonly serverName: string | null;
    readonly doneCount: number;
    readonly failedCount: number;
}

export interface DailyHackResult {
    readonly solved: boolean;
    readonly puzzle: string;
    readonly message: string;
}

export interface MailClaimResult {
    readonly claimed: number;
    readonly failed: readonly { readonly messageId: string; readonly message: string }[];
    readonly stashFull: boolean;
    readonly fallbackUsed: boolean;
}

export interface CachedMarketView {
    readonly at: number;
    readonly view: MarketView;
}

export interface MarketOptionsView {
    readonly marketId: string;
    readonly marketName: string;
    readonly credits: number;
    readonly reputation: MarketReputation | null;
}

export interface ActivityProgress {
    readonly index: number;
    readonly total: number;
    readonly label: string;
}

export interface ActivityState {
    readonly key: 'idle' | 'auto-jobs' | 'auto-finish' | 'auto-daily' | 'auto-drone' | 'auto-expedition' | 'auto-mail' | 'valuable-seller' | 'auto-refresh' | 'network';
    readonly label: string;
    readonly detail: string;
    readonly running: boolean;
    readonly progress: ActivityProgress | null;
}

export interface NetworkDiagnostics {
    readonly serverCount: number;
    readonly connectionCount: number;
    readonly hiddenEdgeCount: number;
    readonly maintenanceCount: number;
    readonly endpointCapableCount: number;
    readonly accessibleCount: number;
    readonly endpointId: string | null;
    readonly homeId: string;
    readonly snapshotAgeMs?: number | null;
    readonly snapshotCapturedAt?: number;
    readonly maintenance: readonly { readonly id: string; readonly name: string; readonly endsAt: string | null }[];
}

export interface AutoDailyStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly last: { readonly at: number; readonly solved: boolean; readonly puzzle: string; readonly message: string } | null;
    readonly nextRunAt: number | null;
    readonly nextRunReason: string | null;
    readonly alarmAt: number | null;
    readonly hasClaimedToday: boolean | null;
    readonly nextTaskTime: string | null;
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

export interface ExpeditionDecisionView {
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

export interface AutoExpeditionStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly available: boolean;
    readonly dataStale: boolean;
    readonly preparation: ExpeditionPreparation | null;
    readonly decision: ExpeditionDecisionView | null;
    readonly last: {
        readonly at: number;
        readonly decisions: number;
        readonly launched: boolean;
        readonly error: string | null;
        readonly message?: string;
        readonly paid?: number;
        readonly selectedMerc?: string | null;
        readonly marketKey?: string | null;
    } | null;
}

export interface AutoMailStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly last: { readonly at: number; readonly claimed: number; readonly failed: number; readonly stashFull: boolean; readonly error: string | null } | null;
}

export interface AutoDroneStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly available: boolean;
    readonly dataStale: boolean;
    readonly last: { readonly at: number; readonly status: string; readonly message: string } | null;
}

export interface DroneAutoResult {
    readonly status: 'launched' | 'repaired' | 'idle' | 'blocked' | 'completed' | 'rate-limited' | 'insufficient-credits';
    readonly message: string;
    readonly missionId: string | null;
    readonly retryAfterMs?: number;
    readonly blockedReason?: 'no-drone' | 'destroyed' | 'repairing' | 'active-mission' | 'no-mission';
    readonly eventId?: string;
}

export interface LoadoutApplyResult {
    readonly ability: 'HACK' | 'DECRYPT' | 'SEARCH';
    readonly target: string;
    readonly power: number;
    readonly requiredPower: number;
    readonly feasible: boolean;
    readonly softwareName: string;
    readonly policyId: string;
    readonly policyVersion: number;
}

export interface InventoryItemView {
    readonly id: string;
    readonly name: string;
    readonly tier: string;
    readonly quantity: number;
    readonly sellPrice: number;
    readonly canSell: boolean;
    readonly canCraft: boolean;
    readonly canUse: boolean;
    readonly tags: readonly string[];
    readonly width: number;
    readonly height: number;
    readonly x: number | null;
    readonly y: number | null;
    readonly itemConfigId: string | null;
    readonly imageUrl: string | null;
    readonly description: string | null;
}

export interface InventorySummary {
    readonly items: number;
    readonly gridWidth: number | null;
    readonly usableRows: number | null;
    readonly maxCapacity: number | null;
    readonly currentUsage: number | null;
    readonly rental: { readonly status: string | null; readonly expiresAt: string | null; readonly gracePeriodEndAt: string | null } | null;
}

export interface InventoryProtectedItemView {
    readonly itemId: string;
    readonly name: string;
    readonly tier: string;
    readonly quantity: number;
    readonly sellValue: number;
    readonly reason: 'craft' | 'high-tier' | 'not-sellable' | 'no-price';
}

export interface InventoryPreviewResult {
    readonly stacks: number;
    readonly quantity: number;
    readonly value: number;
    readonly protectedStacks: number;
    readonly protectedQuantity: number;
    readonly protectedValue: number;
    readonly protected: readonly InventoryProtectedItemView[];
}

export interface InventoryFilterResult {
    readonly soldStacks: number;
    readonly soldQuantity: number;
    readonly sellValue: number;
    readonly protectedStacks: number;
    readonly protectedValue: number;
    readonly failed: readonly { readonly itemId: string; readonly message: string }[];
    readonly mailClaimed?: number;
}

export interface InventoryItemSellResult {
    readonly itemId: string;
    readonly name: string;
    readonly quantity: number;
    readonly sellValue: number;
}

export interface InventoryView {
    readonly summary: InventorySummary;
    readonly items: readonly InventoryItemView[];
    readonly sortingTableItems: number;
}

export interface InventorySortResult {
    readonly mode: 'smart' | 'compact';
    readonly moves: number;
    readonly fallback: boolean;
    readonly notice: string | null;
}

export interface AutoFinishLiveRun {
    readonly runId: string;
    readonly startedAt: number;
    readonly markets: readonly AutoFinishMarketResult[];
}

export interface AutoJobsStatus {
    readonly enabled: boolean;
    readonly intervalMinutes: number;
    readonly running: boolean;
    readonly stage: string;
    readonly nextRefreshAt: number | null;
    readonly refreshReason: 'interval' | 'reset' | 'fallback';
    readonly scheduleState: 'scheduled' | 'repair-pending' | 'repairing' | 'schedule-unavailable' | 'disabled';
    readonly repairAt: number | null;
    readonly lastRefreshAt: number | null;
    readonly snapshotAt: number | null;
    /** Active minigame locks: market-scoped job identity -> expiry. */
    readonly locks: Readonly<Record<string, number>>;
    /** Per-job retry budget for the current reset, keyed by market-scoped identity. */
    readonly retryAttempts: Readonly<Record<string, { readonly count: number; readonly lastAttemptAt: number }>>;
    /** Due/forced decision for every known market on the next refresh. */
    readonly marketSelection: readonly AutoJobsMarketSelection[];
    readonly lastSkipReason: string | null;
}

export interface AutoFinishStatus {
    readonly enabled: boolean;
    readonly running: boolean;
    readonly currentRunId: string | null;
    readonly live: AutoFinishLiveRun | null;
    readonly last: AutoFinishLastRun | null;
    readonly progress: JobQueueProgress | null;
    readonly nextRetryAt: number | null;
    readonly retryReason: string | null;
    /** Authoritative market-scoped completion state. */
    readonly completedJobsByMarket: MarketCompletedJobsState;
    /** Legacy jobId-only records; display/diagnostics only. */
    readonly legacyCompletedJobs: Readonly<Record<string, string>>;
    readonly completionStateStatus: 'not-loaded' | 'loaded' | 'unavailable';
    /** Durable per-job Complete-Unknown projection. */
    readonly unknownJobs: readonly AutoFinishUnknownJob[];
    /** Availability of the Unknown projection sources. */
    readonly unknownStateStatus: 'loaded' | 'partial' | 'unavailable';
}

export interface JobQueueState {
    readonly runId: string;
    readonly status: 'running' | 'done' | 'cancelled' | 'error';
    readonly progress: JobQueueProgress | null;
    /** Market-scoped identity strings (`jobIdentityKey`). */
    readonly done: readonly string[];
    readonly failed: readonly JobQueueFailure[];
    readonly error: string | null;
    readonly updatedAt: number;
}


export interface NetworkServerSummary {
    readonly id: string;
    readonly name: string;
    readonly ip: string | null;
    readonly typeName: string | null;
    readonly access: string;
    readonly maintenanceActive: boolean;
}

export interface ValuableProgress {
    readonly phase: 'server' | 'download' | 'market' | 'sell';
    readonly target: string;
    readonly index: number;
    readonly total: number;
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
    readonly soldItems: number;
}

export interface ValuableSearchResult {
    readonly stopped: boolean;
    readonly serversScanned: number;
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
    readonly failedDownloads: number;
    readonly serverFailures: readonly { readonly target: string; readonly message: string }[];
}

export interface ValuableSaleResult {
    readonly stopped: boolean;
    readonly marketsChecked: number;
    readonly soldItems: number;
    readonly credits: number;
    readonly reputation: number;
    readonly marketFailures: readonly { readonly target: string; readonly message: string }[];
}

export interface ValuableReport {
    readonly downloadedFiles: number;
    readonly downloadedLogs: number;
    readonly soldItems: number;
    readonly credits: number;
    readonly reputation: number;
    readonly unsoldItems: number;
    readonly lastSearchAt: number | null;
    readonly lastSellAt: number | null;
    readonly active: ValuableRunState | null;
}

export interface ValuableRunState {
    readonly runId: string;
    readonly operation: 'search' | 'sell';
    readonly status: 'running' | 'done' | 'cancelled' | 'error';
    readonly progress: ValuableProgress | null;
    readonly error: string | null;
    readonly updatedAt: number;
}

export interface DebugLogLine {
    readonly at: number;
    readonly level: string;
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

export interface OverviewAutomation {
    readonly key: string;
    readonly label: string;
    readonly enabled: boolean;
    readonly running: boolean;
    readonly lastAt: number | null;
    readonly lastError: string | null;
    /** Startup/data-not-ready state; shown as loading rather than an error. */
    readonly waiting?: boolean | undefined;
}

export interface OverviewAutoJobs {
    readonly nextRefreshAt: number | null;
    readonly refreshReason: 'interval' | 'reset' | 'fallback';
    readonly scheduleState: 'scheduled' | 'repair-pending' | 'repairing' | 'schedule-unavailable' | 'disabled';
    readonly repairAt: number | null;
    readonly lastRefreshAt: number | null;
    readonly lastError: string | null;
    readonly lastSkipReason: string | null;
    readonly lastAttemptAt: number;
}

export interface OverviewTimer {
    readonly kind: 'maintenance' | 'jobs-reset';
    readonly name: string;
    readonly endsAt: string | null;
}

export interface OverviewState {
    readonly auth: AuthStatus;
    readonly network: NetworkMapSummary | null;
    readonly networkAgeMs: number | null;
    readonly queue: NetworkOperationQueueStatus;
    readonly readiness: readonly { readonly tabId: number; readonly readiness: GameReadiness }[];
    readonly helperMode: boolean;
    readonly autoJobs: OverviewAutoJobs;
    readonly automations: readonly OverviewAutomation[];
    readonly timers: readonly OverviewTimer[];
    readonly jobReport: AutoFinishLastRun | null;
}

export interface BackgroundEvent {
    readonly type: string;
    readonly at: number;
    readonly payload?: unknown;
}

export interface PopupVersionInfo {
    readonly name: string;
    readonly version: string;
    readonly versionName: string;
    /** Build counter from the bundle; releases keep it out of the tag/manifest version. */
    readonly build: string | null;
}

export interface SettingsExportData {
    readonly format: 'cor3-helper-v2-settings';
    readonly version: string;
    readonly exportedAt: number;
    readonly settings: SettingsV1;
}

export interface PopupPortal {
    subscribeStorage(listener: (keys: readonly string[]) => void): () => void;
    subscribeEvents(listener: (event: BackgroundEvent) => void): () => void;
    versionInfo(): PopupVersionInfo;
    openSidePanel(): Promise<boolean>;
    /** Opens the full workspace in a detached Chrome popup window. */
    openWindow(): Promise<boolean>;
    ping(): Promise<BridgeResult<{ readonly version: string; readonly phase: string }>>;
    updateStatus(): Promise<BridgeResult<UpdateCheckResult | null>>;
    updateCheck(): Promise<BridgeResult<UpdateCheckResult>>;
    getSettings(): Promise<BridgeResult<SettingsV1>>;
    updateSettings(patch: SettingsPatch): Promise<BridgeResult<SettingsV1>>;
    exportSettings(): Promise<BridgeResult<SettingsExportData>>;
    importSettings(payload: unknown): Promise<BridgeResult<SettingsV1>>;
    resetSettings(): Promise<BridgeResult<SettingsV1>>;
    authStatus(): Promise<BridgeResult<AuthStatus>>;
    networkSummary(): Promise<BridgeResult<NetworkMapSummary>>;
    networkDiagnostics(): Promise<BridgeResult<NetworkDiagnostics>>;
    discover(maxIps?: number): Promise<BridgeResult<DiscoveryResult>>;
    syncJobs(market: JobMarketDefinition): Promise<BridgeResult<JobMarketSyncResult>>;
    syncAllJobs(): Promise<BridgeResult<JobAllMarketsResult>>;
    runJobQueue(jobs: readonly JobOffer[], runId: string): Promise<BridgeResult<JobQueueResult>>;
    dismissFailedJobs(marketKey?: 'home' | 'dark' | 'soyuz' | 'usol'): Promise<BridgeResult<DismissFailedSummary>>;
    cancelJobQueue(runId: string): Promise<BridgeResult<void>>;
    jobQueueProgress(runId: string): Promise<BridgeResult<JobQueueState | null>>;
    jobHistory(): Promise<BridgeResult<readonly JobHistoryEntry[]>>;
    autoJobsSnapshot(): Promise<BridgeResult<AutoJobsSnapshot | null>>;
    cachedMarket(market: JobMarketDefinition): Promise<BridgeResult<CachedMarketView | null>>;
    marketOptions(market: JobMarketDefinition): Promise<BridgeResult<MarketOptionsView>>;
    activityState(): Promise<BridgeResult<ActivityState>>;
    expeditionView(): Promise<BridgeResult<ExpeditionOverview>>;
    respondExpeditionDecision(expeditionId: string, messageId: string, optionId: string): Promise<BridgeResult<void>>;
    autoExpeditionStatus(): Promise<BridgeResult<AutoExpeditionStatus>>;
    cancelExpeditionPreparation(): Promise<BridgeResult<void>>;
    enableAutoExpedition(intervalMinutes: number): Promise<BridgeResult<unknown>>;
    disableAutoExpedition(): Promise<BridgeResult<unknown>>;
    autoMailStatus(): Promise<BridgeResult<AutoMailStatus>>;
    enableAutoMail(intervalMinutes: number): Promise<BridgeResult<unknown>>;
    disableAutoMail(): Promise<BridgeResult<unknown>>;
    droneView(): Promise<BridgeResult<DroneState>>;
    droneAutoRun(): Promise<BridgeResult<DroneAutoResult>>;
    autoDroneStatus(): Promise<BridgeResult<AutoDroneStatus>>;
    enableAutoDrone(intervalMinutes: number): Promise<BridgeResult<unknown>>;
    disableAutoDrone(): Promise<BridgeResult<unknown>>;
    dailyView(force?: boolean): Promise<BridgeResult<DailyOpsState>>;
    runDailyHack(): Promise<BridgeResult<DailyHackResult>>;
    autoDailyStatus(): Promise<BridgeResult<AutoDailyStatus>>;
    enableAutoDaily(intervalMinutes: number): Promise<BridgeResult<unknown>>;
    disableAutoDaily(): Promise<BridgeResult<unknown>>;
    claimPendingMail(): Promise<BridgeResult<MailClaimResult>>;
    loadoutView(): Promise<BridgeResult<LoadoutView>>;
    dumpLoadout(): Promise<BridgeResult<LoadoutDumpFile>>;
    applyLoadout(ability: 'HACK' | 'DECRYPT' | 'SEARCH', target: string, requiredPower: number, strategy?: 'best' | 'weakest'): Promise<BridgeResult<LoadoutApplyResult>>;
    equipLoadoutHardware(moduleConfigId: string): Promise<BridgeResult<void>>;
    equipLoadoutSoftware(moduleConfigId: string): Promise<BridgeResult<void>>;
    unequipLoadoutSoftware(moduleConfigId: string): Promise<BridgeResult<void>>;
    inventoryView(): Promise<BridgeResult<InventoryView>>;
    specialistView(): Promise<BridgeResult<SpecialistState>>;
    purchaseSpecialist(purchase: SpecialistPurchase): Promise<BridgeResult<void>>;
    sortInventory(mode: 'smart' | 'compact'): Promise<BridgeResult<InventorySortResult>>;
    sellInventoryFilter(tiers: readonly string[], tag: 'any' | 'none' | 'craft'): Promise<BridgeResult<InventoryFilterResult>>;
    previewInventoryFilter(tiers: readonly string[], tag: 'any' | 'none' | 'craft'): Promise<BridgeResult<InventoryPreviewResult>>;
    sellInventoryItem(itemId: string, quantity?: number): Promise<BridgeResult<InventoryItemSellResult>>;
    diagnostics(): Promise<BridgeResult<Record<string, unknown>>>;
    overviewState(): Promise<BridgeResult<OverviewState>>;
    networkQueueStatus(): Promise<BridgeResult<NetworkOperationQueueStatus>>;
    debugLogs(limit?: number): Promise<BridgeResult<readonly DebugLogLine[]>>;
    runDebugLogs(runId: string, limit?: number): Promise<BridgeResult<readonly DebugLogLine[]>>;
    copyText(text: string): Promise<boolean>;
    exportText(filename: string, text: string): void;
    autoJobsStatus(): Promise<BridgeResult<AutoJobsStatus>>;
    enableAutoJobs(): Promise<BridgeResult<unknown>>;
    disableAutoJobs(): Promise<BridgeResult<unknown>>;
    autoFinishStatus(): Promise<BridgeResult<AutoFinishStatus>>;
    enableAutoFinish(): Promise<BridgeResult<unknown>>;
    disableAutoFinish(): Promise<BridgeResult<unknown>>;
    runAutoFinish(force?: boolean): Promise<BridgeResult<AutoFinishRunResult>>;
    cancelAutoFinish(): Promise<BridgeResult<void>>;
    networkServers(): Promise<BridgeResult<readonly NetworkServerSummary[]>>;
    searchValuable(runId: string): Promise<BridgeResult<ValuableSearchResult>>;
    sellValuable(runId: string): Promise<BridgeResult<ValuableSaleResult>>;
    cancelValuable(runId: string): Promise<BridgeResult<void>>;
    valuableProgress(runId: string): Promise<BridgeResult<ValuableRunState | null>>;
    valuableReport(): Promise<BridgeResult<ValuableReport>>;
}
