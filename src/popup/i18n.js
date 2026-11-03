// Minimal popup localization.
//
// Scope: language selector + the expedition/drone panels. Static labels can use
// data-i18n-en / data-i18n-zh; dynamic strings call t(en, zh).

let _lang = 'en';
const _listeners = new Set();

export function getUiLang() {
    return _lang;
}

export function t(en, zh) {
    return _lang === 'zh' ? zh : en;
}

export function onLangChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n-en]').forEach((el) => {
        const text = _lang === 'zh' ? el.dataset.i18nZh : el.dataset.i18nEn;
        if (text != null) el.textContent = text;
    });
    document.querySelectorAll('[data-i18n-title-en]').forEach((el) => {
        const text = _lang === 'zh' ? el.dataset.i18nTitleZh : el.dataset.i18nTitleEn;
        if (text != null) el.title = text;
    });
}

function applyLangUi() {
    document.documentElement.lang = _lang === 'zh' ? 'zh-CN' : 'en';
    const btn = document.getElementById('langToggleBtn');
    if (btn) btn.title = t('Language', '语言');
    document.querySelectorAll('#langDropdown .theme-option').forEach((opt) => {
        opt.classList.toggle('active', opt.dataset.lang === _lang);
    });
    applyStaticTranslations();
    _listeners.forEach((fn) => {
        try { fn(_lang); } catch (e) { /* keep other listeners alive */ }
    });
}

async function setLang(lang) {
    _lang = lang === 'zh' ? 'zh' : 'en';
    await chrome.storage.sync.set({ uiLang: _lang });
    applyLangUi();
}

function setupLanguageDropdown() {
    const btn = document.getElementById('langToggleBtn');
    const dropdown = document.getElementById('langDropdown');
    if (!btn || !dropdown) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close the theme dropdown when opening this one.
        const themeDropdown = document.getElementById('themeDropdown');
        if (themeDropdown) themeDropdown.classList.remove('open');
        dropdown.classList.toggle('open');
    });

    dropdown.querySelectorAll('.theme-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.remove('open');
            setLang(opt.dataset.lang);
        });
    });

    document.addEventListener('click', () => dropdown.classList.remove('open'));
}

function init() {
    setupLanguageDropdown();
    chrome.storage.sync.get('uiLang', (data) => {
        _lang = data && data.uiLang === 'zh' ? 'zh' : 'en';
        applyLangUi();
    });
}

init();
