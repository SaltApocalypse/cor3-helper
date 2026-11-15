import { ProgressPage } from '../../pages/ProgressPage.js';
import type { NetworkState } from '../hooks/useNetwork.js';
import type { SettingsState } from '../hooks/useSettings.js';

export interface ProgressPanelProps {
    readonly network: NetworkState;
    readonly settings: SettingsState;
}

export function ProgressPanel({ network, settings }: ProgressPanelProps) {
    return (
        <ProgressPage
            network={network.network}
            marketProgress={network.marketProgress}
            marketProgressStatus={network.marketProgressStatus}
            servers={network.servers}
            panelOpen={settings.panelOpen}
            onPanelOpenChange={settings.updatePanelOpen}
        />
    );
}
