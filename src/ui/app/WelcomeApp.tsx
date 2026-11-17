import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PopupPortal } from '../../application/popup/portal.js';
import type { AuthStatus, SettingsV1 } from '../../contracts/storage.js';
import { BrandHeader } from '../components/BrandHeader.js';
import { InfoTip } from '../components/InfoTip.js';
import { Modal } from '../components/Modal.js';
import { ToggleSwitch } from '../components/ToggleSwitch.js';
import { RELATED_LINKS } from './fork-info.js';
import { detectBrowserLanguage, t, type UiLanguage } from '../i18n.js';
import { LanguageProvider } from '../i18n-context.js';

export interface WelcomeAppProps {
    readonly portal: PopupPortal;
}

type PingState = 'idle' | 'checking' | 'ok' | 'error';

/**
 * Small launcher shown from the browser toolbar. The full workspace can be
 * opened in this popup, the side panel, or a detached window.
 */
export function WelcomeApp({ portal }: WelcomeAppProps) {
    const [ping, setPing] = useState<PingState>('idle');
    const [auth, setAuth] = useState<AuthStatus | null>(null);
    const [settings, setSettings] = useState<SettingsV1 | null>(null);
    const [hasEndpoint, setHasEndpoint] = useState(false);
    const [message, setMessage] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [confirmError, setConfirmError] = useState(false);
    const languageInitStarted = useRef(false);
    const language: UiLanguage = settings?.uiLanguage ?? 'en';
    const helperMode = settings?.helperMode ?? false;

    const refresh = useCallback(async () => {
        setPing('checking');
        const [pingResult, authResult, settingsResult] = await Promise.all([
            portal.ping(),
            portal.authStatus(),
            portal.getSettings(),
        ]);
        setPing(pingResult.ok ? 'ok' : 'error');
        if (authResult.ok) setAuth(authResult.value);
        if (settingsResult.ok) setSettings(settingsResult.value);
        void portal.networkSummary().then((networkResult) => {
            if (networkResult.ok) setHasEndpoint(Boolean(networkResult.value.endpoint));
        });
    }, [portal]);

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

    const openInPopup = useCallback(async () => {
        const opened = await portal.openInPopup();
        if (!opened) setMessage(t(language, 'welcome.openInPopupFailed'));
    }, [portal, language]);

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
                <span class={`v2-status v2-status-${ping === 'ok' ? 'ok' : ping === 'error' ? 'error' : ''}`} title={t(language, 'status.pingHint')}>
                    {ping === 'ok' ? t(language, 'status.ok') : ping === 'error' ? t(language, 'status.offline') : '…'}
                </span>
                <span class={`v2-status ${auth?.authenticated ? 'v2-status-ok' : 'v2-status-bad'}`} title={t(language, 'status.authHint')}>
                    {auth?.authenticated ? t(language, 'status.auth') : t(language, 'status.needsRefresh')}
                </span>
                <span class={`v2-status ${hasEndpoint ? 'v2-status-ok' : 'v2-status-muted'}`} title={t(language, 'status.endpointHint')}>
                    {hasEndpoint ? t(language, 'status.endpoint') : t(language, 'status.noEndpoint')}
                </span>
            </BrandHeader>

            <section class="v2-card">
                <h2>{t(language, 'welcome.title')}</h2>
                <p class="v2-muted">{t(language, 'welcome.description')}</p>
                {message ? <p class="v2-text-warn">{message}</p> : null}
                <div class="v2-actions">
                    <button type="button" class="v2-primary" onClick={() => void openInPopup()}>
                        {t(language, 'welcome.openInPopup')}
                    </button>
                    <button type="button" onClick={() => void openSidePanel()}>
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
