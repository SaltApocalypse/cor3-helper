// DOM tweaks — background elements, network fog, notifications

// --- Background Elements Functions ---
export function deleteBackgroundElements() {
    const backgroundElements = [
        '#app-background',
        '#glitch-background',
        '#video-glitch',
        '#video-waves'
    ];

    backgroundElements.forEach(selector => {
        try {
            const element = document.querySelector(selector);
            if (element) {
                element.remove();
                console.log('[COR3 Helper] Deleted background element:', selector);
            }
        } catch (e) {
            // Ignore errors for elements that might not exist
        }
    });
}

// Apply background elements deletion on page load if setting is enabled
chrome.storage.sync.get('disableBackground', (result) => {
    if (result.disableBackground) {
        setTimeout(() => {
            deleteBackgroundElements();
        }, 1000);
    }
});

// --- Network Fog Functions ---
let networkFogObserver = null;

function isNetworkMapVisible() {
    const divs = document.querySelectorAll('div');
    for (const div of divs) {
        if (div.textContent.trim() === 'Network map') return true;
    }
    return false;
}

export function hideNetworkFogVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
        const src = v.getAttribute('src') || '';
        if (src.includes('/video/network-map/fog.mp4') || src.includes('/video/network-map/fog_layer_2.mp4')) {
            v.style.display = 'none';
            v.pause();
            v.setAttribute('data-cor3-fog-hidden', 'true');
        }
    });
}

export function showNetworkFogVideos() {
    const hiddenVideos = document.querySelectorAll('[data-cor3-fog-hidden="true"]');
    hiddenVideos.forEach(v => {
        v.style.display = '';
        v.removeAttribute('data-cor3-fog-hidden');
        v.play().catch(() => {});
    });
}

export function startNetworkFogObserver() {
    if (networkFogObserver) return;
    networkFogObserver = new MutationObserver(() => {
        if (isNetworkMapVisible()) {
            hideNetworkFogVideos();
        }
    });
    networkFogObserver.observe(document.body, { childList: true, subtree: true });
}

export function stopNetworkFogObserver() {
    if (networkFogObserver) {
        networkFogObserver.disconnect();
        networkFogObserver = null;
    }
}

// Apply network fog hiding on page load if setting is enabled
chrome.storage.sync.get('disableNetworkFog', (result) => {
    if (result.disableNetworkFog) {
        setTimeout(() => {
            hideNetworkFogVideos();
            startNetworkFogObserver();
        }, 1000);
    }
});

// --- Move Notifications to Left ---
const COR3_NOTIF_LEFT_STYLE_ID = 'cor3-notifications-left-style';

export function applyNotificationsLeft() {
    if (document.getElementById(COR3_NOTIF_LEFT_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = COR3_NOTIF_LEFT_STYLE_ID;
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
            color: transparent;               /* hide original text */
            position: relative;
        }
        [data-component-name="NotificationsHistory"] .sticker-content::before {
            content: "Notifications";         /* duplicate the word */
            position: absolute;
            left: 0;
            transform: scaleX(-1);
            color: #FFFFFF;   /* re‑apply the original colour */
            white-space: pre;                 /* keep spacing */
        }
        [data-component-name="NotificationsHistory"] .go3673730358,
        [data-component-name="NotificationsHistory"] > div:last-child {
            border-top-left-radius: 0px;
            border-top-right-radius: 16px;
        }
    `;
    (document.head || document.documentElement).appendChild(style);
}

export function removeNotificationsLeft() {
    const el = document.getElementById(COR3_NOTIF_LEFT_STYLE_ID);
    if (el) el.remove();
}

// Apply notifications left on page load if setting is enabled
chrome.storage.sync.get('moveNotificationsLeft', (result) => {
    if (result.moveNotificationsLeft) {
        setTimeout(() => {
            applyNotificationsLeft();
        }, 1000);
    }
});

