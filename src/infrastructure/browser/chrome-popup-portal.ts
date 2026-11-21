import { z } from 'zod';
import type { SettingsPatch } from '../../contracts/storage.js';
import { authStatusSchema, settingsPatchSchema, settingsV1Schema } from '../../contracts/storage.js';
import { networkMapSummarySchema } from '../../application/network/summary.js';
import type { BridgeClient } from '../bridge/bridge-client.js';
import { updateCheckResultSchema, type UpdateCheckResult } from '../../contracts/update-check.js';
import type { AutoDailyStatus, AutoDroneStatus, AutoExpeditionStatus, AutoFinishRunResult, AutoFinishStatus, AutoJobsSnapshot, AutoJobsStatus, AutoMailStatus, BackgroundEvent, CachedMarketView, DailyHackResult, DebugLogLine, DismissFailedSummary, DroneAutoResult, InventoryFilterResult, InventoryItemSellResult, InventoryPreviewResult, InventorySortResult, InventoryView, JobAllMarketsResult, JobHistoryEntry, JobMarketSyncResult, JobQueueResult, JobQueueState, LoadoutApplyResult, LoadoutView, MailClaimResult, MarketOptionsView, ActivityState, NetworkDiagnostics, NetworkServerSummary, OverviewState, PopupPortal, ValuableReport, ValuableRunState, ValuableSaleResult, ValuableSearchResult } from '../../application/popup/portal.js';
import type { NetworkOperationQueueStatus } from '../../application/network/operation-queue.js';
import { gameReadinessSchema } from '../../application/game/readiness.js';
import type { JobOffer } from '../../domains/jobs/model.js';
import type { DailyOpsState } from '../../domains/daily-ops/model.js';
import type { SpecialistPurchase, SpecialistState } from '../../domains/specialists/model.js';
import type { ExpeditionOverview } from '../../domains/expeditions/model.js';
import type { DroneState } from '../../domains/drone/model.js';
import type { JobMarketDefinition } from '../../domains/jobs/markets.js';
import { jobOfferSchema } from '../../contracts/jobs.js';
import { marketCompletedJobsSchema } from '../../contracts/market-completed-jobs.js';
import { autoJobsScheduleStateSchema, autoJobsStatusSchema } from '../../contracts/auto-jobs.js';
import { autoFinishLastRunSchema, autoFinishMarketSchema, autoFinishRunResultSchema, autoFinishUnknownJobSchema } from '../../contracts/auto-finish.js';
import { buildNumberFromVersionName } from '../../kernel/version.js';

