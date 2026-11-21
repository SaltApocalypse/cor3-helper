import type { UpdateCheckErrorCode, UpdateCheckResult } from '../../contracts/update-check.js';
import { t, type UiLanguage } from '../i18n.js';

export interface UpdateStatusProps {
    readonly language: UiLanguage;
    readonly result: UpdateCheckResult | null;
    readonly statusError: string | null;
    readonly checking: boolean;
    readonly onCheck: () => void | Promise<void>;
}

const ERROR_KEYS = {
    NETWORK_ERROR: 'settings.about.error.NETWORK_ERROR',
    HTTP_ERROR: 'settings.about.error.HTTP_ERROR',
    TIMEOUT: 'settings.about.error.TIMEOUT',
    JSON_ERROR: 'settings.about.error.JSON_ERROR',
    INVALID_RESPONSE: 'settings.about.error.INVALID_RESPONSE',
    INVALID_VERSION: 'settings.about.error.INVALID_VERSION',
    STORAGE_READ_FAILED: 'settings.about.error.STORAGE_READ_FAILED',
    STORAGE_WRITE_FAILED: 'settings.about.error.STORAGE_WRITE_FAILED',
} as const satisfies Record<UpdateCheckErrorCode, string>;

function formatCheckedAt(language: UiLanguage, checkedAt: number | null | undefined): string {
    if (checkedAt === null || checkedAt === undefined || !Number.isFinite(checkedAt) || checkedAt <= 0) {
        return t(language, 'settings.about.notChecked');
    }
    return new Date(checkedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

function errorMessage(language: UiLanguage, code: UpdateCheckErrorCode | undefined): string {
    const key = code ? ERROR_KEYS[code] : undefined;
    return key ? t(language, key) : t(language, 'settings.about.error.UNKNOWN');
}

function lastSuccessText(
    language: UiLanguage,
    success: NonNullable<UpdateCheckResult['lastSuccess']>,
): string {
    return success.status === 'available'
        ? t(language, 'settings.about.lastSuccessAvailable', {
            version: success.latestVersion,
            time: formatCheckedAt(language, success.checkedAt),
        })
        : t(language, 'settings.about.lastSuccessLatest', {
            time: formatCheckedAt(language, success.checkedAt),
        });
}

export function UpdateStatus({ language, result, statusError, checking, onCheck }: UpdateStatusProps) {
    const currentVersion = result?.currentVersion ?? null;
    const latestVersion = result?.latestVersion ?? null;
    const checkedAt = result?.checkedAt ?? null;
    const lastSuccess = result?.lastSuccess ?? null;
    const releaseUrl = result?.releaseUrl ?? lastSuccess?.releaseUrl ?? null;
    const error = result?.error;
    const failed = result?.status === 'failed' || statusError !== null;
    const detail = error?.message ?? statusError ?? null;
    const state = failed ? 'failed' : result?.status ?? 'idle';
    const historicalSuccess = result?.lastSuccess
        ?? (result && result.status !== 'failed' && result.latestVersion && result.releaseUrl
            ? {
                status: result.status,
                currentVersion: result.currentVersion,
                latestVersion: result.latestVersion,
                releaseUrl: result.releaseUrl,
                checkedAt: result.checkedAt,
                source: 'cache',
            }
            : null);

    return (
        <div class="v2-update-status" data-state={state}>
            <div class="v2-update-head">
                <span class="v2-update-heading">{t(language, 'settings.about.updates')}</span>
                <span class="v2-update-checked">
                    {checkedAt
                        ? t(language, 'settings.about.lastChecked', { time: formatCheckedAt(language, checkedAt) })
                        : t(language, 'settings.about.notChecked')}
                </span>
                <button
                    type="button"
                    class="v2-update-button"
                    disabled={checking}
                    onClick={() => void onCheck()}
                >
                    {checking ? t(language, 'settings.about.checking') : t(language, 'settings.about.check')}
                </button>
            </div>

            <div class="v2-update-results" aria-live="polite">
                {!failed && result?.status === 'available' ? (
                    <div class="v2-update-state v2-update-state--warn">
                        <span class="v2-update-dot" aria-hidden="true" />
                        <div class="v2-update-state-body">
                            <strong>{t(language, 'settings.about.updateAvailable', { version: latestVersion ?? '--' })}</strong>
                            {currentVersion ? (
                                <span class="v2-update-sub">
                                    {t(language, 'settings.about.currentVersion', { version: currentVersion })}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {!failed && result?.status === 'latest' ? (
                    <div class="v2-update-state v2-update-state--ok">
                        <span class="v2-update-dot" aria-hidden="true" />
                        <div class="v2-update-state-body">
                            <strong>{t(language, 'settings.about.upToDate')}</strong>
                            {currentVersion ? (
                                <span class="v2-update-sub">
                                    {t(language, 'settings.about.currentVersion', { version: currentVersion })}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {failed ? (
                    <div class="v2-update-state v2-update-state--error">
                        <span class="v2-update-dot" aria-hidden="true" />
                        <div class="v2-update-state-body">
                            <strong title={detail ?? undefined}>{errorMessage(language, error?.code)}</strong>
                            {historicalSuccess ? (
                                <span class="v2-update-sub">
                                    {lastSuccessText(language, historicalSuccess)}
                                </span>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>

            {releaseUrl ? (
                <div class="v2-update-foot">
                    <a class="v2-update-link" href={releaseUrl} target="_blank" rel="noreferrer">
                        {t(language, 'settings.about.releasePage')}
                    </a>
                </div>
            ) : null}

            {detail ? (
                <details class="v2-update-detail">
                    <summary>{t(language, 'settings.about.details')}</summary>
                    <p>{detail}</p>
                </details>
            ) : null}
        </div>
    );
}
