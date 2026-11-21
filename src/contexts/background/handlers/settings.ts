import { z } from 'zod';
import { settingsPatchSchema, settingsV1Schema, type SettingsPatch, type SettingsV1 } from '../../../contracts/storage.js';
import { ok, type Result } from '../../../kernel/result.js';
import type { CoreRuntime } from '../composition/core.js';
import type { AutomationRuntime } from '../composition/automation.js';
import { AUTO_DRONE_ALARM, AUTO_DRONE_RETRY_ALARM, AUTO_EXPEDITION_ALARM, AUTO_EXPEDITION_RETRY_ALARM, AUTO_MAIL_ALARM, AUTO_REFRESH_ALARM } from '../automation/alarm-ids.js';
import { hasEnabledAutomation } from '../automation/enabled.js';
import { alarmRoutes } from '../alarms.js';

export interface SettingsHandlerDeps {
    readonly core: CoreRuntime;
    readonly automation: AutomationRuntime;
}

const settingsExportSchema = z.object({
    format: z.literal('cor3-helper-v2-settings'),
    version: z.string(),
    exportedAt: z.number().int().nonnegative(),
    settings: settingsV1Schema,
}).strict();

async function applySettingsPatch(deps: SettingsHandlerDeps, patch: SettingsPatch): Promise<Result<SettingsV1, { readonly code: string; readonly message: string }>> {
    const { core, automation } = deps;
    const current = await core.settings.get();
    let effective: SettingsPatch = patch;
    // Helper Mode is a hard lock: turning it on disables every automation in
    // the same write so the alarms and settings can never disagree. Keep a
    // snapshot of the user's automation switches so turning Helper Mode off
    // restores the previous setup, like v1.
    if (patch.helperMode === true && current.helperMode !== true) {
        effective = {
            ...effective,
            helperModeSaved: {
                autoJobsEnabled: current.autoJobsEnabled,
                autoFinishEnabled: current.autoFinishEnabled,
                autoDismissFailedJobsEnabled: current.autoDismissFailedJobsEnabled,
                autoDecryptEnabled: current.autoDecryptEnabled,
                autoIceWallEnabled: current.autoIceWallEnabled,
                autoSimpleDecryptEnabled: current.autoSimpleDecryptEnabled,
                autoDroneEnabled: current.autoDroneEnabled,
                autoExpeditionEnabled: current.autoExpeditionEnabled,
                mailAutoClaimEnabled: current.mailAutoClaimEnabled,
                dailyHackEnabled: current.dailyHackEnabled,
            },
        };
    }
    if (patch.helperMode === true) {
        effective = {
            ...effective,
            autoJobsEnabled: false,
            autoFinishEnabled: false,
            autoDismissFailedJobsEnabled: false,
            autoDroneEnabled: false,
            autoExpeditionEnabled: false,
            dailyHackEnabled: false,
            mailAutoClaimEnabled: false,
            autoDecryptEnabled: false,
            autoIceWallEnabled: false,
            autoSimpleDecryptEnabled: false,
        };
    }
    if (patch.helperMode === false
        && patch.helperModeConsent === true
        && patch.helperModeSaved === undefined
        && current.helperModeSaved) {
        effective = {
            ...current.helperModeSaved,
            ...effective,
            helperMode: false,
            helperModeSaved: null,
        };
    }
    const maxPrice = effective.mercMaxPrice !== undefined ? effective.mercMaxPrice : current.mercMaxPrice;
    const maxPriceEnabled = effective.mercMaxPriceEnabled ?? current.mercMaxPriceEnabled;
    if (maxPriceEnabled && maxPrice === null) {
        return {
            ok: false,
            error: {
                code: 'MERC_MAX_PRICE_REQUIRED',
                message: 'Set a maximum mercenary price before enabling the price cap',
            },
        };
    }
    const next = await core.settings.update(effective);
    if ('autoDecryptEnabled' in effective || 'autoIceWallEnabled' in effective || 'autoSimpleDecryptEnabled' in effective || 'helperMode' in effective) {
        void core.syncAutoSolvers(next);
    }
    if ('autoJobsIntervalMinutes' in effective || 'autoJobsEnabled' in effective || 'autoFinishEnabled' in effective || 'helperMode' in effective) {
        void automation.autoJobs.scheduleNextRefresh();
    }
    if (!next.helperMode && hasEnabledAutomation(next)) {
        automation.scheduler.create(AUTO_REFRESH_ALARM, { periodInMinutes: 5 });
    } else {
        await automation.scheduler.clear(AUTO_REFRESH_ALARM);
    }
    if (effective.helperMode === true) {
        automation.autoJobs.cancel();
        automation.expedition.cancelRun();
        automation.autoFinish.requestCancel();
        await Promise.all(alarmRoutes(automation, core.logger).map((route) => automation.scheduler.clear(route.alarm)));
        core.logger.info('automation', 'Helper Mode enabled; all automation disabled');
    }
    if (patch.helperMode === false) {
        // Restored settings need their alarms back. Auto Jobs is scheduled by
        // scheduleNextAutoJobsRefresh above.
        if (next.autoDroneEnabled) automation.scheduler.create(AUTO_DRONE_ALARM, { periodInMinutes: next.autoDroneIntervalMinutes });
        if (next.autoExpeditionEnabled) automation.scheduler.create(AUTO_EXPEDITION_ALARM, { periodInMinutes: next.autoExpeditionIntervalMinutes });
        if (next.mailAutoClaimEnabled) automation.scheduler.create(AUTO_MAIL_ALARM, { periodInMinutes: 45 });
        if (next.dailyHackEnabled) void automation.daily.scheduleNext();
        core.logger.info('automation', 'Helper Mode disabled; previous automation settings restored', {
            autoJobs: next.autoJobsEnabled,
            autoFinish: next.autoFinishEnabled,
            autoDrone: next.autoDroneEnabled,
            autoExpedition: next.autoExpeditionEnabled,
            autoMail: next.mailAutoClaimEnabled,
            autoDaily: next.dailyHackEnabled,
        });
    }
    if (effective.autoExpeditionEnabled === false) {
        automation.expedition.cancelRun();
        await Promise.all([
            automation.scheduler.clear(AUTO_EXPEDITION_ALARM),
            automation.scheduler.clear(AUTO_EXPEDITION_RETRY_ALARM),
        ]);
    }
    if (effective.autoDroneEnabled === false) {
        await Promise.all([
            automation.scheduler.clear(AUTO_DRONE_ALARM),
            automation.scheduler.clear(AUTO_DRONE_RETRY_ALARM),
        ]);
    }
    return ok(next);
}

