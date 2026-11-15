import { describe, expect, it } from 'vitest';
import { detectBrowserLanguage, t } from './i18n.js';

describe('UI language', () => {
    it('detects Chinese from the browser language list', () => {
        expect(detectBrowserLanguage(['zh-CN', 'en-US'])).toBe('zh');
        expect(detectBrowserLanguage(['fr-FR', 'zh-Hant'])).toBe('zh');
    });

    it('falls back to English for unsupported languages', () => {
        expect(detectBrowserLanguage(['en-GB'])).toBe('en');
        expect(detectBrowserLanguage(['fr-FR'])).toBe('en');
        expect(detectBrowserLanguage([])).toBe('en');
    });

    it('translates the helper-mode warning and confirmation word per language', () => {
        expect(t('en', 'settings.helperMode.confirmWord')).toBe('I understand');
        expect(t('zh', 'settings.helperMode.confirmWord')).toBe('我已知晓');
        expect(t('zh', 'settings.helperMode.warning')).toContain('第三方工具');
        expect(t('en', 'settings.helperMode.warning')).toContain('third-party tool');
    });

    it('interpolates variables', () => {
        expect(t('en', 'developer.queueWaiting', { count: 3 })).toBe('3 waiting');
        expect(t('zh', 'settings.data.importFailed', { message: 'bad json' })).toBe('导入失败：bad json');
    });
});
