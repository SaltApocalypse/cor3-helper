import type { TabMessagePort } from './chrome-tab-auth-adapter.js';

import { encodeTabRequest, decodeTabResponse } from '../../contracts/tab.js';

export class ChromeTabsMessagePort implements TabMessagePort {
    private preferredTabId: number | null = null;

    setPreferredTabId(tabId: number | null): void {
        this.preferredTabId = tabId;
    }

    getPreferredTabId(): number | null {
        return this.preferredTabId;
    }

    async findCor3Tab(): Promise<number | null> {
        return new Promise((resolve) => {
            chrome.tabs.query({ url: '*://*.cor3.gg/*' }, (tabs) => {
                if (this.preferredTabId !== null && tabs.some((tab) => tab.id === this.preferredTabId)) {
                    resolve(this.preferredTabId);
                    return;
                }
                // Prefer the tab the user is looking at when it is a cor3 page;
                // otherwise fall back to the first cor3 tab like v1 did.
                const active = tabs.find((tab) => tab.active && typeof tab.url === 'string' && /cor3\.gg/.test(tab.url));
                resolve(active?.id ?? tabs[0]?.id ?? null);
            });
        });
    }

    send(tabId: number, message: unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const envelope = encodeTabRequest(message) ?? message;
            chrome.tabs.sendMessage(tabId, envelope, (response: unknown) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(decodeTabResponse(response));
            });
        });
    }

    reload(tabId: number): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.tabs.reload(tabId, {}, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }
}
