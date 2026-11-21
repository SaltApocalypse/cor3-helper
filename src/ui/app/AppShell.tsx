import type { ComponentChildren } from 'preact';
import { BrandHeader } from '../components/BrandHeader.js';
import { t, type UiLanguage } from '../i18n.js';

export type PopupPage = 'overview' | 'progress' | 'automation' | 'game' | 'settings' | 'developer';
export interface AppShellProps {
    readonly language: UiLanguage;
    readonly authenticated: boolean;
    readonly helperMode: boolean;
    readonly activePage: PopupPage;
    readonly developerMode: boolean;
    readonly windowMode?: boolean;
    readonly onOpenWindow?: (() => void) | undefined;
    readonly onRefreshAuth?: (() => void | Promise<void>) | undefined;
    readonly onPageChange: (page: PopupPage) => void;
    readonly children: ComponentChildren;
}

export function AppShell({
    language,
    authenticated,
    helperMode,
    activePage,
    developerMode,
    windowMode = false,
    onOpenWindow,
    onRefreshAuth,
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
        <main class={`v2-shell${windowMode ? ' v2-window-shell' : ''}`}>
            <BrandHeader>
                {!authenticated ? (
                    <button
                        type="button"
                        class="v2-status v2-status-bad v2-status-action"
                        title={t(language, 'status.authHint')}
                        onClick={() => void onRefreshAuth?.()}
                    >
                        {t(language, 'status.needsRefresh')}
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
