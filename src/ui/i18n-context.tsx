import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useMemo } from 'preact/hooks';
import { translate, type UiLanguage } from './i18n.js';

const LanguageContext = createContext<UiLanguage>('en');

export interface LanguageProviderProps {
    readonly language: UiLanguage;
    readonly children: ComponentChildren;
}

export function LanguageProvider({ language, children }: LanguageProviderProps) {
    return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): UiLanguage {
    return useContext(LanguageContext);
}

export type TranslateSource = (source: string, vars?: Readonly<Record<string, string | number>>) => string;

export function useT(): TranslateSource {
    const language = useLanguage();
    return useMemo(
        () => (source: string, vars?: Readonly<Record<string, string | number>>) => translate(language, source, vars),
        [language],
    );
}
