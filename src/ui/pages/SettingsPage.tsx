import { useRef, useState } from 'preact/hooks';
import type { AuthStatus, SettingsV1 } from '../../contracts/storage.js';
import type { UpdateCheckView } from '../../application/popup/portal.js';
import { GameSection } from '../components/GameSection.js';
import { InfoTip } from '../components/InfoTip.js';
import { Modal } from '../components/Modal.js';
import { ToggleSwitch } from '../components/ToggleSwitch.js';
import { FORK_ISSUES_URL, FORK_RELEASES_URL, FORK_REPO_URL, UPSTREAM_REPO_URL } from '../app/fork-info.js';
import { t, type UiLanguage } from '../i18n.js';
import { displayVersion } from '../app/view-models/version.js';

export interface SettingsPageProps {
    readonly language: UiLanguage;
    readonly versionName: string | null;
    readonly versionBuild: string | null;
    readonly settings: SettingsV1 | null;
    readonly auth: AuthStatus | null;
    readonly hasEndpoint: boolean;
    readonly snapshotAgeMs: number | null;
    readonly gameTabReady: boolean;
    readonly panelOpen: Readonly<Record<string, boolean>>;
    readonly onPanelOpenChange: (key: string, open: boolean) => void;
    readonly onChangeLanguage: (language: UiLanguage) => void | Promise<void>;
    readonly onChangeHelperMode: (enabled: boolean) => void | Promise<void>;
    readonly onChangeDeveloperMode: (enabled: boolean) => void | Promise<void>;
    readonly onChangeQol: (key: 'disableNetworkFog' | 'disableBackground' | 'moveNotificationsLeft' | 'antiAfkEnabled', enabled: boolean) => void | Promise<void>;
    readonly onExportSettings: () => Promise<string | null>;
    readonly onImportSettings: (json: string) => Promise<string | null>;
    readonly onResetSettings: () => Promise<string | null>;
    readonly onOpenDeveloper: () => void;
    readonly updateInfo: UpdateCheckView | null;
    readonly updateError: string | null;
    readonly updateChecking: boolean;
    readonly onCheckUpdates: () => void | Promise<void>;
}

function formatAge(language: UiLanguage, ageMs: number | null): string {
    if (ageMs === null) return t(language, 'settings.session.snapshotMissing');
    const seconds = Math.max(0, Math.round(ageMs / 1000));
    const value = seconds < 60
        ? `${seconds}s`
        : seconds < 3600
            ? `${Math.round(seconds / 60)}m`
            : `${Math.round(seconds / 3600)}h`;
    return t(language, 'settings.session.snapshotFresh', { age: value });
}

