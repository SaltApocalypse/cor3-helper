import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PopupPortal } from '../../application/popup/portal.js';
import type { AuthStatus, SettingsV1 } from '../../contracts/storage.js';
import type { UpdateCheckResult } from '../../contracts/update-check.js';
import { BrandHeader } from '../components/BrandHeader.js';
import { InfoTip } from '../components/InfoTip.js';
import { Modal } from '../components/Modal.js';
import { ToggleSwitch } from '../components/ToggleSwitch.js';
import { UpdateStatus } from '../components/UpdateStatus.js';
import { RELATED_LINKS } from './fork-info.js';
import { detectBrowserLanguage, t, type UiLanguage } from '../i18n.js';
import { LanguageProvider } from '../i18n-context.js';

export interface WelcomeAppProps {
    readonly portal: PopupPortal;
}

/**
 * Small launcher shown from the browser toolbar. The full workspace lives in
 * the side panel or a detached window so the popup can stay lightweight.
 */
export function WelcomeApp({ portal }: WelcomeAppProps) {
    const [auth, setAuth] = useState<AuthStatus | null>(null);
    const [settings, setSettings] = useState<SettingsV1 | null>(null);
    const [message, setMessage] = useState('');
    const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
    const [updateStatusError, setUpdateStatusError] = useState<string | null>(null);
    const [updateChecking, setUpdateChecking] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [confirmError, setConfirmError] = useState(false);
    const languageInitStarted = useRef(false);
    const updateRequestId = useRef(0);
    const language: UiLanguage = settings?.uiLanguage ?? 'en';
    const helperMode = settings?.helperMode ?? false;

    const refresh = useCallback(async () => {
        const updateRequest = ++updateRequestId.current;
        const [authResult, settingsResult, updateStatusResult] = await Promise.all([
            portal.authStatus(),
            portal.getSettings(),
            portal.updateStatus(),
        ]);
        if (authResult.ok) setAuth(authResult.value);
        if (settingsResult.ok) setSettings(settingsResult.value);
        if (updateRequest !== updateRequestId.current) return;
        if (updateStatusResult.ok) {
            setUpdateResult(updateStatusResult.value);
            setUpdateStatusError(null);
        } else {
            setUpdateStatusError(updateStatusResult.error.message);
        }
    }, [portal]);

    const checkUpdates = useCallback(async () => {
        if (updateChecking) return;
        setUpdateChecking(true);
        setUpdateStatusError(null);
        const updateRequest = ++updateRequestId.current;
        try {
            const response = await portal.updateCheck();
            if (updateRequest !== updateRequestId.current) return;
            if (response.ok) {
                setUpdateResult(response.value);
                setUpdateStatusError(null);
            } else {
                setUpdateStatusError(response.error.message);
            }
        } finally {
            setUpdateChecking(false);
        }
    }, [portal, updateChecking]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!settings || settings.languageInitialized || languageInitStarted.current) return;
        languageInitStarted.current = true;
        const detected = detectBrowserLanguage();
        void portal.updateSettings({
            ...(detected === settings.uiLanguage ? {} : { uiLanguage: detected }),
            languageInitialized: true,
        }).then((response) => {
            if (response.ok) setSettings(response.value);
        });
    }, [settings, portal]);

    const openSidePanel = useCallback(async () => {
        const opened = await portal.openSidePanel();
        if (!opened) setMessage(t(language, 'welcome.openFailed'));
    }, [portal, language]);

    const openWindow = useCallback(async () => {
        const opened = await portal.openWindow();
        if (!opened) setMessage(t(language, 'welcome.openWindowFailed'));
    }, [portal, language]);

    const applyHelperMode = useCallback(async (enabled: boolean) => {
        const response = await portal.updateSettings(enabled
            ? { helperMode: true }
            : { helperMode: false, helperModeConsent: true });
        if (response.ok) setSettings(response.value);
    }, [portal]);

    const requestHelperMode = (enabled: boolean) => {
        if (enabled || (settings?.helperModeConsent ?? false)) {
            void applyHelperMode(enabled);
            return;
        }
        setConfirmText('');
        setConfirmError(false);
        setConfirmOpen(true);
    };

    const confirmDisable = () => {
        const expected = t(language, 'settings.helperMode.confirmWord');
        if (confirmText.trim().toLocaleLowerCase() !== expected.toLocaleLowerCase()) {
            setConfirmError(true);
            return;
        }
        setConfirmOpen(false);
        setConfirmText('');
        void applyHelperMode(false);
    };

    return (
        <LanguageProvider language={language}>
        <main class="v2-shell v2-welcome">
            <BrandHeader>
                {!auth?.authenticated ? (
                    <button
                        type="button"
                        class="v2-status v2-status-bad v2-status-action"
                        title={t(language, 'status.authHint')}
                        onClick={() => void refresh()}
                    >
                        {t(language, 'status.needsRefresh')}
                    </button>
                ) : null}
            </BrandHeader>

            <section class="v2-card">
                <h2>{t(language, 'welcome.title')}</h2>
                <p class="v2-muted">{t(language, 'welcome.description')}</p>
                {message ? <p class="v2-text-warn">{message}</p> : null}
                <div class="v2-actions">
                    <button type="button" class="v2-primary" onClick={() => void openSidePanel()}>
                        {t(language, 'welcome.open')}
                    </button>
                    <button type="button" onClick={() => void openWindow()}>
                        {t(language, 'welcome.openWindow')}
                    </button>
                </div>
            </section>

            <section class="v2-card">
                <div class="v2-settings-row">
                    <div class="v2-settings-copy">
                        <strong class="v2-settings-inline-title">
                            {t(language, 'helper.title')}
                            <InfoTip title={t(language, 'settings.helperMode.info')}>
                                <p class="v2-warning-text">{t(language, 'settings.helperMode.warning')}</p>
                            </InfoTip>
                        </strong>
                        <span class="v2-muted">{t(language, 'helper.description')}</span>
                    </div>
                    <ToggleSwitch
                        checked={helperMode}
                        disabled={!settings}
                        label={t(language, 'helper.enable')}
                        onChange={requestHelperMode}
                    />
                </div>
                <p class="v2-muted">{helperMode ? t(language, 'helper.onHint') : t(language, 'helper.offHint')}</p>
            </section>

            <section class="v2-card">
                <UpdateStatus
                    language={language}
                    result={updateResult}
                    statusError={updateStatusError}
                    checking={updateChecking}
                    onCheck={checkUpdates}
                />
            </section>

            <section class="v2-card">
                <h2>{t(language, 'links.title')}</h2>
                <p class="v2-muted">{t(language, 'links.description')}</p>
                <ul class="v2-link-list">
                    {RELATED_LINKS.map((link) => (
                        <li key={link.key}>
                            <a href={link.href} target="_blank" rel="noreferrer">{t(language, `links.${link.key}`)}</a>
                        </li>
                    ))}
                </ul>
            </section>

            <Modal open={confirmOpen} title={t(language, 'settings.helperMode.confirmTitle')} onClose={() => setConfirmOpen(false)}>
                <div class="v2-helper-warning">
                    <p class="v2-warning-text">{t(language, 'settings.helperMode.warning')}</p>
                    <p class="v2-muted">{t(language, 'settings.helperMode.confirmPrompt')}</p>
                    <p class="v2-confirm-word">{t(language, 'settings.helperMode.confirmWord')}</p>
                    <input
                        class="v2-wide-input"
                        value={confirmText}
                        placeholder={t(language, 'settings.helperMode.confirmPlaceholder')}
                        onInput={(event) => {
                            setConfirmText((event.currentTarget as HTMLInputElement).value);
                            setConfirmError(false);
                        }}
                    />
                    {confirmError ? <p class="v2-text-error">{t(language, 'settings.helperMode.mismatch')}</p> : null}
                    <div class="v2-actions">
                        <button type="button" class="v2-danger" onClick={confirmDisable}>
                            {t(language, 'settings.helperMode.confirmButton')}
                        </button>
                        <button type="button" onClick={() => setConfirmOpen(false)}>
                            {t(language, 'settings.helperMode.cancel')}
                        </button>
                    </div>
                </div>
            </Modal>
        </main>
        </LanguageProvider>
    );
}
