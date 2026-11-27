import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PopupPortal } from '../../application/popup/portal.js';
import { LanguageProvider } from '../i18n-context.js';
import { AppShell, type PopupPage } from './AppShell.js';
import { useAutoFinish } from './hooks/useAutoFinish.js';
import { useAutoJobs } from './hooks/useAutoJobs.js';
import { useDaily } from './hooks/useDaily.js';
import { useDebugLogs } from './hooks/useDebugLogs.js';
import { useDrone } from './hooks/useDrone.js';
import { useExpeditions } from './hooks/useExpeditions.js';
import { useGameStatus } from './hooks/useGameStatus.js';
import { useInventory } from './hooks/useInventory.js';
import { useJobQueue } from './hooks/useJobQueue.js';
import { useJobViews } from './hooks/useJobViews.js';
import { useJobs } from './hooks/useJobs.js';
import { useLoadout } from './hooks/useLoadout.js';
import { useMail } from './hooks/useMail.js';
import { useNetwork } from './hooks/useNetwork.js';
import { usePolling } from './hooks/usePolling.js';
import { usePortalConnection, usePortalEvents } from './hooks/usePortalConnection.js';
import { useSettings } from './hooks/useSettings.js';
import { useValuable } from './hooks/useValuable.js';
import { AutomationPanel } from './panels/AutomationPanel.js';
import { DeveloperPanel } from './panels/DeveloperPanel.js';
import { GamePanel } from './panels/GamePanel.js';
import { OverviewPanel } from './panels/OverviewPanel.js';
import { ProgressPanel } from './panels/ProgressPanel.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { isAutomationDebugLive } from './view-models/automation-status.js';

/**
 * Side panel composition root (H8 phase 7).
 *
 * Layout, the active page switch and hook composition only. Per-domain state
 * and portal calls live in `hooks/`, pure calculations in `view-models/`, and
 * page wiring in `panels/`.
 */

export interface SidePanelAppProps {
    readonly portal: PopupPortal;
    readonly windowMode?: boolean;
}

