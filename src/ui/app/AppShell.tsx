import type { ComponentChildren } from 'preact';
import { BrandHeader } from '../components/BrandHeader.js';
import { t, type UiLanguage } from '../i18n.js';

export type PopupPage = 'overview' | 'progress' | 'automation' | 'game' | 'settings' | 'developer';
export interface AppShellProps {
    readonly language: UiLanguage;
    readonly ping: string;
    readonly authenticated: boolean;
    readonly hasEndpoint: boolean;
    readonly helperMode: boolean;
    readonly activePage: PopupPage;
    readonly developerMode: boolean;
    readonly windowMode?: boolean;
    readonly popupMode?: boolean;
    readonly onOpenSidePanel?: (() => void) | undefined;
    readonly onOpenWindow?: (() => void) | undefined;
    readonly onPageChange: (page: PopupPage) => void;
    readonly children: ComponentChildren;
}

export function AppShell({
    language,
    ping,
    authenticated,
    hasEndpoint,
    helperMode,
    activePage,
    developerMode,
    windowMode = false,
    popupMode = false,
    onOpenSidePanel,
    onOpenWindow,
    onPageChange,
    children,
}: AppShellProps) {
    const pages: readonly (readonly [PopupPage, string])[] = [
        ['overview', t(language, 'nav.overview')],
        ['progress', t(language, 'nav.progress')],
        ...(helperMode ? [] : [['automation', t(language, 'nav.automation')] as const]),
        ['game', t(language, 'nav.game')],
        ['settings', t(language, 'nav.settings')],
        ...(developerMode ? [['developer', t(language, 'nav.developer')] as const] : []),
    ];
    return (
        <main class={`v2-shell${windowMode ? ' v2-window-shell' : ''}${popupMode ? ' v2-popup-shell' : ''}`}>
            <BrandHeader>
                <span class={`v2-status v2-status-${ping === 'ok' ? 'ok' : ping === 'error' ? 'error' : ''}`} title={t(language, 'status.pingHint')}>
                    {ping === 'ok' ? t(language, 'status.ok') : ping === 'error' ? t(language, 'status.offline') : '…'}
                </span>
                <span class={`v2-status ${authenticated ? 'v2-status-ok' : 'v2-status-bad'}`} title={t(language, 'status.authHint')}>
                    {authenticated ? t(language, 'status.auth') : t(language, 'status.needsRefresh')}
                </span>
                <span class={`v2-status ${hasEndpoint ? 'v2-status-ok' : 'v2-status-muted'}`} title={t(language, 'status.endpointHint')}>
                    {hasEndpoint ? t(language, 'status.endpoint') : t(language, 'status.noEndpoint')}
                </span>
                {onOpenSidePanel ? (
                    <button
                        type="button"
                        class="v2-header-action"
                        title={t(language, 'header.openSidePanel')}
                        aria-label={t(language, 'header.openSidePanel')}
                        onClick={onOpenSidePanel}
                    >
                        ▣
                    </button>
                ) : null}
                {onOpenWindow ? (
                    <button
                        type="button"
                        class="v2-header-action"
                        title={t(language, 'header.openWindow')}
                        aria-label={t(language, 'header.openWindow')}
                        onClick={onOpenWindow}
                    >
                        ⧉
                    </button>
                ) : null}
            </BrandHeader>

            <nav class="v2-top-nav">
                {pages.map(([page, label]) => (
                    <button key={page} type="button" class={activePage === page ? 'active' : ''} onClick={() => onPageChange(page)}>{label}</button>
                ))}
            </nav>

            {children}
        </main>
    );
}
