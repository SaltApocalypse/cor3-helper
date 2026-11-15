import type { SettingsV1 } from '../../contracts/storage.js';
import { CONTENT_SETTINGS_KEY, parseContentSettings } from './settings.js';

/**
 * v1 QoL DOM tweaks. These run in the isolated content world against the live
 * game page and react to settings changes without a background round-trip.
 */
const BACKGROUND_SELECTORS = ['#app-background', '#glitch-background', '#video-glitch', '#video-waves'];
const NOTIFICATION_STYLE_ID = 'cor3-helper-notifications-left';
const ANTI_AFK_INTERVAL_MS = 3 * 60 * 1000;

let backgroundObserver: MutationObserver | null = null;
let fogObserver: MutationObserver | null = null;
let antiAfkTimer: number | null = null;
let current: SettingsV1 | null = null;

function removeBackgroundElements(): void {
    for (const selector of BACKGROUND_SELECTORS) {
        document.querySelector(selector)?.remove();
    }
}

function setBackgroundDisabled(disabled: boolean): void {
    backgroundObserver?.disconnect();
    backgroundObserver = null;
    if (!disabled) return;
    removeBackgroundElements();
    backgroundObserver = new MutationObserver(() => removeBackgroundElements());
    backgroundObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function hideNetworkFog(): void {
    for (const video of document.querySelectorAll<HTMLVideoElement>('video')) {
        const src = video.getAttribute('src') ?? '';
        if (src.includes('/video/network-map/fog')) {
            video.style.display = 'none';
            video.pause();
            video.setAttribute('data-cor3-fog-hidden', 'true');
        }
    }
}

function setNetworkFogDisabled(disabled: boolean): void {
    fogObserver?.disconnect();
    fogObserver = null;
    if (disabled) {
        hideNetworkFog();
        fogObserver = new MutationObserver(() => hideNetworkFog());
        fogObserver.observe(document.documentElement, { childList: true, subtree: true });
        return;
    }
    for (const video of document.querySelectorAll<HTMLVideoElement>('[data-cor3-fog-hidden="true"]')) {
        video.style.display = '';
        video.removeAttribute('data-cor3-fog-hidden');
        video.play().catch(() => undefined);
    }
}

function setNotificationsLeft(enabled: boolean): void {
    document.getElementById(NOTIFICATION_STYLE_ID)?.remove();
    if (!enabled) return;
    const style = document.createElement('style');
    style.id = NOTIFICATION_STYLE_ID;
    style.textContent = `
        .Toastify__toast-container--bottom-right {
            left: 16px !important;
            right: auto !important;
            margin-bottom: 35px;
        }
        [data-component-name="NotificationsHistory"] {
            left: 0 !important;
            right: auto !important;
            align-items: flex-start;
        }
        [data-component-name="NotificationsHistory"] > button:first-of-type {
            transform: scaleX(-1);
            display: flex;
        }
        [data-component-name="NotificationsHistory"] .sticker-content {
            color: transparent;
            position: relative;
        }
        [data-component-name="NotificationsHistory"] .sticker-content::before {
            content: "Notifications";
            position: absolute;
            left: 0;
            transform: scaleX(-1);
            color: #FFFFFF;
            white-space: pre;
        }
        [data-component-name="NotificationsHistory"] .go3673730358,
        [data-component-name="NotificationsHistory"] > div:last-child {
            border-top-left-radius: 0px;
            border-top-right-radius: 16px;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function antiAfkClick(): void {
    const target = document.querySelector('div[data-component-name="DesktopWrapperBorder"]');
    if (!(target instanceof HTMLElement)) return;
    const rect = target.getBoundingClientRect();
    const options: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: Math.floor(rect.left + rect.width / 2),
        clientY: Math.floor(rect.top + rect.height / 2),
        view: window,
    };
    target.dispatchEvent(new MouseEvent('mouseenter', options));
    target.dispatchEvent(new MouseEvent('mousemove', options));
    target.dispatchEvent(new MouseEvent('click', options));
    target.dispatchEvent(new MouseEvent('mouseleave', options));
}

function setAntiAfk(enabled: boolean): void {
    if (antiAfkTimer !== null) {
        window.clearInterval(antiAfkTimer);
        antiAfkTimer = null;
    }
    if (!enabled) return;
    antiAfkClick();
    antiAfkTimer = window.setInterval(antiAfkClick, ANTI_AFK_INTERVAL_MS);
}

function apply(settings: SettingsV1): void {
    current = settings;
    setBackgroundDisabled(settings.disableBackground);
    setNetworkFogDisabled(settings.disableNetworkFog);
    setNotificationsLeft(settings.moveNotificationsLeft);
    setAntiAfk(settings.antiAfkEnabled);
}

export async function startQol(): Promise<void> {
    try {
        const stored = await chrome.storage.local.get(CONTENT_SETTINGS_KEY);
        const settings = parseContentSettings(stored[CONTENT_SETTINGS_KEY]);
        if (settings) apply(settings);
    } catch {
        // The content script can outlive an extension reload.
    }
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[CONTENT_SETTINGS_KEY]) return;
        const settings = parseContentSettings(changes[CONTENT_SETTINGS_KEY].newValue);
        if (settings) apply(settings);
    });
    // Re-apply style/background after SPA renders settle.
    window.setTimeout(() => {
        if (current) apply(current);
    }, 1000);
}
