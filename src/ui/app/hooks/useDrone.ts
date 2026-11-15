import { useCallback, useEffect, useState } from 'preact/hooks';
import { DRONE_EXPEDITION_PROFILE, droneRefreshDelayMs } from '../../../application/popup/catalog.js';
import type { AutoDroneStatus, PopupPortal } from '../../../application/popup/portal.js';
import type { DroneState } from '../../../domains/drone/model.js';
import type { PopupPage } from '../AppShell.js';
import { usePollingLoop } from './usePolling.js';

/**
 * Drone expedition view, manual run and Auto Drone switch (H8 phase 7).
 * The view refresh delay comes from the drone model, so it is a self-
 * scheduling loop rather than a fixed interval.
 */

export interface DroneDeps {
    readonly activePage: PopupPage;
    readonly expeditionPanelOpen: boolean;
    readonly reloadSettings: () => Promise<void>;
}

export interface DroneStatus {
    readonly drone: DroneState | null;
    readonly droneBusy: boolean;
    readonly autoDrone: AutoDroneStatus | null;
    readonly loadDrone: () => Promise<DroneState | null>;
    readonly autoRunDrone: () => Promise<void>;
    readonly loadAutoDrone: () => Promise<void>;
    readonly toggleAutoDrone: () => Promise<string | null>;
}

export function useDrone(portal: PopupPortal, deps: DroneDeps): DroneStatus {
    const { activePage, expeditionPanelOpen, reloadSettings } = deps;
    const [drone, setDrone] = useState<DroneState | null>(null);
    const [droneBusy, setDroneBusy] = useState(false);
    const [autoDrone, setAutoDrone] = useState<AutoDroneStatus | null>(null);
    const [autoDroneInterval, setAutoDroneInterval] = useState(5);

    const loadDrone = useCallback(async (): Promise<DroneState | null> => {
        setDroneBusy(true);
        const response = await portal.droneView();
        if (response.ok) setDrone(response.value);
        setDroneBusy(false);
        return response.ok ? response.value : null;
    }, [portal]);

    const autoRunDrone = useCallback(async () => {
        setDroneBusy(true);
        const response = await portal.droneAutoRun();
        setDroneBusy(false);
        if (response.ok) await loadDrone();
    }, [portal, loadDrone]);

    const loadAutoDrone = useCallback(async () => {
        const response = await portal.autoDroneStatus();
        if (response.ok) {
            setAutoDrone(response.value);
            setAutoDroneInterval(response.value.intervalMinutes);
        }
    }, [portal]);

    useEffect(() => {
        void loadAutoDrone();
    }, [loadAutoDrone]);

    const toggleAutoDrone = useCallback(async (): Promise<string | null> => {
        setDroneBusy(true);
        const response = autoDrone?.enabled
            ? await portal.disableAutoDrone()
            : await portal.enableAutoDrone(autoDroneInterval);
        setDroneBusy(false);
        await Promise.all([loadAutoDrone(), reloadSettings()]);
        return response.ok ? null : response.error.message;
    }, [portal, autoDrone, autoDroneInterval, loadAutoDrone, reloadSettings]);

    usePollingLoop(async () => {
        const state = await loadDrone();
        return state
            ? droneRefreshDelayMs(state, DRONE_EXPEDITION_PROFILE.locationConfigId, DRONE_EXPEDITION_PROFILE.missionConfigId)
            : 60_000;
    }, { enabled: activePage === 'automation' && expeditionPanelOpen });

    return { drone, droneBusy, autoDrone, loadDrone, autoRunDrone, loadAutoDrone, toggleAutoDrone };
}
