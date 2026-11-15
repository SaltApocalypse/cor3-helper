import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JobQueueProgress, MarketOptionsView, PopupPortal, PopupVersionInfo } from '../../../application/popup/portal.js';
import { JOB_MARKETS } from '../../../application/popup/catalog.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { PopupPage } from '../AppShell.js';

/**
 * Portal connection concern (H8 phase 7).
 *
 * Owns ping/version/detail plus the background event and storage
 * subscriptions. Reconnection/backoff is out of scope (M8) and can be added
 * here without touching the feature hooks.
 */

export type PingState = 'idle' | 'checking' | 'ok' | 'error';

export interface PortalConnection {
    readonly ping: PingState;
    readonly version: PopupVersionInfo | null;
    readonly detail: string;
    readonly setDetail: (message: string) => void;
    /**
     * Pings the background. The translate function is passed at call time so
     * the message uses the language that is current when the ping happens.
     */
    readonly check: (tr: TranslateSource) => Promise<void>;
}

export function usePortalConnection(portal: PopupPortal): PortalConnection {
    const [ping, setPing] = useState<PingState>('idle');
    const [version, setVersion] = useState<PopupVersionInfo | null>(null);
    const [detail, setDetail] = useState('Waiting for background service worker');

    const check = useCallback(async (tr: TranslateSource) => {
        setPing('checking');
        setDetail(tr('Contacting background service worker...'));
        const response = await portal.ping();
        if (response.ok) {
            setPing('ok');
            setDetail(tr('Background online ({version}, {phase})', { version: response.value.version, phase: response.value.phase }));
        } else {
            setPing('error');
            setDetail(response.error.message);
        }
    }, [portal]);

    useEffect(() => {
        setVersion(portal.versionInfo());
    }, [portal]);

    return { ping, version, detail, setDetail, check };
}

/** Callbacks the background event bridge dispatches to. */
export interface PortalEventHandlers {
    readonly activePage: PopupPage;
    readonly reloadSettings: () => void | Promise<void>;
    readonly reloadNetwork: () => void | Promise<void>;
    readonly reloadAutoFinish: () => void | Promise<void>;
    readonly reloadDebugLogs: (silent?: boolean) => void | Promise<void>;
    readonly reloadCredits: () => void | Promise<void>;
    readonly reloadMarketProgress: (force?: boolean) => void | Promise<void>;
    readonly mergeMarketProgress: (marketKey: string, value: MarketOptionsView) => void;
    readonly reloadAutoJobs: () => void | Promise<void>;
    readonly reloadAutoJobsSnapshot: () => void | Promise<void>;
    readonly reloadJobHistory: () => void | Promise<void>;
    readonly reloadDaily: (silent?: boolean) => void | Promise<void>;
    readonly reloadAutoDaily: () => void | Promise<void>;
    readonly reloadAutoExpedition: () => void | Promise<void>;
    readonly reloadExpeditions: () => void | Promise<void>;
    readonly applyQueueProgress: (progress: JobQueueProgress) => void;
}

/**
 * Background event/storage subscriptions. Lives next to {@link usePortalConnection}
 * because the portal subscription is a connection concern, not a feature one.
 * Handlers are read through a ref, so a re-render does not resubscribe.
 */
export function usePortalEvents(portal: PopupPortal, handlers: PortalEventHandlers): void {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => portal.subscribeStorage((keys) => {
        const current = handlersRef.current;
        if (keys.includes('v2.settings')) void current.reloadSettings();
        // Network snapshots are written by the background; settings and panel
        // layout churn must not trigger a three-call network refresh.
        if (keys.includes('v2.network.snapshot')) void current.reloadNetwork();
    }), [portal]);

    useEffect(() => portal.subscribeEvents((event) => {
        const current = handlersRef.current;
        if (event.type === 'auto.jobs.live' || event.type === 'auto.jobs.progress' || event.type === 'auto.jobs.done' || event.type === 'auto.start') {
            void current.reloadAutoFinish();
            void current.reloadDebugLogs(true);
        }
        if (event.type === 'auto.jobs.done') {
            void current.reloadCredits();
            void current.reloadJobHistory();
            if (current.activePage === 'progress') void current.reloadMarketProgress(false);
        }
        if (event.type === 'market.reputation.updated') {
            const payload = event.payload as {
                marketId?: unknown;
                credits?: unknown;
                reputation?: unknown;
            } | undefined;
            const market = typeof payload?.marketId === 'string'
                ? JOB_MARKETS.find((entry) => entry.marketId === payload.marketId)
                : undefined;
            if (market && typeof payload?.credits === 'number') {
                const reputation = payload.reputation;
                const validReputation = reputation === null || (
                    typeof reputation === 'object'
                    && typeof (reputation as { level?: unknown }).level === 'number'
                    && typeof (reputation as { progress?: unknown }).progress === 'number'
                    && typeof (reputation as { required?: unknown }).required === 'number'
                    && typeof (reputation as { levelLocked?: unknown }).levelLocked === 'boolean'
                    && typeof (reputation as { maxLevel?: unknown }).maxLevel === 'boolean'
                );
                if (validReputation) {
                    current.mergeMarketProgress(market.key, {
                        marketId: market.marketId,
                        marketName: market.label,
                        credits: payload.credits,
                        reputation: reputation as MarketOptionsView['reputation'],
                    });
                }
            }
        }
        if (event.type === 'auto.jobs.cycle' || event.type === 'auto.jobs.schedule') {
            void current.reloadAutoJobs();
        }
        if (event.type === 'auto.jobs.snapshot') {
            void current.reloadAutoJobsSnapshot();
            void current.reloadAutoJobs();
        }
        if (event.type === 'daily.auto.done') {
            void current.reloadDaily(true);
            void current.reloadAutoDaily();
            void current.reloadDebugLogs(true);
        }
        if (event.type === 'expeditions.auto.preparing' || event.type === 'expeditions.auto.done') {
            void current.reloadAutoExpedition();
            if (event.type === 'expeditions.auto.done') void current.reloadExpeditions();
        }
        if (event.type === 'network.queue' || event.type === 'game.readiness') {
            void current.reloadNetwork();
        }
        if (event.type === 'job.queue.progress') {
            const payload = event.payload as { runId?: unknown; progress?: unknown } | undefined;
            if (payload && typeof payload.runId === 'string' && payload.progress && typeof payload.progress === 'object') {
                current.applyQueueProgress(payload.progress as JobQueueProgress);
            }
        }
    }), [portal]);
}