const pingSchema = z.object({ version: z.string(), phase: z.string() });
const settingsExportSchema = z.object({
    format: z.literal('cor3-helper-v2-settings'),
    version: z.string(),
    exportedAt: z.number(),
    settings: settingsV1Schema,
}).strict();
const debugLogLineSchema = z.object({
    at: z.number(),
    level: z.string(),
    scope: z.string(),
    message: z.string(),
    data: z.unknown().optional(),
}).strict();
const expeditionGoalSchema = z.object({ id: z.string(), name: z.string() }).strict();
const expeditionZoneSchema = z.object({ id: z.string(), name: z.string(), goals: z.array(expeditionGoalSchema) }).strict();
const expeditionLocationSchema = z.object({ id: z.string(), name: z.string(), zones: z.array(expeditionZoneSchema) }).strict();
const expeditionMercenarySchema = z.object({
    id: z.string(), name: z.string(), level: z.number(), rarity: z.string(), price: z.number(),
    totalCost: z.number().nullable(), riskScore: z.number().nullable(), status: z.string(), faction: z.string(), elite: z.boolean(),
    restUntil: z.string().nullable().optional(),
}).strict();
const expeditionDecisionSchema = z.object({
    id: z.string(),
    expeditionId: z.string(),
    message: z.string(),
    riskScore: z.number().nullable(),
    lootScore: z.number().nullable(),
    deadline: z.string().nullable(),
    options: z.array(z.object({
        id: z.string(),
        label: z.string(),
        successChance: z.number().nullable(),
        risk: z.number().nullable(),
        loot: z.number().nullable(),
        lootModifier: z.number(),
        riskModifier: z.number(),
        requiredModuleId: z.string().nullable(),
    }).strict()),
}).strict();
const activeExpeditionSchema = z.object({
    id: z.string(), status: z.string(), locationName: z.string(),
    mercenaryName: z.string().nullable(), totalCost: z.number().nullable(), riskScore: z.number().nullable(),
    lootScore: z.number().nullable(), hasInsurance: z.boolean().nullable(), endsAt: z.string().nullable(),
}).strict();
export const expeditionOverviewSchema = z.object({
    active: z.array(activeExpeditionSchema),
    archived: z.array(activeExpeditionSchema),
    mercenaries: z.array(expeditionMercenarySchema),
    locations: z.array(expeditionLocationSchema),
    decisions: z.array(expeditionDecisionSchema),
}).strict();
const droneStatusSchema = z.object({
    id: z.string(), name: z.string(), durability: z.number(), maxDurability: z.number(),
    battery: z.number(), maxBattery: z.number(), repairing: z.boolean(), destroyed: z.boolean(),
    repairSecondsRemaining: z.number().nullable(),
}).strict();
const droneMissionSchema = z.object({
    id: z.string(), name: z.string(), batteryCost: z.number(), locationConfigId: z.string(),
    locationName: z.string(), missionConfigId: z.string(), risk: z.number(), durationSeconds: z.number(),
}).strict();
const networkDiagnosticsSchema = z.object({
    serverCount: z.number(), connectionCount: z.number(), hiddenEdgeCount: z.number(), maintenanceCount: z.number(),
    endpointCapableCount: z.number(), accessibleCount: z.number(), endpointId: z.string().nullable(), homeId: z.string(),
    snapshotAgeMs: z.number().nullable().optional(), snapshotCapturedAt: z.number().optional(),
    maintenance: z.array(z.object({ id: z.string(), name: z.string(), endsAt: z.string().nullable() }).strict()),
}).strict();
const autoDailyStatusSchema = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    running: z.boolean(),
    last: z.object({ at: z.number(), solved: z.boolean(), puzzle: z.string(), message: z.string() }).strict().nullable(),
    nextRunAt: z.number().nullable(),
    nextRunReason: z.string().nullable(),
    alarmAt: z.number().nullable(),
    hasClaimedToday: z.boolean().nullable(),
    nextTaskTime: z.string().nullable(),
}).strict();
const expeditionPreparationSchema = z.object({
    id: z.string(),
    startedAt: z.number(),
    until: z.number(),
    mercenaryName: z.string(),
    marketKey: z.string(),
    marketLabel: z.string(),
    totalCost: z.number(),
    riskScore: z.number(),
    insurance: z.boolean(),
    insuranceCost: z.number().nullable(),
    locationName: z.string(),
}).strict();
const autoExpeditionDecisionSchema = z.object({
    id: z.string(),
    expeditionId: z.string(),
    message: z.string(),
    riskScore: z.number().nullable(),
    lootScore: z.number().nullable(),
    deadline: z.string().nullable(),
    firstSeenAt: z.number(),
    autoRespondAt: z.number().nullable(),
    options: expeditionDecisionSchema.shape.options,
    mode: z.enum(['simple', 'score']),
    policy: z.string(),
    lootWeight: z.number(),
    riskWeight: z.number(),
    chosenOptionId: z.string().nullable(),
    resolvedAt: z.number().nullable(),
    resolvedBy: z.enum(['manual', 'auto']).nullable(),
}).strict();
const autoExpeditionStatusSchema = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    running: z.boolean(),
    available: z.boolean(),
    dataStale: z.boolean(),
    preparation: expeditionPreparationSchema.nullable(),
    decision: autoExpeditionDecisionSchema.nullable().optional(),
    last: z.object({
        at: z.number(),
        decisions: z.number(),
        launched: z.boolean(),
        error: z.string().nullable(),
        message: z.string().optional(),
        paid: z.number().optional(),
        selectedMerc: z.string().nullable().optional(),
        marketKey: z.string().nullable().optional(),
    }).strict().nullable(),
}).strict();
const autoMailStatusSchema = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    running: z.boolean(),
    last: z.object({ at: z.number(), claimed: z.number(), failed: z.number(), stashFull: z.boolean(), error: z.string().nullable() }).strict().nullable(),
}).strict();
const autoDroneStatusSchema = z.object({
    enabled: z.boolean(),
    intervalMinutes: z.number(),
    running: z.boolean(),
    available: z.boolean(),
    dataStale: z.boolean(),
    last: z.object({ at: z.number(), status: z.string(), message: z.string() }).strict().nullable(),
}).strict();
const droneAutoResultSchema = z.object({
    status: z.enum(['launched', 'repaired', 'idle', 'blocked', 'completed', 'rate-limited', 'insufficient-credits']),
    message: z.string(),
    missionId: z.string().nullable(),
    retryAfterMs: z.number().optional(),
    blockedReason: z.enum(['no-drone', 'destroyed', 'repairing', 'active-mission', 'no-mission']).optional(),
    eventId: z.string().optional(),
}).strict();
export const droneStateSchema = z.object({
    drone: droneStatusSchema.nullable(),
    battery: z.number(),
    maxBattery: z.number(),
    batteryRestoreSeconds: z.number().nullable().optional(),
    activeMissionId: z.string().nullable(),
    missions: z.array(droneMissionSchema),
    archived: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
}).strict();
const dailyHackSchema = z.object({
    solved: z.boolean(),
    puzzle: z.string(),
    message: z.string(),
}).strict();
const dailyOpsSchema = z.object({
    hasClaimedToday: z.boolean(),
    currentStreak: z.number(),
    difficulty: z.string(),
    nextTaskTime: z.string().nullable(),
    streakBonus: z.number().nullable(),
}).strict();
const mailClaimSchema = z.object({
    claimed: z.number().int().nonnegative(),
    failed: z.array(z.object({ messageId: z.string(), message: z.string() }).strict()),
    stashFull: z.boolean(),
    fallbackUsed: z.boolean(),
}).strict();
const marketLotSchema = z.object({
    id: z.string(),
    category: z.string(),
    name: z.string(),
    description: z.string(),
    price: z.number(),
    priceModifier: z.number(),
    accessLevel: z.number().nullable(),
    availableCount: z.number().nullable(),
    manufacturer: z.string().nullable(),
    tier: z.string().nullable(),
    lockedByQuest: z.string().nullable(),
    unavailableReason: z.string().nullable(),
    specs: z.array(z.string()),
}).strict();
const marketJobSchema = z.object({
    id: z.string(),
    name: z.string(),
    rewardCredits: z.number(),
    rewardReputation: z.number(),
    completed: z.boolean(),
    expired: z.boolean(),
    taken: z.boolean(),
}).strict();
const marketReputationSchema = z.object({
    level: z.number(),
    progress: z.number(),
    required: z.number(),
    levelLocked: z.boolean(),
    maxLevel: z.boolean(),
}).strict();
const marketViewSchema = z.object({
    marketId: z.string(),
    marketName: z.string(),
    credits: z.number(),
    reputation: marketReputationSchema.nullable(),
    lots: z.array(marketLotSchema),
    jobs: z.array(marketJobSchema),
    recentJobs: z.array(marketJobSchema),
    nextJobsResetAt: z.string().nullable(),
    route: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
}).strict();
const cachedMarketSchema = marketViewSchema.omit({ route: true }).extend({ at: z.number() }).strict();
const loadoutHardwareSchema = z.object({
    id: z.string(),
    name: z.string(),
    slot: z.enum(['cpu', 'gpu', 'ram', 'psu']),
    category: z.string(),
    specs: z.record(z.string(), z.number()),
    equipped: z.boolean(),
    image: z.string().optional(),
    description: z.string().optional(),
    itemVulnerability: z.number().optional(),
}).strict();
const loadoutAbilitySchema = z.object({
    type: z.string(),
    minPower: z.number(),
    maxPower: z.number(),
    serverTypes: z.array(z.string()).optional(),
    fileTypes: z.array(z.string()).optional(),
    computedPower: z.number().optional(),
}).strict();
const loadoutSoftwareSchema = z.object({
    id: z.string(),
    name: z.string(),
    equipped: z.boolean(),
    consuming: z.record(z.string(), z.array(z.number())),
    abilities: z.array(loadoutAbilitySchema),
    ratio: z.number().optional(),
    bottleneck: z.string().nullable().optional(),
    tier: z.number().optional(),
    manufacturer: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
}).strict();
const loadoutViewSchema = z.object({
    catalogVersion: z.string(),
    gameVersion: z.string(),
    hardwareCount: z.number(),
    softwareCount: z.number(),
    ownedHardware: z.number(),
    ownedSoftware: z.number(),
    equippedHardware: z.record(z.string(), z.string().optional()),
    equippedSoftwareIds: z.array(z.string()),
    hardware: z.array(loadoutHardwareSchema),
    software: z.array(loadoutSoftwareSchema),
    analysis: z.object({
        canBoot: z.boolean(),
        supply: z.record(z.string(), z.number()),
        demand: z.record(z.string(), z.number()),
    }).strict(),
    capturedAt: z.number(),
}).strict();
const loadoutApplySchema = z.object({
    ability: z.enum(['HACK', 'DECRYPT', 'SEARCH']),
    target: z.string(),
    power: z.number(),
    requiredPower: z.number(),
    feasible: z.boolean(),
    softwareName: z.string(),
    policyId: z.string(),
    policyVersion: z.number(),
}).strict();
const specialistExpansionSchema = z.object({
    specialistId: z.string(), specialistType: z.string(), kind: z.string(), level: z.number(), bonusSlots: z.number(),
    expiresAt: z.string().nullable(), gracePeriodEndAt: z.string().nullable(), status: z.string(),
    priceId: z.string().nullable(), credits: z.number().nullable(),
}).strict();
const specialistOfferSchema = z.object({
    specialistId: z.string(), specialistType: z.string(), kind: z.string(), level: z.number(), bonusSlots: z.number(),
    status: z.string(), priceId: z.string(), credits: z.number().nullable(),
}).strict();
const specialistStateSchema = z.object({
    expansions: z.array(specialistExpansionSchema),
    offers: z.array(specialistOfferSchema),
    available: z.boolean(),
}).strict();
const inventoryItemSchema = z.object({
    id: z.string(), name: z.string(), tier: z.string(), quantity: z.number(), sellPrice: z.number(),
    canSell: z.boolean(), canCraft: z.boolean(), canUse: z.boolean(), tags: z.array(z.string()),
    width: z.number(), height: z.number(),
    x: z.number().nullable(), y: z.number().nullable(), itemConfigId: z.string().nullable(),
    imageUrl: z.string().nullable(), description: z.string().nullable(),
}).strict();
const inventorySummarySchema = z.object({
    items: z.number().int().nonnegative(),
    gridWidth: z.number().nullable(),
    usableRows: z.number().nullable(),
    maxCapacity: z.number().nullable(),
    currentUsage: z.number().nullable(),
    rental: z.object({
        status: z.string().nullable(),
        expiresAt: z.string().nullable(),
        gracePeriodEndAt: z.string().nullable(),
    }).strict().nullable(),
}).strict();
const inventoryViewSchema = z.object({
    summary: inventorySummarySchema,
    items: z.array(inventoryItemSchema),
    sortingTableItems: z.number().int().nonnegative(),
}).strict();
const marketOptionsSchema = z.object({
    marketId: z.string(),
    marketName: z.string(),
    credits: z.number(),
    reputation: marketReputationSchema.nullable(),
}).strict();
const activityStateSchema = z.object({
    key: z.enum(['idle', 'auto-jobs', 'auto-finish', 'auto-daily', 'auto-drone', 'auto-expedition', 'auto-mail', 'valuable-seller', 'auto-refresh', 'network']),
    label: z.string(),
    detail: z.string(),
    running: z.boolean(),
    progress: z.object({ index: z.number(), total: z.number(), label: z.string() }).strict().nullable(),
}).strict();
const inventoryProtectedSchema = z.object({
    itemId: z.string(), name: z.string(), tier: z.string(), quantity: z.number(), sellValue: z.number(),
    reason: z.enum(['craft', 'high-tier', 'not-sellable', 'no-price']),
}).strict();
const inventoryPreviewSchema = z.object({
    stacks: z.number().int().nonnegative(),
    quantity: z.number().int().nonnegative(),
    value: z.number(),
    protectedStacks: z.number().int().nonnegative(),
    protectedQuantity: z.number().int().nonnegative(),
    protectedValue: z.number(),
    protected: z.array(inventoryProtectedSchema),
}).strict();
const inventoryFilterSchema = z.object({
    soldStacks: z.number().int().nonnegative(),
    soldQuantity: z.number().int().nonnegative(),
    sellValue: z.number(),
    protectedStacks: z.number().int().nonnegative(),
    protectedValue: z.number(),
    failed: z.array(z.object({ itemId: z.string(), message: z.string() }).strict()),
    mailClaimed: z.number().int().nonnegative().optional(),
}).strict();
const inventoryItemSellSchema = z.object({
    itemId: z.string(), name: z.string(), quantity: z.number(), sellValue: z.number(),
}).strict();
const inventorySortSchema = z.object({
    mode: z.enum(['smart', 'compact']),
    moves: z.number().int().nonnegative(),
    fallback: z.boolean(),
    notice: z.string().nullable(),
}).strict();
const autoFinishProgressSchema = z.object({
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    jobId: z.string(),
    jobName: z.string(),
    serverName: z.string().nullable(),
    doneCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
}).strict();
const autoFinishLiveSchema = z.object({
    runId: z.string(),
    startedAt: z.number(),
    markets: z.array(autoFinishMarketSchema),
}).strict();
const autoFinishStatusSchema = z.object({
    enabled: z.boolean(),
    running: z.boolean(),
    currentRunId: z.string().nullable().default(null),
    live: autoFinishLiveSchema.nullable().default(null),
    last: autoFinishLastRunSchema.nullable(),
    progress: autoFinishProgressSchema.nullable(),
    nextRetryAt: z.number().nullable(),
    retryReason: z.string().nullable(),
    completedJobsByMarket: marketCompletedJobsSchema.default({ byMarket: {} }),
    legacyCompletedJobs: z.record(z.string(), z.string()).default({}),
    completionStateStatus: z.enum(['not-loaded', 'loaded', 'unavailable']).default('not-loaded'),
    unknownJobs: z.array(autoFinishUnknownJobSchema).default([]),
    unknownStateStatus: z.enum(['loaded', 'partial', 'unavailable']).default('unavailable'),
}).strict();
const networkOperationInfoSchema = z.object({
    id: z.string(),
    owner: z.string(),
    reason: z.string(),
    priority: z.number(),
    enqueuedAt: z.number(),
    startedAt: z.number().optional(),
}).strict();
const networkOperationQueueStatusSchema = z.object({
    running: networkOperationInfoSchema.nullable(),
    waiting: z.array(networkOperationInfoSchema),
    updatedAt: z.number(),
}).strict();
const overviewAutomationSchema = z.object({
    key: z.string(),
    label: z.string(),
    enabled: z.boolean(),
    running: z.boolean(),
    lastAt: z.number().int().nonnegative().nullable(),
    lastError: z.string().nullable(),
    waiting: z.boolean().optional(),
}).strict();
export const overviewAutoJobsSchema = z.object({
    nextRefreshAt: z.number().int().nonnegative().nullable(),
    refreshReason: z.enum(['interval', 'reset', 'fallback']),
    scheduleState: autoJobsScheduleStateSchema,
    repairAt: z.number().nullable(),
    lastRefreshAt: z.number().int().nonnegative().nullable(),
    lastError: z.string().nullable(),
    lastSkipReason: z.string().nullable(),
    lastAttemptAt: z.number().int().nonnegative(),
}).strict();
const overviewTimerSchema = z.object({
    kind: z.enum(['maintenance', 'jobs-reset']),
    name: z.string(),
    endsAt: z.string().nullable(),
}).strict();
export const overviewStateSchema = z.object({
    auth: authStatusSchema,
    network: networkMapSummarySchema.nullable(),
    networkAgeMs: z.number().int().nonnegative().nullable(),
    queue: networkOperationQueueStatusSchema,
    readiness: z.array(z.object({ tabId: z.number(), readiness: gameReadinessSchema }).strict()),
    helperMode: z.boolean(),
    autoJobs: overviewAutoJobsSchema,
    automations: z.array(overviewAutomationSchema),
    timers: z.array(overviewTimerSchema),
    jobReport: autoFinishLastRunSchema.nullable(),
}).strict();
const backgroundEventSchema = z.object({
    type: z.string(),
    at: z.number(),
    payload: z.unknown().optional(),
}).strict();
const networkServerSummarySchema = z.object({
    id: z.string(),
    name: z.string(),
    ip: z.string().nullable(),
    typeName: z.string().nullable(),
    access: z.string(),
    maintenanceActive: z.boolean(),
}).strict();
const valuableFailureSchema = z.object({ target: z.string(), message: z.string() }).strict();
const valuableSearchResultSchema = z.object({
    stopped: z.boolean(),
    serversScanned: z.number().int().nonnegative(),
    downloadedFiles: z.number().int().nonnegative(),
    downloadedLogs: z.number().int().nonnegative(),
    failedDownloads: z.number().int().nonnegative(),
    serverFailures: z.array(valuableFailureSchema),
}).strict();
const valuableSaleResultSchema = z.object({
    stopped: z.boolean(),
    marketsChecked: z.number().int().nonnegative(),
    soldItems: z.number().int().nonnegative(),
    credits: z.number(),
    reputation: z.number(),
    marketFailures: z.array(valuableFailureSchema),
}).strict();
const valuableProgressSchema = z.object({
    phase: z.enum(['server', 'download', 'market', 'sell']),
    target: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    downloadedFiles: z.number().int().nonnegative(),
    downloadedLogs: z.number().int().nonnegative(),
    soldItems: z.number().int().nonnegative(),
}).strict();
const valuableRunStateSchema = z.object({
    runId: z.string(),
    operation: z.enum(['search', 'sell']),
    status: z.enum(['running', 'done', 'cancelled', 'error']),
    progress: valuableProgressSchema.nullable(),
    error: z.string().nullable(),
    updatedAt: z.number(),
}).strict();
const valuableReportSchema = z.object({
    downloadedFiles: z.number().int().nonnegative(),
    downloadedLogs: z.number().int().nonnegative(),
    soldItems: z.number().int().nonnegative(),
    credits: z.number(),
    reputation: z.number(),
    unsoldItems: z.number().int().nonnegative(),
    lastSearchAt: z.number().nullable(),
    lastSellAt: z.number().nullable(),
    active: valuableRunStateSchema.nullable(),
}).strict();
const jobRouteNodeSchema = z.object({ id: z.string(), name: z.string() }).strict();
const skippedJobSchema = z.object({
    id: z.string(),
    name: z.string(),
    serverName: z.string().nullable(),
    status: z.string(),
    reason: z.string(),
    expired: z.boolean().optional(),
    reputationPenalty: z.number().nonnegative().default(0),
    deposit: z.number().nonnegative().default(0),
    jobType: z.string().optional(),
}).strict();
const jobMarketSyncSchema = z.object({
    route: z.array(jobRouteNodeSchema),
    jobs: z.array(jobOfferSchema),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative().default(0),
    skippedJobs: z.array(skippedJobSchema).default([]),
    resetAt: z.string().nullable(),
}).strict();
const jobAllMarketsSchema = z.object({
    jobs: z.array(jobOfferSchema),
    markets: z.array(z.object({
        marketKey: z.string(),
        label: z.string(),
        ok: z.boolean(),
        skipped: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative().default(0),
        expired: z.number().int().nonnegative().default(0),
        skippedJobs: z.array(skippedJobSchema).default([]),
        resetAt: z.string().nullable().optional(),
        updatedAt: z.number().int().nonnegative().optional(),
        stale: z.boolean().optional(),
        reconciliationStatus: z.enum(['loaded', 'partial', 'unavailable']).optional(),
        error: z.string().optional(),
        errorCode: z.string().optional(),
    }).strict()),
}).strict();
const autoJobsSnapshotSchema = z.object({
    at: z.number(),
    jobs: z.array(jobOfferSchema),
    markets: jobAllMarketsSchema.shape.markets,
}).strict();
const dismissFailedSummarySchema = z.object({
    dismissed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    markets: z.array(z.string()),
    errors: z.array(z.string()),
}).strict();
const jobQueueFailureSchema = z.object({
    jobId: z.string(),
    name: z.string(),
    serverName: z.string().nullable(),
    marketKey: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    unconfirmed: z.boolean().optional(),
    retryAt: z.number().optional(),
    lockExpiresAt: z.number().optional(),
    stage: z.string().optional(),
}).strict();
const jobQueueSchema = z.object({
    stopped: z.boolean(),
    done: z.array(z.string()),
    failed: z.array(jobQueueFailureSchema),
}).strict();
const jobHistorySchema = z.array(z.object({
    jobId: z.string(), name: z.string(), type: z.string(), serverName: z.string().nullable(),
    marketKey: z.string().optional(),
    status: z.enum(['done', 'failed', 'retry']), at: z.number(), error: z.string().optional(),
}).strict());
const jobQueueProgressSchema = z.object({
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    jobId: z.string(),
    jobName: z.string(),
    marketKey: z.string(),
    serverName: z.string().nullable(),
    doneCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
}).strict();
const jobQueueStateSchema = z.object({
    runId: z.string(),
    status: z.enum(['running', 'done', 'cancelled', 'error']),
    progress: jobQueueProgressSchema.nullable(),
    done: z.array(z.string()),
    failed: z.array(jobQueueFailureSchema),
    error: z.string().nullable(),
    updatedAt: z.number(),
}).strict();

