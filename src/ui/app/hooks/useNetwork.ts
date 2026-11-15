import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { JOB_MARKETS } from '../../../application/popup/catalog.js';
import type { DiscoveryResult } from '../../../application/network/discovery.js';
import type { NetworkOperationQueueStatus } from '../../../application/network/operation-queue.js';
import type { NetworkMapSummary } from '../../../application/network/summary.js';
import type { MarketOptionsView, NetworkDiagnostics, NetworkServerSummary, PopupPortal } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Network map, diagnostics, operation queue, discovery and market reputation
 * (H8 phase 7). Diagnostics here are the `system.diagnostics` payload shown on
 * the developer page, not the network snapshot.
 */

export interface NetworkDeps {
    readonly reportDetail: (message: string) => void;
    readonly tt: TranslateSource;
    readonly activePage: PopupPage;
}

export interface NetworkState {
    readonly network: NetworkMapSummary | null;
    readonly networkDiag: NetworkDiagnostics | null;
    readonly networkQueue: NetworkOperationQueueStatus | null;
    readonly servers: readonly NetworkServerSummary[];
    readonly discovery: DiscoveryResult | null;
    readonly marketProgress: Readonly<Record<string, MarketOptionsView>>;
    readonly marketProgressStatus: string;
    readonly diagnostics: Record<string, unknown> | null;
    readonly diagnosticsBusy: boolean;
    readonly loadNetwork: () => Promise<void>;
    readonly loadServers: () => Promise<void>;
    readonly runDiscovery: () => Promise<void>;
    readonly loadMarketProgress: (force?: boolean) => Promise<void>;
    readonly mergeMarketProgress: (key: string, value: MarketOptionsView) => void;
    readonly loadDiagnostics: () => Promise<void>;
}

export function useNetwork(portal: PopupPortal, deps: NetworkDeps): NetworkState {
    const { reportDetail, tt, activePage } = deps;
    const [network, setNetwork] = useState<NetworkMapSummary | null>(null);
    const [networkDiag, setNetworkDiag] = useState<NetworkDiagnostics | null>(null);
    const [networkQueue, setNetworkQueue] = useState<NetworkOperationQueueStatus | null>(null);
    const [servers, setServers] = useState<readonly NetworkServerSummary[]>([]);
    const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
    const [marketProgress, setMarketProgress] = useState<Readonly<Record<string, MarketOptionsView>>>({});
    const marketProgressRef = useRef<Record<string, MarketOptionsView>>({});
    const marketProgressBusy = useRef(false);
    const [marketProgressStatus, setMarketProgressStatus] = useState('Market data not loaded');
    const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
    const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);

    const loadNetwork = useCallback(async () => {
        const [response, diagnosticsResponse, queue] = await Promise.all([portal.networkSummary(), portal.networkDiagnostics(), portal.networkQueueStatus()]);
        if (response.ok) setNetwork(response.value);
        else reportDetail(response.error.message);
        if (diagnosticsResponse.ok) setNetworkDiag(diagnosticsResponse.value);
        if (queue.ok) setNetworkQueue(queue.value);
    }, [portal, reportDetail]);

    const loadServers = useCallback(async () => {
        const response = await portal.networkServers();
        if (!response.ok) {
            reportDetail(response.error.message);
            return;
        }
        setServers(response.value);
    }, [portal, reportDetail]);

    const loadDiagnostics = useCallback(async () => {
        setDiagnosticsBusy(true);
        const response = await portal.diagnostics();
        setDiagnostics(response.ok ? response.value : { error: response.error });
        setDiagnosticsBusy(false);
    }, [portal]);

    const runDiscovery = useCallback(async () => {
        reportDetail(tt('Scanning 4 known IPs...'));
        const response = await portal.discover(4);
        if (response.ok) {
            setDiscovery(response.value);
            reportDetail(tt('Discovery run complete'));
            void loadNetwork();
            void loadServers();
        } else {
            reportDetail(response.error.message);
        }
    }, [portal, loadNetwork, loadServers, reportDetail, tt]);

    const loadMarketProgress = useCallback(async (force = false) => {
        if (marketProgressBusy.current) return;
        marketProgressBusy.current = true;
        setMarketProgressStatus(force ? tt('Refreshing market reputation...') : tt('Loading market reputation...'));
        const next: Record<string, MarketOptionsView> = { ...marketProgressRef.current };
        const commit = (key: string, value: MarketOptionsView) => {
            next[key] = value;
            marketProgressRef.current = { ...next };
            setMarketProgress({ ...next });
        };
        try {
            for (const market of JOB_MARKETS) {
                const cached = await portal.cachedMarket(market);
                if (cached.ok && cached.value) {
                    commit(market.key, {
                        marketId: cached.value.view.marketId,
                        marketName: cached.value.view.marketName,
                        credits: cached.value.view.credits,
                        reputation: cached.value.view.reputation,
                    });
                    // The Progress page is a persisted status view. Refreshing
                    // four markets every minute used to move the game endpoint
                    // and race Auto Jobs, so only fetch live on first load or
                    // an explicit force refresh.
                    if (!force) continue;
                }
                const fresh = await portal.marketOptions(market);
                if (fresh.ok) commit(market.key, fresh.value);
            }
            setMarketProgressStatus(tt('{loaded}/{total} market(s) loaded', { loaded: Object.keys(next).length, total: JOB_MARKETS.length }));
        } finally {
            marketProgressBusy.current = false;
        }
    }, [portal, tt]);

    const mergeMarketProgress = useCallback((key: string, value: MarketOptionsView) => {
        setMarketProgress((current) => {
            const next = { ...current, [key]: value };
            marketProgressRef.current = { ...next };
            return next;
        });
    }, []);

    useEffect(() => {
        void loadNetwork();
        void loadServers();
    }, [loadNetwork, loadServers]);

    usePolling(loadMarketProgress, 60000, { enabled: activePage === 'progress' });

    return {
        network,
        networkDiag,
        networkQueue,
        servers,
        discovery,
        marketProgress,
        marketProgressStatus,
        diagnostics,
        diagnosticsBusy,
        loadNetwork,
        loadServers,
        runDiscovery,
        loadMarketProgress,
        mergeMarketProgress,
        loadDiagnostics,
    };
}
