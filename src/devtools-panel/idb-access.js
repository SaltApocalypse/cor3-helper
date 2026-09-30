// IndexedDB access via chrome.scripting.executeScript
// The DB lives on the cor3.gg origin (written by content script ws-messages.js).
// DevTools panel runs on chrome-extension:// origin and cannot access it directly.
// We use chrome.scripting.executeScript to run queries in the inspected tab's context.

export function getInspectedTabId() {
    return chrome.devtools.inspectedWindow.tabId;
}

async function runInTab(fn, args) {
    const tabId = getInspectedTabId();
    if (!tabId) {
        console.log('[COR3 Panel] No inspected tab ID');
        return null;
    }
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: fn,
            args: args || []
        });
        if (results && results[0]) return results[0].result;
    } catch (e) {
        console.log('[COR3 Panel] executeScript error:', e);
    }
    return null;
}

// Common onupgradeneeded handler (must be inlined in each function since
// these functions are serialized and sent to the inspected tab context)

export async function dbCount() {
    const result = await runInTab(() => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) { db.close(); resolve(0); return; }
                const tx = db.transaction('messages', 'readonly');
                const store = tx.objectStore('messages');
                const countReq = store.count();
                countReq.onsuccess = () => { resolve(countReq.result); db.close(); };
                countReq.onerror = () => { resolve(0); db.close(); };
            };
            req.onerror = () => resolve(0);
        });
    });
    return result || 0;
}

export async function dbGetPage(start, limit) {
    const result = await runInTab((s, l) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) { db.close(); resolve([]); return; }
                const tx = db.transaction('messages', 'readonly');
                const store = tx.objectStore('messages');
                const results = [];
                let skipped = 0;
                const cur = store.openCursor();
                cur.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (!cursor || results.length >= l) { resolve(results); db.close(); return; }
                    if (skipped < s) { skipped++; cursor.continue(); return; }
                    results.push(cursor.value);
                    cursor.continue();
                };
                cur.onerror = () => { resolve(results); db.close(); };
            };
            req.onerror = () => resolve([]);
        });
    }, [start, limit]);
    return result || [];
}

export async function dbGetAfter(isoTimestamp) {
    const result = await runInTab((ts) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) { db.close(); resolve([]); return; }
                const tx = db.transaction('messages', 'readonly');
                const idx = tx.objectStore('messages').index('timestamp');
                const range = IDBKeyRange.lowerBound(ts, true);
                const results = [];
                const cur = idx.openCursor(range);
                cur.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (!cursor) { resolve(results); db.close(); return; }
                    results.push(cursor.value);
                    cursor.continue();
                };
                cur.onerror = () => { resolve(results); db.close(); };
            };
            req.onerror = () => resolve([]);
        });
    }, [isoTimestamp]);
    return result || [];
}

export async function dbClear() {
    await runInTab(() => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) { db.close(); resolve(); return; }
                const tx = db.transaction('messages', 'readwrite');
                tx.objectStore('messages').clear();
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); resolve(); };
            };
            req.onerror = () => resolve();
        });
    });
}

export async function logDbCount(category) {
    const result = await runInTab((cat) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('logs')) { db.close(); resolve(0); return; }
                const tx = db.transaction('logs', 'readonly');
                const idx = tx.objectStore('logs').index('category');
                const countReq = idx.count(IDBKeyRange.only(cat));
                countReq.onsuccess = () => { resolve(countReq.result); db.close(); };
                countReq.onerror = () => { resolve(0); db.close(); };
            };
            req.onerror = () => resolve(0);
        });
    }, [category]);
    return result || 0;
}

export async function logDbGetPage(category, start, limit) {
    const result = await runInTab((cat, s, l) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('logs')) { db.close(); resolve([]); return; }
                const tx = db.transaction('logs', 'readonly');
                const idx = tx.objectStore('logs').index('cat_ts');
                const range = IDBKeyRange.bound([cat, ''], [cat, '\uffff']);
                const results = [];
                let skipped = 0;
                const cur = idx.openCursor(range);
                cur.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (!cursor || results.length >= l) { resolve(results); db.close(); return; }
                    if (skipped < s) { skipped++; cursor.continue(); return; }
                    results.push(cursor.value);
                    cursor.continue();
                };
                cur.onerror = () => { resolve(results); db.close(); };
            };
            req.onerror = () => resolve([]);
        });
    }, [category, start, limit]);
    return result || [];
}

export async function logDbGetAfter(category, isoTs) {
    const result = await runInTab((cat, ts) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('logs')) { db.close(); resolve([]); return; }
                const tx = db.transaction('logs', 'readonly');
                const idx = tx.objectStore('logs').index('cat_ts');
                const range = IDBKeyRange.bound([cat, ts], [cat, '\uffff'], true);
                const results = [];
                const cur = idx.openCursor(range);
                cur.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (!cursor) { resolve(results); db.close(); return; }
                    results.push(cursor.value);
                    cursor.continue();
                };
                cur.onerror = () => { resolve(results); db.close(); };
            };
            req.onerror = () => resolve([]);
        });
    }, [category, isoTs]);
    return result || [];
}

export async function logDbClear(category) {
    await runInTab((cat) => {
        return new Promise((resolve) => {
            const req = indexedDB.open('cor3_ws_db', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('messages')) {
                    const ms = db.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
                    ms.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('logs')) {
                    const ls = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
                    ls.createIndex('timestamp', 'timestamp', { unique: false });
                    ls.createIndex('category', 'category', { unique: false });
                    ls.createIndex('cat_ts', ['category', 'timestamp'], { unique: false });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('logs')) { db.close(); resolve(); return; }
                const tx = db.transaction('logs', 'readwrite');
                const idx = tx.objectStore('logs').index('category');
                const range = IDBKeyRange.only(cat);
                const cr = idx.openCursor(range);
                cr.onsuccess = (ev) => {
                    const cursor = ev.target.result;
                    if (cursor) { cursor.delete(); cursor.continue(); }
                };
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => { db.close(); resolve(); };
            };
            req.onerror = () => resolve();
        });
    }, [category]);
}