export function SettingsPage({
    language,
    versionName,
    versionBuild,
    settings,
    auth,
    hasEndpoint,
    snapshotAgeMs,
    gameTabReady,
    panelOpen,
    onPanelOpenChange,
    onChangeLanguage,
    onChangeHelperMode,
    onChangeDeveloperMode,
    onChangeQol,
    onExportSettings,
    onImportSettings,
    onResetSettings,
    onOpenDeveloper,
    updateInfo,
    updateError,
    updateChecking,
    onCheckUpdates,
}: SettingsPageProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [confirmError, setConfirmError] = useState(false);
    const [dataStatus, setDataStatus] = useState<string | null>(null);
    const [dataBusy, setDataBusy] = useState(false);
    const [resetArmed, setResetArmed] = useState(false);
    const fileInput = useRef<HTMLInputElement | null>(null);

    const helperMode = settings?.helperMode ?? false;
    const consentGiven = settings?.helperModeConsent ?? false;

    const requestHelperMode = (enabled: boolean) => {
        if (enabled) {
            void onChangeHelperMode(true);
            return;
        }
        if (consentGiven) {
            void onChangeHelperMode(false);
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
        void onChangeHelperMode(false);
    };

    const runDataAction = async (action: 'export' | 'import' | 'reset', payload?: string) => {
        setDataBusy(true);
        setDataStatus(t(language, 'settings.data.busy'));
        try {
            const error = action === 'export'
                ? await onExportSettings()
                : action === 'import'
                    ? await onImportSettings(payload ?? '')
                    : await onResetSettings();
            setDataStatus(error ?? (action === 'export'
                ? t(language, 'settings.data.exported')
                : action === 'import'
                    ? t(language, 'settings.data.imported')
                    : t(language, 'settings.data.resetDone')));
        } finally {
            setDataBusy(false);
        }
    };

    const pickImport = () => {
        fileInput.current?.click();
    };

    const readImport = async (file: File | null) => {
        if (!file) return;
        setDataBusy(true);
        setDataStatus(t(language, 'settings.data.busy'));
        try {
            const text = await file.text();
            const error = await onImportSettings(text);
            setDataStatus(error
                ? t(language, 'settings.data.importFailed', { message: error })
                : t(language, 'settings.data.imported'));
        } catch (error) {
            setDataStatus(t(language, 'settings.data.importFailed', {
                message: error instanceof Error ? error.message : String(error),
            }));
        } finally {
            setDataBusy(false);
        }
    };

    return (
        <>
            <GameSection
                title={t(language, 'settings.basic.title')}
                description={t(language, 'settings.basic.description')}
                expanded={panelOpen['settings.basic'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('settings.basic', open)}
            >
                <div class="v2-settings-row">
                    <div class="v2-settings-copy">
                        <strong>{t(language, 'settings.language')}</strong>
                        <span class="v2-muted">{t(language, 'settings.language.description')}</span>
                    </div>
                    <select
                        class="v2-settings-select"
                        value={settings?.uiLanguage ?? language}
                        disabled={!settings}
                        onChange={(event) => void onChangeLanguage((event.currentTarget as HTMLSelectElement).value as UiLanguage)}
                    >
                        <option value="en">English</option>
                        <option value="zh">简体中文</option>
                    </select>
                </div>

                <div class="v2-divider" />

                <div class="v2-settings-row">
                    <div class="v2-settings-copy">
                        <strong class="v2-settings-inline-title">
                            {t(language, 'settings.helperMode')}
                            <InfoTip title={t(language, 'settings.helperMode.info')}>
                                <p class="v2-warning-text">{t(language, 'settings.helperMode.warning')}</p>
                            </InfoTip>
                        </strong>
                        <span class="v2-muted">{t(language, 'settings.helperMode.description')}</span>
                    </div>
                    <ToggleSwitch
                        checked={helperMode}
                        disabled={!settings}
                        label={t(language, 'settings.helperMode')}
                        onChange={(next) => requestHelperMode(next)}
                    />
                </div>

                <div class="v2-settings-row">
                    <div class="v2-settings-copy">
                        <strong>{t(language, 'settings.developerMode')}</strong>
                        <span class="v2-muted">{t(language, 'settings.developerMode.description')}</span>
                    </div>
                    <ToggleSwitch
                        checked={settings?.developerMode ?? false}
                        disabled={!settings}
                        label={t(language, 'settings.developerMode')}
                        onChange={(next) => void onChangeDeveloperMode(next)}
                    />
                </div>

                <div class="v2-divider" />

                <div class="v2-settings-block">
                    <strong>{t(language, 'settings.data.title')}</strong>
                    <p class="v2-muted">{t(language, 'settings.data.description')}</p>
                    <div class="v2-actions">
                        <button type="button" disabled={dataBusy || !settings} onClick={() => void runDataAction('export')}>
                            {t(language, 'settings.data.export')}
                        </button>
                        <button type="button" disabled={dataBusy || !settings} onClick={pickImport}>
                            {t(language, 'settings.data.import')}
                        </button>
                        <button
                            type="button"
                            class={resetArmed ? 'v2-danger' : ''}
                            disabled={dataBusy || !settings}
                            onClick={() => {
                                if (!resetArmed) {
                                    setResetArmed(true);
                                    return;
                                }
                                setResetArmed(false);
                                void runDataAction('reset');
                            }}
                        >
                            {resetArmed ? t(language, 'settings.data.resetConfirm') : t(language, 'settings.data.reset')}
                        </button>
                        {settings?.developerMode ? (
                            <button type="button" onClick={onOpenDeveloper}>{t(language, 'nav.developer')}</button>
                        ) : null}
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json"
                        class="v2-hidden-input"
                        onChange={(event) => {
                            const input = event.currentTarget as HTMLInputElement;
                            const file = input.files?.[0] ?? null;
                            input.value = '';
                            void readImport(file);
                        }}
                    />
                    {dataStatus ? <p class="v2-muted">{dataStatus}</p> : null}
                </div>
            </GameSection>

            <GameSection
                title={t(language, 'settings.qol.title')}
                description={t(language, 'settings.qol.description')}
                expanded={panelOpen['settings.qol'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('settings.qol', open)}
            >
                {([
                    ['disableNetworkFog', 'settings.qol.networkFog', 'settings.qol.networkFog.desc'],
                    ['disableBackground', 'settings.qol.background', 'settings.qol.background.desc'],
                    ['moveNotificationsLeft', 'settings.qol.notifications', 'settings.qol.notifications.desc'],
                    ['antiAfkEnabled', 'settings.qol.antiAfk', 'settings.qol.antiAfk.desc'],
                ] as const).map(([key, label, description]) => (
                    <div class="v2-settings-row" key={key}>
                        <div class="v2-settings-copy">
                            <strong>{t(language, label)}</strong>
                            <span class="v2-muted">{t(language, description)}</span>
                        </div>
                        <ToggleSwitch
                            checked={settings?.[key] ?? false}
                            disabled={!settings}
                            label={t(language, label)}
                            onChange={(next) => void onChangeQol(key, next)}
                        />
                    </div>
                ))}
            </GameSection>

            <GameSection
                title={t(language, 'settings.session.title')}
                description={t(language, 'settings.session.description')}
                expanded={panelOpen['settings.session'] ?? true}
                onOpenChange={(open) => onPanelOpenChange('settings.session', open)}
            >
                <div class="v2-session-grid">
                    <div class="v2-session-row">
                        <span>{t(language, 'settings.session.auth')}</span>
                        <strong class={auth?.authenticated ? 'v2-text-ok' : 'v2-text-error'}>
                            {auth?.authenticated ? t(language, 'settings.session.connected') : t(language, 'settings.session.needsRefresh')}
                        </strong>
                    </div>
                    {!auth?.authenticated ? (
                        <p class="v2-muted">{t(language, 'settings.session.refreshHint')}</p>
                    ) : null}
                    <div class="v2-session-row">
                        <span>{t(language, 'settings.session.endpoint')}</span>
                        <strong class={hasEndpoint ? 'v2-text-ok' : 'v2-text-warn'}>
                            {hasEndpoint ? t(language, 'settings.session.endpointAvailable') : t(language, 'settings.session.endpointMissing')}
                        </strong>
                    </div>
                    <div class="v2-session-row">
                        <span>{t(language, 'settings.session.snapshot')}</span>
                        <strong>{formatAge(language, snapshotAgeMs)}</strong>
                    </div>
                    <div class="v2-session-row">
                        <span>{t(language, 'settings.session.readiness')}</span>
                        <strong class={gameTabReady ? 'v2-text-ok' : 'v2-text-warn'}>
                            {gameTabReady ? t(language, 'settings.session.readinessReady') : t(language, 'settings.session.readinessMissing')}
                        </strong>
                    </div>
                </div>
            </GameSection>

            <footer class="v2-about">
                <div class="v2-about-line">
                    <span>COR3 Helper</span>
                    <span class="v2-muted">{displayVersion(versionName, versionBuild)}</span>
                </div>
                <div class="v2-about-update">
                    <button type="button" disabled={updateChecking} onClick={() => void onCheckUpdates()}>
                        {updateChecking ? t(language, 'settings.about.checking') : t(language, 'settings.about.check')}
                    </button>
                    {updateError ? (
                        <span class="v2-text-error" title={updateError}>
                            {t(language, 'settings.about.checkFailed')}
                            <a href={FORK_RELEASES_URL} target="_blank" rel="noreferrer">{t(language, 'settings.about.checkManually')}</a>
                        </span>
                    ) : updateInfo ? (
                        updateInfo.updateAvailable ? (
                            <span class="v2-text-warn">
                                {t(language, 'settings.about.updateAvailable', { version: updateInfo.latest })}
                                {' · '}
                                <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer">{t(language, 'settings.about.download')}</a>
                            </span>
                        ) : (
                            <span class="v2-text-ok">{t(language, 'settings.about.upToDate')}</span>
                        )
                    ) : null}
                </div>
                <div class="v2-about-line">
                    <span>{t(language, 'settings.about.fork')}</span>
                    <strong>SaltA Fork</strong>
                </div>
                <p class="v2-muted">{t(language, 'settings.about.upstream')}</p>
                <div class="v2-about-links">
                    <a href={FORK_REPO_URL} target="_blank" rel="noreferrer">Fork</a>
                    <a href={FORK_RELEASES_URL} target="_blank" rel="noreferrer">{t(language, 'settings.about.releases')}</a>
                    <a href={FORK_ISSUES_URL} target="_blank" rel="noreferrer">Issues</a>
                    <a href={UPSTREAM_REPO_URL} target="_blank" rel="noreferrer">Upstream</a>
                </div>
            </footer>

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
        </>
    );
}
