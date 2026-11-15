import { z } from 'zod';
import { JOB_TYPES } from '../kernel/job-types.js';

export const DECISION_POLICIES = ['off', 'veterans', 'loot', 'risk'] as const;
export const MERC_SELECTION_MODES = ['market', 'global'] as const;
export const MERC_MARKET_KEYS = ['core', 'usol', 'usol-elite'] as const;

/**
 * All persisted 2.0 values are wrapped so migrations can identify their shape.
 * Version numbers are monotonic and handled by a repository migration.
 */
export const storageEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) =>
    z.object({
        schemaVersion: z.number().int().positive(),
        writtenAt: z.number().int().nonnegative(),
        data,
    }).strict();

export type StorageEnvelope<T> = {
    readonly schemaVersion: number;
    readonly writtenAt: number;
    readonly data: T;
};

const helperModeAutomationSchema = z.object({
    autoJobsEnabled: z.boolean(),
    autoFinishEnabled: z.boolean(),
    autoDismissFailedJobsEnabled: z.boolean(),
    autoDecryptEnabled: z.boolean(),
    autoIceWallEnabled: z.boolean(),
    autoSimpleDecryptEnabled: z.boolean(),
    autoDroneEnabled: z.boolean(),
    autoExpeditionEnabled: z.boolean(),
    mailAutoClaimEnabled: z.boolean(),
    dailyHackEnabled: z.boolean(),
}).strict();

export type HelperModeAutomationSnapshot = z.infer<typeof helperModeAutomationSchema>;

export const settingsV1Schema = z.object({
    uiLanguage: z.enum(['en', 'zh']).default('en'),
    languageInitialized: z.boolean().default(false),
    helperMode: z.boolean().default(true),
    /**
     * Set once the user has typed the acknowledgement phrase to disable Helper
     * Mode. Afterwards the switch toggles without another confirmation.
     */
    helperModeConsent: z.boolean().default(false),
    helperModeSaved: helperModeAutomationSchema.nullable().default(null),
    developerMode: z.boolean().default(true),
    autoJobsEnabled: z.boolean().default(false),
    autoFinishEnabled: z.boolean().default(false),
    autoJobsIntervalMinutes: z.number().int().min(5).max(1440).default(60),
    autoCompleteJobTypes: z.array(z.enum(JOB_TYPES)).default([...JOB_TYPES]),
    autoDismissFailedJobsEnabled: z.boolean().default(false),
    autoDecryptEnabled: z.boolean().default(false),
    autoIceWallEnabled: z.boolean().default(false),
    autoSimpleDecryptEnabled: z.boolean().default(false),
    panelOpenState: z.record(z.string(), z.boolean()).default({}),
    autoDroneEnabled: z.boolean().default(false),
    autoDroneIntervalMinutes: z.number().int().min(1).max(1440).default(5),
    droneRepairEnabled: z.boolean().default(false),
    droneRepairThreshold: z.number().int().min(0).max(100).default(60),
    droneRepairOnCharge: z.boolean().default(false),
    droneDecisionPolicy: z.enum(DECISION_POLICIES).default('off'),
    droneLocationId: z.string().nullable().default(null),
    droneGoalId: z.string().nullable().default(null),
    droneAutoSendEnabled: z.boolean().default(true),
    autoExpeditionEnabled: z.boolean().default(false),
    autoExpeditionIntervalMinutes: z.number().int().min(5).max(1440).default(30),
    mercAutoSelectEnabled: z.boolean().default(false),
    mercSelectionMode: z.enum(MERC_SELECTION_MODES).default('market'),
    mercMaxPriceEnabled: z.boolean().default(false),
    mercMaxPrice: z.number().int().nonnegative().nullable().default(15000),
    mercMinCreditsEnabled: z.boolean().default(false),
    mercMinCredits: z.number().int().min(0).max(350000).default(50000),
    mercMarketOrder: z.array(z.enum(MERC_MARKET_KEYS)).default(['core', 'usol', 'usol-elite']),
    mercInsuranceEnabled: z.boolean().default(false),
    mercDecisionPolicy: z.enum(DECISION_POLICIES).default('off'),
    mercAutoPayEnabled: z.boolean().default(true),
    mercLocationId: z.string().nullable().default(null),
    mercGoalId: z.string().nullable().default(null),
    mailAutoClaimEnabled: z.boolean().default(false),
    mailAutoClaimIntervalMinutes: z.number().int().min(1).max(1440).default(45),
    dailyHackEnabled: z.boolean().default(false),
    dailyHackIntervalMinutes: z.number().int().min(5).max(1440).default(240),
    disableNetworkFog: z.boolean().default(false),
    disableBackground: z.boolean().default(false),
    moveNotificationsLeft: z.boolean().default(false),
    antiAfkEnabled: z.boolean().default(false),
    saiFileHighlightEnabled: z.boolean().default(false),
}).strip();

/**
 * Patch fields must stay optional without defaults. `.partial()` keeps the
 * field defaults, which would make every patch silently reset every setting.
 */
const settingsPatchShape = Object.fromEntries(
    Object.entries(settingsV1Schema.shape).map(([key, schema]) => {
        const patchField = schema as z.ZodTypeAny & { removeDefault?: () => z.ZodTypeAny };
        return [key, (patchField.removeDefault?.() ?? patchField).optional()];
    }),
);

export const settingsPatchSchema = z.object(settingsPatchShape).strict();

export type SettingsV1 = z.infer<typeof settingsV1Schema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const authStatusSchema = z.object({
    authenticated: z.boolean(),
    source: z.enum(['content', 'none']),
    expiresAt: z.number().int().nonnegative().optional(),
}).strict();

export type AuthStatus = z.infer<typeof authStatusSchema>;
