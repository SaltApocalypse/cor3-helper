import type { MarketOptionsView, NetworkServerSummary } from '../../application/popup/portal.js';
import type { NetworkMapSummary } from '../../application/network/summary.js';
import { JOB_MARKETS } from '../../application/popup/catalog.js';
import { GameSection } from '../components/GameSection.js';
import { MARKET_ICON, MARKET_SYMBOL } from '../market-icons.js';
import { useT } from '../i18n-context.js';

export interface ProgressPageProps {
    readonly network: NetworkMapSummary | null;
    readonly marketProgress: Readonly<Record<string, MarketOptionsView>>;
    readonly marketProgressStatus: string;
    readonly servers: readonly NetworkServerSummary[];
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
}

const SERVER_FALLBACK: Record<string, string> = {
    home: 'Home Server',
    dark: 'D4RK RM7CE',
    soyuz: 'SRM7-M',
    usol: 'URM7-M',
};

export function ProgressPage({
    network,
    marketProgress,
    marketProgressStatus,
    servers,
    panelOpen,
    onPanelOpenChange,
}: ProgressPageProps) {
    const tr = useT();
    return (
        <>
            <GameSection
                title={tr('Network Overview')}
                description={tr('Current network snapshot statistics.')}
                className="v2-progress-section"
                expanded={panelOpen['progress.network'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('progress.network', open)}
            >
                <div class="v2-stat-grid">
                    <article><span>{tr('Servers')}</span><strong>{network?.serverCount ?? '--'}</strong></article>
                    <article><span>{tr('Connections')}</span><strong>{network?.connectionCount ?? '--'}</strong></article>
                    <article><span>{tr('Hidden connections')}</span><strong>{network?.hiddenConnectionCount ?? '--'}</strong></article>
                </div>
            </GameSection>

            <GameSection
                title={tr('Market Reputation')}
                description={tr('Market reputation progress for each market.')}
                className="v2-progress-section"
                expanded={panelOpen['progress.market-reputation'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('progress.market-reputation', open)}
            >
                <p class="v2-muted">{tr(marketProgressStatus)}</p>
                <div class="v2-market-rep-grid">
                    {JOB_MARKETS.map((market) => {
                        const entry = marketProgress[market.key];
                        const reputation = entry?.reputation ?? null;
                        const required = reputation?.required ?? 0;
                        const progress = reputation?.progress ?? 0;
                        const percent = required > 0 ? Math.min(100, Math.floor((progress / required) * 100)) : 0;
                        const serverName = servers.find((server) => server.id === market.routeServerId)?.name
                            ?? SERVER_FALLBACK[market.key]
                            ?? market.label;
                        return (
                            <article key={market.key} class="v2-market-rep-card">
                                <header class="v2-market-rep-head">
                                    <span class="v2-market-rep-symbol">{MARKET_SYMBOL[market.key] ?? '◈'}</span>
                                    <strong>{market.label} <span class="v2-muted">({serverName})</span></strong>
                                    <span class="v2-market-rep-level">
                                        {reputation ? tr('Level {level}', { level: reputation.level }) : tr('No data')}
                                    </span>
                                </header>
                                <div class="v2-market-rep-body">
                                    <div class="v2-market-rep-info">
                                        <div class="v2-market-rep-progress-label">
                                            <span>{tr('Reputation')}</span>
                                            <strong>{reputation ? `${progress.toLocaleString()} / ${required.toLocaleString()}` : '--'}</strong>
                                        </div>
                                        <div class="v2-market-rep-bar">
                                            <div class="v2-market-rep-fill" style={{ width: `${percent}%` }} />
                                        </div>
                                        <div class="v2-market-rep-meta">
                                            <span>{tr('Level locked: {value}', { value: reputation ? (reputation.levelLocked ? tr('Yes') : tr('No')) : '--' })}</span>
                                            <span>{tr('Max level: {value}', { value: reputation ? (reputation.maxLevel ? tr('Yes') : tr('No')) : '--' })}</span>
                                        </div>
                                    </div>
                                    <img
                                        class="v2-market-rep-icon"
                                        src={MARKET_ICON[market.key] ?? 'factions/core_faction-96x96.png'}
                                        alt=""
                                    />
                                </div>
                            </article>
                        );
                    })}
                </div>
            </GameSection>
        </>
    );
}
