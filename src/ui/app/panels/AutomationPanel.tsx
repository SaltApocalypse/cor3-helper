import { AutoDailyCard } from '../../features/automation/AutoDailyCard.js';
import { AutoExpeditionCard } from '../../features/automation/AutoExpeditionCard.js';
import { AutoJobsCard } from '../../features/automation/AutoJobsCard.js';
import { AutomationDebugCard } from '../../features/automation/AutomationDebugCard.js';
import { HackingAutomationCard } from '../../features/automation/HackingAutomationCard.js';
import { ValuableSellerCard } from '../../features/automation/ValuableSellerCard.js';
import type { AutoFinishState } from '../hooks/useAutoFinish.js';
import type { AutoJobsState } from '../hooks/useAutoJobs.js';
import type { DailyState } from '../hooks/useDaily.js';
import type { DebugLogsState } from '../hooks/useDebugLogs.js';
import type { DroneStatus } from '../hooks/useDrone.js';
import type { ExpeditionsState } from '../hooks/useExpeditions.js';
import type { JobQueueState } from '../hooks/useJobQueue.js';
import type { JobViews } from '../hooks/useJobViews.js';
import type { JobsState } from '../hooks/useJobs.js';
import type { SettingsState } from '../hooks/useSettings.js';
import type { ValuableState } from '../hooks/useValuable.js';
import { jobStatusTone } from '../view-models/job-report.js';

export interface AutomationPanelProps {
    readonly settings: SettingsState;
    readonly jobs: JobsState;
    readonly jobQueue: JobQueueState;
    readonly jobViews: JobViews;
    readonly autoJobs: AutoJobsState;
    readonly autoFinish: AutoFinishState;
    readonly daily: DailyState;
    readonly expeditions: ExpeditionsState;
    readonly drone: DroneStatus;
    readonly valuable: ValuableState;
    readonly debug: DebugLogsState;
    readonly debugLive: boolean;
    readonly now: number;
}

export function AutomationPanel({
    settings,
    jobs,
    jobQueue,
    jobViews,
    autoJobs,
    autoFinish,
    daily,
    expeditions,
    drone,
    valuable,
    debug,
    debugLive,
    now,
}: AutomationPanelProps) {
    const panelOpen = settings.panelOpen;
    return (
        <>
            <HackingAutomationCard
                settings={settings.settings}
                expanded={panelOpen['hacking-automation'] ?? false}
                onOpenChange={(open) => settings.updatePanelOpen('hacking-automation', open)}
                onToggle={settings.toggleHack}
            />

            <AutoDailyCard
                status={daily.autoDaily}
                enabled={settings.settings?.dailyHackEnabled ?? daily.autoDaily?.enabled ?? false}
                daily={daily.daily}
                now={now}
                busy={daily.dailyBusy}
                expanded={panelOpen['auto-daily'] ?? false}
                onOpenChange={(open) => settings.updatePanelOpen('auto-daily', open)}
                onToggle={daily.toggleAutoDaily}
                onRun={daily.runDailyHackNow}
            />

            <AutoJobsCard
                autoJobs={autoJobs.autoJobs}
                autoJobsBusy={autoJobs.autoJobsBusy}
                panelOpen={panelOpen}
                toggleAutoJobs={autoJobs.toggleAutoJobs}
                jobStatusTone={jobStatusTone}
                updatePanelOpen={settings.updatePanelOpen}
                autoCompleteCountdown={autoFinish.autoCompleteCountdown}
                autoFinish={autoFinish.autoFinish}
                autoFinishBusy={autoFinish.autoFinishBusy}
                autoFinishCanceling={autoFinish.autoFinishCanceling}
                jobRunId={jobs.jobRunId}
                toggleAutoFinish={autoFinish.toggleAutoFinish}
                autoCompleteOpen={panelOpen['auto-complete'] ?? false}
                autoCompleteTypesSorted={autoJobs.autoCompleteTypesSorted}
                autoCompleteTypes={autoJobs.autoCompleteTypes}
                toggleAutoCompleteType={autoJobs.toggleAutoCompleteType}
                allAutoCompleteTypes={autoJobs.allAutoCompleteTypes}
                toggleAllAutoCompleteTypes={autoJobs.toggleAllAutoCompleteTypes}
                autoDismissCountdown={autoJobs.autoDismissCountdown}
                settings={settings.settings}
                toggleAutoDismissFailed={autoJobs.toggleAutoDismissFailed}
                jobMarketViews={jobViews.jobMarketViews}
                marketKey={jobs.marketKey}
                now={now}
                setMarketKey={jobs.setMarketKey}
                jobStatusById={jobViews.jobStatusById}
                selectedJobs={jobs.selectedJobs}
                toggleJob={jobs.toggleJob}
                toggleSelectMarket={jobs.toggleSelectMarket}
                cancelAutoFinish={autoFinish.cancelAutoFinish}
                runAutoFinishNow={autoFinish.runAutoFinishNow}
                jobBusy={jobs.jobBusy}
                syncJobs={jobs.syncJobs}
                currentMarketSelectedCount={jobs.currentMarketSelectedCount}
                cancelJobQueue={jobQueue.cancelJobQueue}
                runSelectedJobs={jobQueue.runSelectedJobs}
                shownJobReport={jobViews.shownJobReport}
                jobStatus={jobs.jobStatus}
                jobProgress={jobs.jobProgress}
                marketReport={jobs.marketReport}
            />

            <AutoExpeditionCard
                mercStatus={expeditions.autoExpedition}
                droneStatus={drone.autoDrone}
                settings={settings.settings}
                expeditions={expeditions.expeditions}
                drone={drone.drone}
                mercBusy={expeditions.expeditionBusy || (expeditions.autoExpedition?.running ?? false)}
                droneBusy={drone.droneBusy || (drone.autoDrone?.running ?? false)}
                expanded={panelOpen['auto-expedition'] ?? false}
                onOpenChange={(open) => settings.updatePanelOpen('auto-expedition', open)}
                panelOpen={panelOpen}
                updatePanelOpen={settings.updatePanelOpen}
                onToggleMerc={expeditions.toggleAutoExpedition}
                onToggleDrone={drone.toggleAutoDrone}
                onRunDrone={drone.autoRunDrone}
                onCancelMercPreparation={expeditions.cancelMercPreparation}
                onLoadMerc={expeditions.loadExpeditions}
                onLoadDrone={async () => { await drone.loadDrone(); }}
                onUpdateSettings={expeditions.updateAutomationSettings}
                now={now}
            />

            <ValuableSellerCard
                runId={valuable.valuableRunId}
                operation={valuable.valuableOperation}
                status={valuable.valuableStatus}
                progress={valuable.valuableProgress}
                report={valuable.valuableReport}
                canceling={valuable.valuableCanceling}
                onSearch={() => valuable.startValuableOperation('search')}
                onSell={() => valuable.startValuableOperation('sell')}
                onCancel={valuable.cancelValuableOperation}
                expanded={panelOpen['valuable-seller'] ?? false}
                onOpenChange={(open) => settings.updatePanelOpen('valuable-seller', open)}
            />

            <AutomationDebugCard
                expanded={panelOpen['automation-debug'] ?? false}
                onOpenChange={(open) => settings.updatePanelOpen('automation-debug', open)}
                lines={debug.debugLogs}
                loading={debug.debugLogsLoading}
                live={debugLive}
                onOpen={() => void debug.loadDebugLogs()}
                onRefresh={debug.refreshDebugLogs}
                onCopy={debug.copyDebugLogs}
                onExport={debug.exportDebugLogs}
            />
        </>
    );
}
