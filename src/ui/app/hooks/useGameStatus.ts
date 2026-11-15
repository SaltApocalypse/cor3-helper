import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ActivityState, OverviewState, PopupPortal } from '../../../application/popup/portal.js';
import { JOB_MARKETS } from '../../../application/popup/catalog.js';
import { isGameReady } from '../../../application/game/readiness.js';
import type { PopupPage } from '../AppShell.js';
import { usePolling } from './usePolling.js';

/**
 * Overview activity/credits and the game-tab readiness shown on the settings
 * page (H8 phase 7).
 */

export interface GameStatusDeps {
    readonly activePage: PopupPage;
    readonly loadNetwork: () => Promise<void>;
}

export interface GameStatusState {
    readonly activity: ActivityState | null;
    readonly overview: OverviewState | null;
    readonly credits: number | null;
    readonly gameTabReady: boolean;
    readonly loadActivity: () => Promise<void>;
    readonly loadCredits: () => Promise<void>;
    readonly loadOverview: () => Promise<void>;
}

export function useGameStatus(portal: PopupPortal, deps: GameStatusDeps): GameStatusState {
    const { activePage, loadNetwork } = deps;
    const [activity, setActivity] = useState<ActivityState | null>(null);
    const [overview, setOverview] = useState<OverviewState | null>(null);
    const [credits, setCredits] = useState<number | null>(null);
    const [gameTabReady, setGameTabReady] = useState(false);

    const loadActivity = useCallback(async () => {
        const response = await portal.activityState();
        if (response.ok) setActivity(response.value);
    }, [portal]);

    const loadCredits = useCallback(async () => {
        const home = JOB_MARKETS.find((market) => market.key === 'home') ?? JOB_MARKETS[0];
        if (!home) return;
        const response = await portal.marketOptions(home);
        if (response.ok) {
            setCredits(response.value.credits);
            return;
        }
        const cached = await portal.cachedMarket(home);
        if (cached.ok && cached.value) setCredits(cached.value.view.credits);
    }, [portal]);

    const loadOverview = useCallback(async () => {
        const response = await portal.overviewState();
        if (!response.ok) return;
        setOverview(response.value);
        setGameTabReady(response.value.readiness.some((entry) => isGameReady(entry.readiness)));
    }, [portal]);

    usePolling(loadActivity, 3000, { enabled: activePage === 'overview' });
    usePolling(loadOverview, 10000, { enabled: activePage === 'overview' });
    usePolling(loadCredits, 60000, { enabled: activePage === 'overview' });

    // Opening the settings page also refreshes the network summary once; the
    // poll below covers readiness only, as before.
    useEffect(() => {
        if (activePage !== 'settings') return;
        void loadNetwork();
    }, [activePage, loadNetwork]);
    usePolling(loadOverview, 15000, { enabled: activePage === 'settings' });

    return { activity, overview, credits, gameTabReady, loadActivity, loadCredits, loadOverview };
}