export function SidePanelApp({ portal, windowMode = false }: SidePanelAppProps) {
    const [activePage, setActivePage] = useState<PopupPage>('overview');
    const [now, setNow] = useState(Date.now());

    const connection = usePortalConnection(portal);

    // Settings actions (helper mode, import, reset) refresh the automation
    // status hooks. They are wired through a ref because the automation hooks
    // are declared below the settings hook; the callback only ever runs from a
    // user action, never during render.
    const reloadAutomationRef = useRef<() => Promise<void>>(async () => undefined);
    const settings = useSettings(portal, {
        activePage,
        setActivePage,
        reloadAutomation: () => reloadAutomationRef.current(),
        reportDetail: connection.setDetail,
    });

    const network = useNetwork(portal, { reportDetail: connection.setDetail, tt: settings.tt, activePage });
    const gameStatus = useGameStatus(portal, { activePage, loadNetwork: network.loadNetwork });
    const jobs = useJobs(portal, { tt: settings.tt, activePage });
    const jobQueue = useJobQueue(portal, { tt: settings.tt, jobs });
    const autoJobs = useAutoJobs(portal, {
        tt: settings.tt,
        settings: settings.settings,
        setSettings: settings.setSettings,
        setJobStatus: jobs.setJobStatus,
        loadSnapshot: jobs.loadAutoJobsSnapshot,
        reloadSettings: settings.loadSettings,
    });
    const autoFinish = useAutoFinish(portal, {
        tt: settings.tt,
        activePage,
        jobRunId: jobs.jobRunId,
        setJobStatus: jobs.setJobStatus,
        setJobReport: jobs.setJobReport,
        updatePanelOpen: settings.updatePanelOpen,
    });
    const inventory = useInventory(portal, settings.tt);
    const mail = useMail(portal, {
        tt: settings.tt,
        setInventoryStatus: inventory.setInventoryStatus,
        loadInventory: inventory.loadInventory,
    });
    const loadout = useLoadout(portal, settings.tt);
    const expeditionPanelOpen = settings.panelOpen['auto-expedition'] ?? false;
    const drone = useDrone(portal, {
        activePage,
        expeditionPanelOpen,
        reloadSettings: settings.loadSettings,
    });
    const expeditions = useExpeditions(portal, {
        activePage,
        expeditionPanelOpen,
        reportDetail: connection.setDetail,
        reloadSettings: settings.loadSettings,
        setSettings: settings.setSettings,
        loadAutoDrone: drone.loadAutoDrone,
    });
    const daily = useDaily(portal, {
        activePage,
        tt: settings.tt,
        reportDetail: connection.setDetail,
        reloadSettings: settings.loadSettings,
        dailyHackEnabled: settings.settings?.dailyHackEnabled,
    });
    const valuable = useValuable(portal, { activePage, tt: settings.tt, reportDetail: connection.setDetail });
    const debug = useDebugLogs(portal, {
        activePage,
        jobRunId: jobs.jobRunId,
        autoFinishRunId: autoFinish.logRunId,
    });

    const jobViews = useJobViews({
        autoFinishEnabled: autoFinish.autoFinish?.enabled ?? false,
        autoRunMarkets: autoFinish.markets,
        unconfirmedFailures: autoFinish.unconfirmedFailures,
        unknownJobs: autoFinish.unknownJobs,
        unknownStateStatus: autoFinish.unknownStateStatus,
        completedJobsByMarket: autoFinish.completedJobsByMarket,
        jobReport: jobs.jobReport,
        autoJobsMarkets: jobs.autoJobsMarkets,
        jobRunStatusById: jobs.jobRunStatusById,
        jobResetByMarket: jobs.jobResetByMarket,
        jobsByMarket: jobs.jobsByMarket,
    });

    const debugLive = isAutomationDebugLive({
        autoJobsRunning: autoJobs.autoJobs?.running,
        autoFinishRunning: autoFinish.autoFinish?.running,
        jobRunActive: jobs.jobRunId !== null,
        autoDailyRunning: daily.autoDaily?.running,
        autoDroneRunning: drone.autoDrone?.running,
        autoExpeditionRunning: expeditions.autoExpedition?.running,
        autoMailRunning: mail.autoMail?.running,
        valuableActive: valuable.valuableRunId !== null,
    });

    const refreshSession = useCallback(async () => {
        await Promise.all([
            settings.loadAuth(),
            network.loadNetwork(),
            gameStatus.loadOverview(),
            connection.check(settings.tt),
        ]);
    }, [settings.loadAuth, settings.tt, network.loadNetwork, gameStatus.loadOverview, connection.check]);

    const reloadAutomation = useCallback(async () => {
        await Promise.all([
            autoJobs.loadAutoJobs(),
            autoFinish.loadAutoFinish(),
            daily.loadAutoDaily(),
            drone.loadAutoDrone(),
            expeditions.loadAutoExpedition(),
            mail.loadAutoMail(),
        ]);
    }, [
        autoJobs.loadAutoJobs,
        autoFinish.loadAutoFinish,
        daily.loadAutoDaily,
        drone.loadAutoDrone,
        expeditions.loadAutoExpedition,
        mail.loadAutoMail,
    ]);
    reloadAutomationRef.current = reloadAutomation;

    usePortalEvents(portal, {
        activePage,
        reloadSettings: settings.loadSettings,
        reloadAuth: settings.loadAuth,
        reloadNetwork: network.loadNetwork,
        reloadAutoFinish: autoFinish.loadAutoFinish,
        reloadDebugLogs: debug.loadDebugLogs,
        reloadCredits: gameStatus.loadCredits,
        reloadMarketProgress: network.loadMarketProgress,
        mergeMarketProgress: network.mergeMarketProgress,
        reloadAutoJobs: autoJobs.loadAutoJobs,
        reloadAutoJobsSnapshot: jobs.loadAutoJobsSnapshot,
        reloadJobHistory: jobs.loadJobHistory,
        reloadDaily: daily.loadDaily,
        reloadAutoDaily: daily.loadAutoDaily,
        reloadAutoExpedition: expeditions.loadAutoExpedition,
        reloadExpeditions: expeditions.loadExpeditions,
        applyQueueProgress: jobQueue.applyQueueProgress,
    });

    // First ping. Every other domain loads itself on mount in its own hook.
    useEffect(() => {
        void connection.check(settings.tt);
    }, [connection.check, settings.tt]);

    useEffect(() => {
        if (!settings.settings?.developerMode && activePage === 'developer') setActivePage('settings');
    }, [settings.settings?.developerMode, activePage]);

    useEffect(() => {
        if (settings.helperMode && activePage === 'automation') setActivePage('overview');
    }, [settings.helperMode, activePage]);

    // Clock used by the countdowns on the overview, game and automation pages.
    usePolling(() => setNow(Date.now()), 1000, { enabled: activePage !== 'settings' && activePage !== 'developer' });

    return (
        <LanguageProvider language={settings.language}>
            <AppShell
                language={settings.language}
                authenticated={settings.auth?.authenticated ?? false}
                helperMode={settings.helperMode}
                activePage={activePage}
                developerMode={settings.settings?.developerMode !== false}
                windowMode={windowMode}
                onOpenWindow={windowMode ? undefined : () => void portal.openWindow()}
                onRefreshAuth={refreshSession}
                onPageChange={setActivePage}
            >
                {activePage === 'developer' ? (
                    <DeveloperPanel
                        portal={portal}
                        connection={connection}
                        network={network}
                        debug={debug}
                        settings={settings}
                        debugLive={debugLive}
                    />
                ) : null}

                {activePage === 'settings' ? (
                    <SettingsPanel
                        settings={settings}
                        connection={connection}
                        network={network}
                        gameStatus={gameStatus}
                        onOpenDeveloper={setActivePage}
                    />
                ) : null}

                {activePage === 'game' ? (
                    <GamePanel
                        portal={portal}
                        inventory={inventory}
                        loadout={loadout}
                        mail={mail}
                        settings={settings}
                        now={now}
                    />
                ) : null}

                {activePage === 'progress' ? (
                    <ProgressPanel network={network} settings={settings} />
                ) : null}

                {activePage === 'overview' ? (
                    <OverviewPanel
                        jobs={jobs}
                        jobViews={jobViews}
                        autoJobs={autoJobs}
                        daily={daily}
                        gameStatus={gameStatus}
                        inventory={inventory}
                        network={network}
                        settings={settings}
                        now={now}
                    />
                ) : null}

                {activePage === 'automation' ? (
                    <AutomationPanel
                        settings={settings}
                        jobs={jobs}
                        jobQueue={jobQueue}
                        jobViews={jobViews}
                        autoJobs={autoJobs}
                        autoFinish={autoFinish}
                        daily={daily}
                        expeditions={expeditions}
                        drone={drone}
                        valuable={valuable}
                        debug={debug}
                        debugLive={debugLive}
                        now={now}
                    />
                ) : null}
            </AppShell>
        </LanguageProvider>
    );
}
