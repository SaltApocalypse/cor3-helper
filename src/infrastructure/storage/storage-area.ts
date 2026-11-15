export type StorageKey = string | readonly string[];

export interface StorageArea {
    get(keys: StorageKey): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: StorageKey): Promise<void>;
}

export class MemoryStorageArea implements StorageArea {
    private readonly data = new Map<string, unknown>();

    async get(keys: StorageKey): Promise<Record<string, unknown>> {
        const result: Record<string, unknown> = {};
        const list = typeof keys === 'string' ? [keys] : keys;
        for (const key of list) {
            if (this.data.has(key)) result[key] = this.data.get(key);
        }
        return result;
    }

    async set(items: Record<string, unknown>): Promise<void> {
        for (const [key, value] of Object.entries(items)) this.data.set(key, value);
    }

    async remove(keys: StorageKey): Promise<void> {
        const list = typeof keys === 'string' ? [keys] : keys;
        for (const key of list) this.data.delete(key);
    }
}

export class ChromeStorageArea implements StorageArea {
    constructor(private readonly area: chrome.storage.StorageArea) {}

    get(keys: StorageKey): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            this.area.get(keys as string | string[], (items) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(items);
            });
        });
    }

    set(items: Record<string, unknown>): Promise<void> {
        return new Promise((resolve, reject) => {
            this.area.set(items, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }

    remove(keys: StorageKey): Promise<void> {
        return new Promise((resolve, reject) => {
            this.area.remove(keys as string | string[], () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve();
            });
        });
    }
}
