import type { DiscoveryResult } from '../../application/network/discovery.js';
import type { NetworkOperationQueueStatus } from '../../application/network/operation-queue.js';
import type { NetworkMapSummary } from '../../application/network/summary.js';
import type { NetworkDiagnostics } from '../../application/popup/portal.js';
import type { DebugLogLine } from '../components/DebugConsole.js';
import { DebugConsole } from '../components/DebugConsole.js';
import { GameSection } from '../components/GameSection.js';
import { RefreshButton } from '../components/RefreshButton.js';
import { t, type UiLanguage } from '../i18n.js';
import { useT } from '../i18n-context.js';

export interface DeveloperPageProps {
    readonly language: UiLanguage;
    readonly detail: string;
    readonly onPing: () => void | Promise<void>;
    readonly network: NetworkMapSummary | null;
    readonly networkDiag: NetworkDiagnostics | null;
    readonly networkQueue: NetworkOperationQueueStatus | null;
    readonly discovery: DiscoveryResult | null;
    readonly onRefreshNetwork: () => void | Promise<void>;
    readonly onDiscover: () => void | Promise<void>;
    readonly diagnostics: Record<string, unknown> | null;
    readonly diagnosticsBusy: boolean;
    readonly onRefreshDiagnostics: () => void | Promise<void>;
    readonly onCopyDiagnostics: () => void | Promise<void>;
    readonly onCopyAutoJobsSnapshot: () => void | Promise<void>;
    readonly onExportLoadout: () => void | Promise<void>;
    readonly loadoutDumpBusy: boolean;
    readonly loadoutDumpStatus: string;
    readonly debugLines: readonly DebugLogLine[];
    readonly debugLoading: boolean;
    readonly debugLive: boolean;
    readonly onOpenDebug: () => void | Promise<void>;
    readonly onRefreshDebug: () => void;
    readonly onCopyDebug: (text: string) => void | Promise<void>;
    readonly onExportDebug: (text: string) => void;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
}