export function registerSettingsHandlers(server: CoreRuntime['server'], deps: SettingsHandlerDeps): void {
    server.register('settings.get', z.object({}).strict(), async () => ok(await deps.core.settings.get()));
    server.register('settings.update', settingsPatchSchema, async (patch) => applySettingsPatch(deps, patch));
    server.register('settings.export', z.object({}).strict(), async () => ok({
        format: 'cor3-helper-v2-settings' as const,
        version: deps.core.appVersion(),
        exportedAt: Date.now(),
        settings: await deps.core.settings.get(),
    }));
    server.register('settings.import', z.object({ payload: z.unknown() }).strict(), async ({ payload }) => {
        const parsed = settingsExportSchema.safeParse(payload);
        if (!parsed.success) {
            return {
                ok: false,
                error: {
                    code: 'INVALID_SETTINGS_EXPORT',
                    message: parsed.error.issues[0]?.message ?? 'The file is not a COR3 Helper settings export',
                },
            };
        }
        // Keep the user in Helper Mode if the imported file came from a locked
        // profile; importing must never silently re-enable automation.
        const imported = parsed.data.settings.helperMode
            ? {
                ...parsed.data.settings,
                autoJobsEnabled: false,
                autoFinishEnabled: false,
                autoDroneEnabled: false,
                autoExpeditionEnabled: false,
                dailyHackEnabled: false,
                mailAutoClaimEnabled: false,
                autoDecryptEnabled: false,
                autoIceWallEnabled: false,
                autoSimpleDecryptEnabled: false,
            }
            : parsed.data.settings;
        const result = await applySettingsPatch(deps, imported);
        if (!result.ok) return result;
        deps.core.logger.info('settings', 'Settings imported from backup', {
            version: parsed.data.version,
            exportedAt: parsed.data.exportedAt,
        });
        return result;
    });
    server.register('settings.reset', z.object({}).strict(), async () => {
        const defaults = settingsV1Schema.parse({});
        const result = await applySettingsPatch(deps, defaults);
        if (!result.ok) return result;
        deps.core.logger.info('settings', 'Settings reset to defaults');
        return result;
    });
}
