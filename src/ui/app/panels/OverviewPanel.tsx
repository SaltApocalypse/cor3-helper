import { OverviewPage } from '../../pages/OverviewPage.js';
import type { AutoJobsState } from '../hooks/useAutoJobs.js';
import type { DailyState } from '../hooks/useDaily.js';
import type { GameStatusState } from '../hooks/useGameStatus.js';
import type { InventoryState } from '../hooks/useInventory.js';
import type { JobViews } from '../hooks/useJobViews.js';
import type { JobsState } from '../hooks/useJobs.js';
import type { SettingsState } from '../hooks/useSettings.js';
import type { NetworkState } from '../hooks/useNetwork.js';
import { hasOverviewTimerData } from '../view-models/automation-status.js';

export interface OverviewPanelProps {
    readonly jobs: JobsState;
    readonly jobViews: JobViews;
    readonly autoJobs: AutoJobsState;
    readonly daily: DailyState;
    readonly gameStatus: GameStatusState;
    readonly inventory: InventoryState;
    readonly network: NetworkState;
    readonly settings: SettingsState;
    readonly now: number;
}

export function OverviewPanel({
    jobs,
    jobViews,
    autoJobs,
    daily,
    gameStatus,
    inventory,
    network,
    settings,
    now,
}: OverviewPanelProps) {
    const autoJobsStatus = autoJobs.autoJobs;
    const autoJobsEnabled = autoJobsStatus?.enabled ?? settings.settings?.autoJobsEnabled ?? false;
    return (
        <OverviewPage
            jobHistory={jobs.jobHistory}
            markets={jobViews.jobMarketViews}
            statusById={jobViews.jobStatusById}
            now={now}
            autoJobsRunning={autoJobsStatus?.running ?? false}
            autoJobsStage={autoJobsStatus?.stage ?? 'idle'}
            autoJobsEnabled={autoJobsEnabled}
            hasSnapshot={jobs.autoJobsMarkets.length > 0}
            nextMarketRefreshAt={autoJobsStatus?.nextRefreshAt ?? null}
            marketRefreshReason={autoJobsStatus?.refreshReason ?? null}
            activity={gameStatus.activity}
            overview={gameStatus.overview}
            credits={gameStatus.credits}
            daily={daily.daily}
            specialists={inventory.specialists}
            networkDiag={network.networkDiag}
            panelOpen={settings.panelOpen}
            onPanelOpenChange={settings.updatePanelOpen}
            panelOrder={settings.panelOrder}
            onReorderPanels={settings.reorderPanels}
            hasTimerData={hasOverviewTimerData({
                daily: daily.daily,
                specialists: inventory.specialists,
                networkDiag: network.networkDiag,
            })}
        />
    );
}
