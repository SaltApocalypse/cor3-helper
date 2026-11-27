import { useCallback, useEffect, useState } from 'preact/hooks';
import type { LoadoutView, PopupPortal } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';
import type { LoadoutFeedback } from '../../pages/LoadoutPage.js';

/**
 * Loadout view, recommendation and module equipping (H8 phase 7).
 */

export interface LoadoutState {
    readonly loadout: LoadoutView | null;
    readonly loadoutStatus: string;
    readonly loadoutFeedback: LoadoutFeedback | null;
    readonly loadoutAbility: 'HACK' | 'DECRYPT' | 'SEARCH';
    readonly setLoadoutAbility: (ability: 'HACK' | 'DECRYPT' | 'SEARCH') => void;
    readonly loadoutTarget: string;
    readonly setLoadoutTarget: (target: string) => void;
    readonly loadoutPower: number;
    readonly setLoadoutPower: (power: number) => void;
    readonly loadoutBusy: boolean;
    readonly loadoutLoading: boolean;
    readonly setLoadoutFeedback: (feedback: LoadoutFeedback | null) => void;
    readonly loadLoadout: () => Promise<void>;
    readonly applyLoadout: (strategy?: 'best' | 'weakest') => Promise<void>;
    readonly equipLoadoutHardware: (moduleConfigId: string) => Promise<void>;
    readonly equipLoadoutSoftware: (moduleConfigId: string) => Promise<void>;
    readonly unequipLoadoutSoftware: (moduleConfigId: string) => Promise<void>;
}

export function useLoadout(portal: PopupPortal, tt: TranslateSource): LoadoutState {
    const [loadout, setLoadout] = useState<LoadoutView | null>(null);
    const [loadoutStatus, setLoadoutStatus] = useState('Loadout not loaded');
    const [loadoutFeedback, setLoadoutFeedback] = useState<LoadoutFeedback | null>(null);
    const [loadoutAbility, setLoadoutAbility] = useState<'HACK' | 'DECRYPT' | 'SEARCH'>('HACK');
    const [loadoutTarget, setLoadoutTarget] = useState('');
    const [loadoutPower, setLoadoutPower] = useState(0);
    const [loadoutBusy, setLoadoutBusy] = useState(false);
    const [loadoutLoading, setLoadoutLoading] = useState(false);

    const loadLoadout = useCallback(async () => {
        setLoadoutLoading(true);
        try {
            const response = await portal.loadoutView();
            if (response.ok) {
                setLoadout(response.value);
                setLoadoutStatus(tt('{hardware} hardware / {software} software owned', { hardware: response.value.ownedHardware, software: response.value.ownedSoftware }));
            } else {
                setLoadoutStatus(tt('Loadout load failed'));
                setLoadoutFeedback({ scope: 'general', message: response.error.message, tone: 'error' });
            }
        } finally {
            setLoadoutLoading(false);
        }
    }, [portal, tt]);

    useEffect(() => {
        void loadLoadout();
    }, [loadLoadout]);

    const applyLoadout = useCallback(async (strategy: 'best' | 'weakest' = 'best') => {
        setLoadoutBusy(true);
        setLoadoutFeedback({ scope: 'recommend', message: strategy === 'weakest' ? tt('Applying weakest viable loadout...') : tt('Applying recommended loadout...') });
        const response = await portal.applyLoadout(loadoutAbility, loadoutTarget, loadoutPower, strategy);
        setLoadoutFeedback(response.ok
            ? { scope: 'recommend', message: `${strategy === 'weakest' ? tt('Weakest') : tt('Optimized')} · ${response.value.ability} ${response.value.target} · ${response.value.softwareName} · ${tt('Power')} ${response.value.power}/${response.value.requiredPower} · ${response.value.feasible ? tt('feasible') : tt('infeasible')}`, tone: response.value.feasible ? 'ok' : 'warn' }
            : { scope: 'recommend', message: response.error.message, tone: 'error' });
        setLoadoutBusy(false);
        if (response.ok) await loadLoadout();
    }, [portal, loadoutAbility, loadoutTarget, loadoutPower, loadLoadout, tt]);

    const equipLoadoutHardware = useCallback(async (moduleConfigId: string) => {
        setLoadoutFeedback({ scope: 'hardware', message: tt('Equipping hardware...') });
        const response = await portal.equipLoadoutHardware(moduleConfigId);
        if (response.ok) await loadLoadout();
        setLoadoutFeedback({ scope: 'hardware', message: response.ok ? tt('Hardware equipped') : response.error.message, tone: response.ok ? 'ok' : 'error' });
    }, [portal, loadLoadout, tt]);

    const equipLoadoutSoftware = useCallback(async (moduleConfigId: string) => {
        setLoadoutFeedback({ scope: 'software', message: tt('Installing software...') });
        const response = await portal.equipLoadoutSoftware(moduleConfigId);
        if (response.ok) await loadLoadout();
        setLoadoutFeedback({ scope: 'software', message: response.ok ? tt('Software installed') : response.error.message, tone: response.ok ? 'ok' : 'error' });
    }, [portal, loadLoadout, tt]);

    const unequipLoadoutSoftware = useCallback(async (moduleConfigId: string) => {
        setLoadoutFeedback({ scope: 'software', message: tt('Uninstalling software...') });
        const response = await portal.unequipLoadoutSoftware(moduleConfigId);
        if (response.ok) await loadLoadout();
        setLoadoutFeedback({ scope: 'software', message: response.ok ? tt('Software uninstalled') : response.error.message, tone: response.ok ? 'ok' : 'error' });
    }, [portal, loadLoadout, tt]);

    return {
        loadout,
        loadoutStatus,
        loadoutFeedback,
        loadoutAbility,
        setLoadoutAbility,
        loadoutTarget,
        setLoadoutTarget,
        loadoutPower,
        setLoadoutPower,
        loadoutBusy,
        loadoutLoading,
        setLoadoutFeedback,
        loadLoadout,
        applyLoadout,
        equipLoadoutHardware,
        equipLoadoutSoftware,
        unequipLoadoutSoftware,
    };
}