export function DeveloperPage({
    language,
    detail,
    onPing,
    network,
    networkDiag,
    networkQueue,
    discovery,
    onRefreshNetwork,
    onDiscover,
    diagnostics,
    diagnosticsBusy,
    onRefreshDiagnostics,
    onCopyDiagnostics,
    onCopyAutoJobsSnapshot,
    onExportLoadout,
    loadoutDumpBusy,
    loadoutDumpStatus,
    debugLines,
    debugLoading,
    debugLive,
    onOpenDebug,
    onRefreshDebug,
    onCopyDebug,
    onExportDebug,
    panelOpen,
    onPanelOpenChange,
}: DeveloperPageProps) {
    const tr = useT();
    return (
        <>
            <p class="v2-page-intro v2-muted">{t(language, 'developer.intro')}</p>

            <GameSection
                title={t(language, 'developer.runtime.title')}
                description={t(language, 'developer.runtime.description')}
                expanded={panelOpen['developer.runtime'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('developer.runtime', open)}
            >
                <p class="v2-muted">{tr(detail)}</p>
                <div class="v2-actions">
                    <button type="button" onClick={() => void onPing()}>{t(language, 'developer.ping')}</button>
                </div>
            </GameSection>

            <GameSection
                title={t(language, 'developer.network.title')}
                description={t(language, 'developer.network.description')}
                expanded={panelOpen['developer.network'] ?? false}
                onOpenChange={(open) => onPanelOpenChange('developer.network', open)}
                actions={<RefreshButton label={t(language, 'developer.network.refresh')} onClick={onRefreshNetwork} />}
            >
                {network ? (
                    <>
                        <div class="v2-stat-grid">
                            <article><span>{t(language, 'developer.servers')}</span><strong>{network.serverCount}</strong></article>
                            <article><span>{t(language, 'developer.connections')}</span><strong>{network.connectionCount}</strong></article>
                            <article><span>{t(language, 'developer.hiddenConnections')}</span><strong>{network.hiddenConnectionCount}</strong></article>
                        </div>
                        <div class="v2-session-grid">
                            <div class="v2-session-row">
                                <span>{t(language, 'developer.home')}</span>
                                <strong>{network.home ?? t(language, 'developer.detailUnknown')}</strong>
                            </div>
                            <div class="v2-session-row">
                                <span>{t(language, 'developer.endpoint')}</span>
                                <strong>{network.endpoint ?? t(language, 'developer.detailNone')}</strong>
                            </div>
                            {networkDiag ? (
                                <>
                                    <div class="v2-session-row">
                                        <span>{t(language, 'developer.accessible')}</span>
                                        <strong>{networkDiag.accessibleCount}</strong>
                                    </div>
                                    <div class="v2-session-row">
                                        <span>{t(language, 'developer.endpointCapable')}</span>
                                        <strong>{networkDiag.endpointCapableCount}</strong>
                                    </div>
                                    <div class="v2-session-row">
                                        <span>{t(language, 'developer.maintenance')}</span>
                                        <strong>{networkDiag.maintenanceCount}</strong>
                                    </div>
                                </>
                            ) : null}
                            {networkQueue ? (
                                <div class="v2-session-row">
                                    <span>{t(language, 'developer.queue')}</span>
                                    <strong>
                                        {networkQueue.running
                                            ? `${networkQueue.running.reason} (${networkQueue.running.owner})`
                                            : t(language, 'developer.queueIdle')}
                                        {networkQueue.waiting.length
                                            ? ` · ${t(language, 'developer.queueWaiting', { count: networkQueue.waiting.length })}`
                                            : ''}
                                    </strong>
                                </div>
                            ) : null}
                        </div>
                        {networkDiag?.maintenance.length ? (
                            <p class="v2-muted">
                                {networkDiag.maintenance.slice(0, 4).map((entry) => entry.name).join(', ')}
                            </p>
                        ) : null}
                    </>
                ) : (
                    <p class="v2-muted">{t(language, 'developer.network.waiting')}</p>
                )}
                <div class="v2-actions">
                    <button type="button" onClick={() => void onDiscover()}>{t(language, 'developer.network.discover')}</button>
                </div>
                {discovery ? (
                    <p class="v2-muted">
                        {t(language, 'developer.scan', {
                            scanned: discovery.scanned,
                            total: discovery.total,
                            edges: discovery.newConnections,
                            servers: discovery.newServers,
                        })}
                        {discovery.partial ? t(language, 'developer.scanPartial') : ''}
                        {discovery.reason ? ` · ${discovery.reason}` : ''}
                    </p>
                ) : null}
            </GameSection>

            <GameSection
                title={t(language, 'developer.diagnostics.title')}
                description={t(language, 'developer.diagnostics.description')}
                expanded={panelOpen['developer.diagnostics'] ?? false}
                onOpenChange={(open) => onPanelOpenChange('developer.diagnostics', open)}
            >
                <div class="v2-actions">
                    <button type="button" disabled={diagnosticsBusy} onClick={() => void onRefreshDiagnostics()}>
                        {t(language, 'developer.diagnostics.refresh')}
                    </button>
                    <button type="button" disabled={!diagnostics} onClick={() => void onCopyDiagnostics()}>
                        {t(language, 'developer.diagnostics.copy')}
                    </button>
                    <button type="button" onClick={() => void onCopyAutoJobsSnapshot()}>
                        {t(language, 'developer.diagnostics.snapshot')}
                    </button>
                </div>
                {diagnostics
                    ? <pre class="v2-diagnostics">{JSON.stringify(diagnostics, null, 2)}</pre>
                    : <p class="v2-muted">{t(language, 'developer.diagnostics.notLoaded')}</p>}
            </GameSection>

            <GameSection
                title={t(language, 'developer.loadout.title')}
                description={t(language, 'developer.loadout.description')}
                expanded={panelOpen['developer.loadout'] ?? false}
                onOpenChange={(open) => onPanelOpenChange('developer.loadout', open)}
            >
                <div class="v2-actions">
                    <button type="button" disabled={loadoutDumpBusy} onClick={() => void onExportLoadout()}>
                        {loadoutDumpBusy ? t(language, 'developer.loadout.reading') : t(language, 'developer.loadout.export')}
                    </button>
                </div>
                {loadoutDumpStatus ? <p class="v2-muted">{loadoutDumpStatus}</p> : null}
                <p class="v2-muted">{t(language, 'developer.loadout.hint')}</p>
            </GameSection>

            <GameSection
                title={t(language, 'developer.debug.title')}
                description={t(language, 'developer.debug.description')}
                expanded={panelOpen['developer.debug'] ?? false}
                onOpenChange={(open) => onPanelOpenChange('developer.debug', open)}
            >
                <DebugConsole
                    embedded
                    lines={debugLines}
                    loading={debugLoading}
                    live={debugLive}
                    onOpen={onOpenDebug}
                    onRefresh={onRefreshDebug}
                    onCopy={onCopyDebug}
                    onExport={onExportDebug}
                />
            </GameSection>
        </>
    );
}
