import { useCallback, useEffect, useState } from 'preact/hooks';
import type { AutoMailStatus, PopupPortal } from '../../../application/popup/portal.js';
import type { TranslateSource } from '../../i18n-context.js';

/**
 * Auto Mail switch and mailbox collection (H8 phase 7).
 * Collection results surface through the inventory status line, as before.
 */

export interface MailDeps {
    readonly tt: TranslateSource;
    readonly setInventoryStatus: (value: string) => void;
    readonly loadInventory: () => Promise<void>;
}

export interface MailState {
    readonly autoMail: AutoMailStatus | null;
    readonly autoMailBusy: boolean;
    readonly mailClaimBusy: boolean;
    readonly loadAutoMail: () => Promise<void>;
    readonly toggleAutoMail: () => Promise<void>;
    readonly claimMailboxNow: () => Promise<void>;
}

export function useMail(portal: PopupPortal, deps: MailDeps): MailState {
    const { tt, setInventoryStatus, loadInventory } = deps;
    const [autoMail, setAutoMail] = useState<AutoMailStatus | null>(null);
    const [autoMailBusy, setAutoMailBusy] = useState(false);
    const [mailClaimBusy, setMailClaimBusy] = useState(false);

    const loadAutoMail = useCallback(async () => {
        const response = await portal.autoMailStatus();
        if (response.ok) {
            setAutoMail(response.value);
        }
    }, [portal]);

    useEffect(() => {
        void loadAutoMail();
    }, [loadAutoMail]);

    const toggleAutoMail = useCallback(async () => {
        if (autoMailBusy) return;
        setAutoMailBusy(true);
        try {
            const response = autoMail?.enabled
                ? await portal.disableAutoMail()
                : await portal.enableAutoMail(45);
            if (!response.ok) setInventoryStatus(response.error.message);
        } finally {
            setAutoMailBusy(false);
        }
        await loadAutoMail();
    }, [portal, autoMail, autoMailBusy, loadAutoMail, setInventoryStatus]);

    const claimMailboxNow = useCallback(async () => {
        if (mailClaimBusy) return;
        setMailClaimBusy(true);
        try {
            const response = await portal.claimPendingMail();
            if (response.ok) {
                setInventoryStatus(`${tt('Claimed {count} mail message(s)', { count: response.value.claimed })}${response.value.failed.length > 0 ? tt(' · {count} failed', { count: response.value.failed.length }) : ''}${response.value.stashFull ? tt(' · stash full') : ''}`);
                await loadInventory();
            } else {
                setInventoryStatus(response.error.message);
            }
        } finally {
            setMailClaimBusy(false);
        }
    }, [portal, mailClaimBusy, loadInventory, setInventoryStatus, tt]);

    return {
        autoMail,
        autoMailBusy,
        mailClaimBusy,
        loadAutoMail,
        toggleAutoMail,
        claimMailboxNow,
    };
}
