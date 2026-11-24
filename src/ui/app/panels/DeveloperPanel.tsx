import { useState } from 'preact/hooks';
import type { PopupPortal } from '../../../application/popup/portal.js';
import { t } from '../../i18n.js';
import { DeveloperPage } from '../../pages/DeveloperPage.js';
import type { DebugLogsState } from '../hooks/useDebugLogs.js';
import type { NetworkState } from '../hooks/useNetwork.js';
import type { PortalConnection } from '../hooks/usePortalConnection.js';
import type { SettingsState } from '../hooks/useSettings.js';

export interface DeveloperPanelProps {
    readonly portal: PopupPortal;
    readonly connection: PortalConnection;
    readonly network: NetworkState;
    readonly debug: DebugLogsState;
    readonly settings: SettingsState;
    readonly debugLive: boolean;
}

export function DeveloperPanel({
    portal,
    connection,
    network,
    debug,
    settings,
    debugLive,
}: DeveloperPanelProps) {
    const [loadoutDumpBusy, setLoadoutDumpBusy] = useState(false);
    const [loadoutDumpStatus, setLoadoutDumpStatus] = useState('');

    const exportLoadout = async () => {
        setLoadoutDumpBusy(true);
        setLoadoutDumpStatus(t(settings.language, 'developer.loadout.reading'));
        try {
            const response = await portal.dumpLoadout();
            if (!response.ok) {
                setLoadoutDumpStatus(response.error.message);
                return;
            }
            portal.exportText(response.value.fileName, response.value.json);
            setLoadoutDumpStatus(`${t(settings.language, 'developer.loadout.done')} · ${response.value.fileName}`);
        } catch (error) {
            setLoadoutDumpStatus(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadoutDumpBusy(false);
        }
    };

    return (
        <DeveloperPage
            language={settings.language}
            detail={connection.detail}
            onPing={() => connection.check(settings.tt)}
            network={network.network}
            networkDiag={network.networkDiag}
            networkQueue={network.networkQueue}
            discovery={network.discovery}
            onRefreshNetwork={network.loadNetwork}
            onDiscover={network.runDiscovery}
            diagnostics={network.diagnostics}
            diagnosticsBusy={network.diagnosticsBusy}
            onRefreshDiagnostics={network.loadDiagnostics}
            onCopyDiagnostics={async () => {
                if (network.diagnostics) await portal.copyText(JSON.stringify(network.diagnostics, null, 2));
            }}
            onCopyAutoJobsSnapshot={async () => {
                const snapshot = await portal.autoJobsSnapshot();
                const value = snapshot.ok && snapshot.value !== null
                    ? snapshot.value
                    : { snapshot: null, autoJobsDiagnostics: network.diagnostics?.autoJobs ?? null };
                await portal.copyText(JSON.stringify(value, null, 2));
            }}
            onExportLoadout={exportLoadout}
            loadoutDumpBusy={loadoutDumpBusy}
            loadoutDumpStatus={loadoutDumpStatus}
            debugLines={debug.debugLogs}
            debugLoading={debug.debugLogsLoading}
            debugLive={debugLive}
            onOpenDebug={async () => { await debug.loadDebugLogs(); }}
            onRefreshDebug={debug.refreshDebugLogs}
            onCopyDebug={debug.copyDebugLogs}
            onExportDebug={debug.exportDebugLogs}
            panelOpen={settings.panelOpen}
            onPanelOpenChange={settings.updatePanelOpen}
        />
    );
}