const discoveryResultSchema = z.object({
    ok: z.boolean(),
    skipped: z.boolean().optional(),
    reason: z.string().optional(),
    partial: z.boolean().optional(),
    scanned: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    newConnections: z.number().int().nonnegative(),
    newServers: z.number().int().nonnegative(),
}).strict();

export class ChromePopupPortal implements PopupPortal {
    constructor(private readonly client: BridgeClient) {}

    subscribeStorage(listener: (keys: readonly string[]) => void): () => void {
        const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
            if (area !== 'local') return;
            const keys = Object.keys(changes).filter((key) => key.startsWith('v2.'));
            if (keys.length > 0) listener(keys);
        };
        chrome.storage.onChanged.addListener(handler);
        return () => chrome.storage.onChanged.removeListener(handler);
    }

    subscribeEvents(listener: (event: BackgroundEvent) => void): () => void {
        let disposed = false;
        let port: chrome.runtime.Port | null = null;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let attempts = 0;

        const connect = (): void => {
            if (disposed) return;
            port = chrome.runtime.connect({ name: 'v2-events' });
            const handler = (message: unknown): void => {
                attempts = 0;
                const parsed = backgroundEventSchema.safeParse(message);
                if (parsed.success) listener(parsed.data);
            };
            const onDisconnect = (): void => {
                port?.onMessage.removeListener(handler);
                port = null;
                if (disposed) return;
                // MV3 service workers are suspended frequently. Reconnect with
                // capped backoff so progress/event updates do not silently stop.
                const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts++, 5));
                retryTimer = setTimeout(connect, delay);
            };
            port.onMessage.addListener(handler);
            port.onDisconnect.addListener(onDisconnect);
        };

        connect();
        return () => {
            disposed = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
            port?.disconnect();
            port = null;
        };
    }

    versionInfo(): { readonly name: string; readonly version: string; readonly versionName: string; readonly build: string | null } {
        const manifest = chrome.runtime.getManifest();
        const versionName = (manifest as { version_name?: string }).version_name ?? manifest.version;
        const embeddedBuild = buildNumberFromVersionName(versionName);
        return {
            name: manifest.name,
            version: manifest.version,
            versionName,
            build: embeddedBuild ?? (typeof __COR3_BUILD_NUMBER__ === 'string' ? __COR3_BUILD_NUMBER__ : null),
        };
    }

    async openSidePanel(): Promise<boolean> {
        try {
            const current = await chrome.windows.getCurrent();
            if (current.id === undefined) return false;
            await chrome.sidePanel.open({ windowId: current.id });
            return true;
        } catch {
            return this.openWindow();
        }
    }

    async openWindow(): Promise<boolean> {
        try {
            const baseUrl = chrome.runtime.getURL('sidepanel.html');
            const windows = await chrome.windows.getAll({ populate: true });
            const existing = windows.find((window) => (
                window.type === 'popup'
                && typeof window.id === 'number'
                && window.tabs?.some((tab) => tab.url?.startsWith(baseUrl))
            ));
            if (existing && typeof existing.id === 'number') {
                try {
                    await chrome.windows.update(existing.id, { focused: true });
                    return true;
                } catch {
                    // The window may have closed between the query and the focus.
                }
            }
            await chrome.windows.create({
                url: `${baseUrl}?mode=window`,
                type: 'popup',
                width: 430,
                height: 800,
                focused: true,
            });
            return true;
        } catch {
            return false;
        }
    }

    ping() {
        return this.client.request('system.ping', {}, pingSchema);
    }

    updateCheck(): Promise<{ ok: true; value: UpdateCheckResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('system.updateCheck', {}, updateCheckResultSchema, 120_000) as
            Promise<{ ok: true; value: UpdateCheckResult } | { ok: false; error: { code: string; message: string } }>;
    }

    updateStatus(): Promise<{ ok: true; value: UpdateCheckResult | null } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('system.updateStatus', {}, updateCheckResultSchema.nullable(), 10_000) as
            Promise<{ ok: true; value: UpdateCheckResult | null } | { ok: false; error: { code: string; message: string } }>;
    }

    getSettings() {
        return this.client.request('settings.get', {}, settingsV1Schema);
    }

    updateSettings(patch: SettingsPatch) {
        return this.client.request('settings.update', settingsPatchSchema.parse(patch), settingsV1Schema);
    }

    exportSettings() {
        return this.client.request('settings.export', {}, settingsExportSchema);
    }

    importSettings(payload: unknown) {
        return this.client.request('settings.import', { payload }, settingsV1Schema);
    }

    resetSettings() {
        return this.client.request('settings.reset', {}, settingsV1Schema);
    }

    authStatus() {
        return this.client.request('auth.status', {}, authStatusSchema);
    }

    networkSummary() {
        return this.client.request('network.summary', {}, networkMapSummarySchema, 15000);
    }

    discover(maxIps = 4) {
        return this.client.request('network.discover', { maxIps, maxDurationMs: 15000 }, discoveryResultSchema, 20000);
    }

    syncJobs(market: JobMarketDefinition): Promise<{ ok: true; value: JobMarketSyncResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.syncMarket', {
            marketId: market.marketId,
            marketKey: market.key,
            serverId: market.routeServerId,
        }, jobMarketSyncSchema, 60000) as Promise<{ ok: true; value: JobMarketSyncResult } | { ok: false; error: { code: string; message: string } }>;
    }

    syncAllJobs(): Promise<{ ok: true; value: JobAllMarketsResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.syncAllMarkets', {}, jobAllMarketsSchema, 180000).then((result) => {
            if (!result.ok) return result;
            return {
                ok: true as const,
                value: {
                    jobs: result.value.jobs as JobOffer[],
                    markets: result.value.markets.map((market) => market.ok
                        ? { marketKey: market.marketKey, label: market.label, ok: true as const, skipped: market.skipped, resetAt: market.resetAt ?? null }
                        : {
                            marketKey: market.marketKey,
                            label: market.label,
                            ok: false as const,
                            skipped: market.skipped,
                            resetAt: null,
                            error: market.error ?? 'Market sync failed',
                            ...(market.errorCode ? { errorCode: market.errorCode } : {}),
                        }),
                },
            };
        });
    }

    runJobQueue(jobs: readonly JobOffer[], runId: string): Promise<{ ok: true; value: JobQueueResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.queue', { runId, jobs }, jobQueueSchema, 300000) as Promise<{ ok: true; value: JobQueueResult } | { ok: false; error: { code: string; message: string } }>;
    }

    dismissFailedJobs(marketKey?: 'home' | 'dark' | 'soyuz' | 'usol'): Promise<{ ok: true; value: DismissFailedSummary } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.dismissFailed', marketKey ? { marketKey } : {}, dismissFailedSummarySchema, 300000) as Promise<{ ok: true; value: DismissFailedSummary } | { ok: false; error: { code: string; message: string } }>;
    }

    cancelJobQueue(runId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.queueCancel', { runId }, z.undefined(), 10000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    jobHistory(): Promise<{ ok: true; value: readonly JobHistoryEntry[] } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.history', {}, jobHistorySchema, 10000) as Promise<{ ok: true; value: readonly JobHistoryEntry[] } | { ok: false; error: { code: string; message: string } }>;
    }

    async autoJobsSnapshot(): Promise<{ ok: true; value: AutoJobsSnapshot | null } | { ok: false; error: { code: string; message: string } }> {
        const result = await this.client.request('auto-jobs.snapshot', {}, autoJobsSnapshotSchema.nullable(), 15000);
        if (!result.ok) return result;
        if (result.value === null) return { ok: true, value: null };
        const markets: AutoJobsSnapshot['markets'] = result.value.markets.map((market) => market.ok
            ? {
                marketKey: market.marketKey,
                label: market.label,
                ok: true,
                skipped: market.skipped,
                failed: market.failed ?? 0,
                expired: market.expired ?? 0,
                skippedJobs: market.skippedJobs ?? [],
                resetAt: market.resetAt ?? null,
                ...(market.updatedAt !== undefined ? { updatedAt: market.updatedAt } : {}),
                stale: market.stale === true,
            }
            : {
                marketKey: market.marketKey,
                label: market.label,
                ok: false,
                skipped: market.skipped,
                failed: market.failed ?? 0,
                expired: market.expired ?? 0,
                skippedJobs: market.skippedJobs ?? [],
                resetAt: market.resetAt ?? null,
                ...(market.updatedAt !== undefined ? { updatedAt: market.updatedAt } : {}),
                stale: true,
                error: market.error ?? 'Market sync failed',
                ...(market.errorCode ? { errorCode: market.errorCode } : {}),
            });
        return {
            ok: true,
            value: {
                at: result.value.at,
                jobs: result.value.jobs as JobOffer[],
                markets,
            },
        };
    }

    jobQueueProgress(runId: string): Promise<{ ok: true; value: JobQueueState | null } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('job.queueProgress', { runId }, jobQueueStateSchema.nullable(), 10000) as Promise<{ ok: true; value: JobQueueState | null } | { ok: false; error: { code: string; message: string } }>;
    }

    expeditionView(): Promise<{ ok: true; value: ExpeditionOverview } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.view', {}, expeditionOverviewSchema, 90000) as Promise<{ ok: true; value: ExpeditionOverview } | { ok: false; error: { code: string; message: string } }>;
    }

    respondExpeditionDecision(expeditionId: string, messageId: string, optionId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.respond', { expeditionId, messageId, optionId }, z.undefined(), 20000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    droneView(): Promise<{ ok: true; value: DroneState } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('drone.view', {}, droneStateSchema, 60000) as Promise<{ ok: true; value: DroneState } | { ok: false; error: { code: string; message: string } }>;
    }

    droneAutoRun(): Promise<{ ok: true; value: DroneAutoResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('drone.autoRun', {}, droneAutoResultSchema, 120000) as Promise<{ ok: true; value: DroneAutoResult } | { ok: false; error: { code: string; message: string } }>;
    }

    autoExpeditionStatus(): Promise<{ ok: true; value: AutoExpeditionStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.autoStatus', {}, autoExpeditionStatusSchema, 10000) as Promise<{ ok: true; value: AutoExpeditionStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    cancelExpeditionPreparation(): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.autoCancel', {}, z.undefined(), 10000);
    }

    enableAutoExpedition(intervalMinutes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.autoEnable', { intervalMinutes }, z.unknown(), 10000);
    }

    disableAutoExpedition(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('expeditions.autoDisable', {}, z.unknown(), 10000);
    }

    autoDailyStatus(): Promise<{ ok: true; value: AutoDailyStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('daily.autoStatus', {}, autoDailyStatusSchema, 10000) as Promise<{ ok: true; value: AutoDailyStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    enableAutoDaily(intervalMinutes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('daily.autoEnable', { intervalMinutes }, z.unknown(), 10000);
    }

    disableAutoDaily(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('daily.autoDisable', {}, z.unknown(), 10000);
    }

    autoMailStatus(): Promise<{ ok: true; value: AutoMailStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('mail.autoStatus', {}, autoMailStatusSchema, 10000) as Promise<{ ok: true; value: AutoMailStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    enableAutoMail(intervalMinutes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('mail.autoEnable', { intervalMinutes }, z.unknown(), 300_000);
    }

    disableAutoMail(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('mail.autoDisable', {}, z.unknown(), 10000);
    }

    autoDroneStatus(): Promise<{ ok: true; value: AutoDroneStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('drone.autoStatus', {}, autoDroneStatusSchema, 10000) as Promise<{ ok: true; value: AutoDroneStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    enableAutoDrone(intervalMinutes: number): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('drone.autoEnable', { intervalMinutes }, z.unknown(), 10000);
    }

    disableAutoDrone(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('drone.autoDisable', {}, z.unknown(), 10000);
    }


    previewInventoryFilter(tiers: readonly string[], tag: 'any' | 'none' | 'craft'): Promise<{ ok: true; value: InventoryPreviewResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('inventory.previewFilter', { tiers, tag }, inventoryPreviewSchema, 30000) as Promise<{ ok: true; value: InventoryPreviewResult } | { ok: false; error: { code: string; message: string } }>;
    }

    sellInventoryFilter(tiers: readonly string[], tag: 'any' | 'none' | 'craft'): Promise<{ ok: true; value: InventoryFilterResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('inventory.sellFilter', { tiers, tag }, inventoryFilterSchema, 300000) as Promise<{ ok: true; value: InventoryFilterResult } | { ok: false; error: { code: string; message: string } }>;
    }

    sellInventoryItem(itemId: string, quantity?: number): Promise<{ ok: true; value: InventoryItemSellResult } | { ok: false; error: { code: string; message: string } }> {
        const payload = quantity === undefined ? { itemId } : { itemId, quantity };
        return this.client.request('inventory.sellItem', payload, inventoryItemSellSchema, 30000) as Promise<{ ok: true; value: InventoryItemSellResult } | { ok: false; error: { code: string; message: string } }>;
    }

    diagnostics(): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('system.diagnostics', {}, z.record(z.string(), z.unknown()), 20000) as Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }>;
    }

    overviewState(): Promise<{ ok: true; value: OverviewState } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('overview.state', {}, overviewStateSchema, 20000) as Promise<{ ok: true; value: OverviewState } | { ok: false; error: { code: string; message: string } }>;
    }

    networkQueueStatus(): Promise<{ ok: true; value: NetworkOperationQueueStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('network.queueStatus', {}, networkOperationQueueStatusSchema, 10000) as Promise<{ ok: true; value: NetworkOperationQueueStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    debugLogs(limit = 200): Promise<{ ok: true; value: readonly DebugLogLine[] } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('devtools.logs', { limit }, z.array(debugLogLineSchema), 15000) as Promise<{ ok: true; value: readonly DebugLogLine[] } | { ok: false; error: { code: string; message: string } }>;
    }

    runDebugLogs(runId: string, limit = 300): Promise<{ ok: true; value: readonly DebugLogLine[] } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('automation.logs', { runId, limit }, z.array(debugLogLineSchema), 15000) as Promise<{ ok: true; value: readonly DebugLogLine[] } | { ok: false; error: { code: string; message: string } }>;
    }

    async copyText(text: string): Promise<boolean> {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }

    exportText(filename: string, text: string): void {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    dailyView(force = false): Promise<{ ok: true; value: DailyOpsState } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('daily.view', { force }, dailyOpsSchema, 30000) as Promise<{ ok: true; value: DailyOpsState } | { ok: false; error: { code: string; message: string } }>;
    }

    runDailyHack(): Promise<{ ok: true; value: DailyHackResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('daily.hack', {}, dailyHackSchema, 140000) as Promise<{ ok: true; value: DailyHackResult } | { ok: false; error: { code: string; message: string } }>;
    }

    cachedMarket(market: { readonly marketId: string }): Promise<{ ok: true; value: CachedMarketView | null } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('market.cached', { marketId: market.marketId }, cachedMarketSchema.nullable(), 15000) as Promise<{ ok: true; value: CachedMarketView | null } | { ok: false; error: { code: string; message: string } }>;
    }

    marketOptions(market: { readonly marketId: string }): Promise<{ ok: true; value: MarketOptionsView } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('market.options', { marketId: market.marketId }, marketOptionsSchema, 25000) as Promise<{ ok: true; value: MarketOptionsView } | { ok: false; error: { code: string; message: string } }>;
    }

    activityState(): Promise<{ ok: true; value: ActivityState } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('activity.state', {}, activityStateSchema, 10000) as Promise<{ ok: true; value: ActivityState } | { ok: false; error: { code: string; message: string } }>;
    }

    claimPendingMail(): Promise<{ ok: true; value: MailClaimResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('mail.claimPending', {}, mailClaimSchema, 300000) as Promise<{ ok: true; value: MailClaimResult } | { ok: false; error: { code: string; message: string } }>;
    }

    loadoutView(): Promise<{ ok: true; value: LoadoutView } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('loadout.view', {}, loadoutViewSchema, 30000) as Promise<{ ok: true; value: LoadoutView } | { ok: false; error: { code: string; message: string } }>;
    }

    applyLoadout(ability: 'HACK' | 'DECRYPT' | 'SEARCH', target: string, requiredPower: number, strategy: 'best' | 'weakest' = 'best'): Promise<{ ok: true; value: LoadoutApplyResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('loadout.apply', { ability, target, requiredPower, strategy }, loadoutApplySchema, 90000) as Promise<{ ok: true; value: LoadoutApplyResult } | { ok: false; error: { code: string; message: string } }>;
    }

    equipLoadoutHardware(moduleConfigId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('loadout.equipHardware', { moduleConfigId }, z.undefined(), 20000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    equipLoadoutSoftware(moduleConfigId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('loadout.equipSoftware', { moduleConfigId }, z.undefined(), 20000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    unequipLoadoutSoftware(moduleConfigId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('loadout.unequipSoftware', { moduleConfigId }, z.undefined(), 20000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }


    specialistView(): Promise<{ ok: true; value: SpecialistState } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('specialists.view', {}, specialistStateSchema, 20000) as Promise<{ ok: true; value: SpecialistState } | { ok: false; error: { code: string; message: string } }>;
    }

    purchaseSpecialist(purchase: SpecialistPurchase): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('specialists.purchase', purchase, z.undefined(), 30000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }



    inventoryView(): Promise<{ ok: true; value: InventoryView } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('inventory.view', {}, inventoryViewSchema, 30000) as Promise<{ ok: true; value: InventoryView } | { ok: false; error: { code: string; message: string } }>;
    }

    sortInventory(mode: 'smart' | 'compact'): Promise<{ ok: true; value: InventorySortResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('inventory.sort', { mode }, inventorySortSchema, 600000) as Promise<{ ok: true; value: InventorySortResult } | { ok: false; error: { code: string; message: string } }>;
    }

    autoJobsStatus(): Promise<{ ok: true; value: AutoJobsStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-jobs.status', {}, autoJobsStatusSchema, 10000) as Promise<{ ok: true; value: AutoJobsStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    enableAutoJobs(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-jobs.enable', {}, z.unknown(), 10000);
    }

    disableAutoJobs(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-jobs.disable', {}, z.unknown(), 10000);
    }


    autoFinishStatus(): Promise<{ ok: true; value: AutoFinishStatus } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-finish.status', {}, autoFinishStatusSchema, 10000) as Promise<{ ok: true; value: AutoFinishStatus } | { ok: false; error: { code: string; message: string } }>;
    }

    enableAutoFinish(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-finish.enable', {}, z.unknown(), 10000);
    }

    disableAutoFinish(): Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-finish.disable', {}, z.unknown(), 10000);
    }

    runAutoFinish(force = false): Promise<{ ok: true; value: AutoFinishRunResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-finish.run', { force }, autoFinishRunResultSchema, 600000) as Promise<{ ok: true; value: AutoFinishRunResult } | { ok: false; error: { code: string; message: string } }>;
    }

    cancelAutoFinish(): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('auto-finish.cancel', {}, z.undefined(), 10000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    networkDiagnostics(): Promise<{ ok: true; value: NetworkDiagnostics } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('network.diagnostics', {}, networkDiagnosticsSchema, 15000) as Promise<{ ok: true; value: NetworkDiagnostics } | { ok: false; error: { code: string; message: string } }>;
    }

    networkServers(): Promise<{ ok: true; value: readonly NetworkServerSummary[] } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('network.servers', {}, z.array(networkServerSummarySchema), 20000) as Promise<{ ok: true; value: readonly NetworkServerSummary[] } | { ok: false; error: { code: string; message: string } }>;
    }

    searchValuable(runId: string): Promise<{ ok: true; value: ValuableSearchResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('valuable.search', { runId }, valuableSearchResultSchema, 1_800_000) as Promise<{ ok: true; value: ValuableSearchResult } | { ok: false; error: { code: string; message: string } }>;
    }

    sellValuable(runId: string): Promise<{ ok: true; value: ValuableSaleResult } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('valuable.sell', { runId }, valuableSaleResultSchema, 1_800_000) as Promise<{ ok: true; value: ValuableSaleResult } | { ok: false; error: { code: string; message: string } }>;
    }

    cancelValuable(runId: string): Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('valuable.cancel', { runId }, z.undefined(), 10000) as Promise<{ ok: true; value: void } | { ok: false; error: { code: string; message: string } }>;
    }

    valuableProgress(runId: string): Promise<{ ok: true; value: ValuableRunState | null } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('valuable.progress', { runId }, valuableRunStateSchema.nullable(), 10000) as Promise<{ ok: true; value: ValuableRunState | null } | { ok: false; error: { code: string; message: string } }>;
    }

    valuableReport(): Promise<{ ok: true; value: ValuableReport } | { ok: false; error: { code: string; message: string } }> {
        return this.client.request('valuable.report', {}, valuableReportSchema, 15000) as Promise<{ ok: true; value: ValuableReport } | { ok: false; error: { code: string; message: string } }>;
    }
}
