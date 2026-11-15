import { z } from 'zod';
import { settingsV1Schema } from '../../contracts/storage.js';
import type { BridgeClient } from '../bridge/bridge-client.js';
import type {
    DevToolsBridgeLine,
    DevToolsClearCategory,
    DevToolsLogLine,
    DevToolsPortal,
    DevToolsSnapshot,
    DevToolsStorageInspection,
    DevToolsWsLine,
} from '../../application/devtools/portal.js';

const logLineSchema = z.object({
    at: z.number(), level: z.string(), scope: z.string(), message: z.string(), data: z.unknown().optional(),
}).strict();
const bridgeLineSchema = z.object({
    at: z.number(), id: z.string(), source: z.string(), target: z.string(), type: z.string(),
    ok: z.boolean(), code: z.string().nullable(), durationMs: z.number(), payload: z.string(),
}).strict();
const wsLineSchema = z.object({
    at: z.number(), direction: z.enum(['in', 'out']), event: z.string(), action: z.string(), text: z.string(), socketUrl: z.string().optional(),
}).strict();
const snapshotSchema = z.object({
    diagnostics: z.record(z.string(), z.unknown()),
    logs: z.array(logLineSchema),
    bridgeLogs: z.array(bridgeLineSchema),
}).strict();
const wsSchema = z.array(wsLineSchema);

export class ChromeDevToolsPortal implements DevToolsPortal {
    constructor(private readonly client: BridgeClient) {}

    async load(): Promise<DevToolsSnapshot> {
        const snapshot = await this.client.request('devtools.snapshot', {}, snapshotSchema, 20000);
        if (!snapshot.ok) throw new Error(snapshot.error.message);
        const ws = await this.client.request('devtools.wsLogs', {}, wsSchema, 15000);
        return {
            diagnostics: snapshot.value.diagnostics,
            logs: snapshot.value.logs as DevToolsLogLine[],
            bridgeLogs: snapshot.value.bridgeLogs as DevToolsBridgeLine[],
            wsLogs: ws.ok ? ws.value as DevToolsWsLine[] : [],
        };
    }

    async clear(category: DevToolsClearCategory): Promise<void> {
        const command = category === 'logs'
            ? 'devtools.clearLogs'
            : category === 'bridge' ? 'devtools.clearBridgeLogs' : 'devtools.clearWsLogs';
        const response = await this.client.request(command, {}, z.unknown(), 15000);
        if (!response.ok) throw new Error(response.error.message);
    }

    async sendWs(message: string): Promise<void> {
        const response = await this.client.request('devtools.wsSend', { message }, z.unknown(), 10000);
        if (!response.ok) throw new Error(response.error.message);
    }

    inspectStorage(): Promise<DevToolsStorageInspection> {
        const expression = `(async () => {
            const dbs = (indexedDB.databases ? await indexedDB.databases() : []).map((db) => db.name).filter(Boolean);
            return { databases: dbs, localStorageKeys: Object.keys(localStorage).sort() };
        })()`;
        return new Promise((resolve) => {
            chrome.devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
                if (exceptionInfo?.isException) {
                    resolve({ databases: [], localStorageKeys: [], error: String(exceptionInfo.value ?? 'inspection failed') });
                    return;
                }
                const value = result as { databases?: unknown; localStorageKeys?: unknown } | null;
                resolve({
                    databases: Array.isArray(value?.databases) ? value.databases.map(String) : [],
                    localStorageKeys: Array.isArray(value?.localStorageKeys) ? value.localStorageKeys.map(String) : [],
                    error: null,
                });
            });
        });
    }

    download(filename: string, text: string, mimeType: string): void {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async language(): Promise<'en' | 'zh'> {
        try {
            const stored = await chrome.storage.local.get('v2.settings');
            const envelope = stored['v2.settings'] as { data?: unknown } | undefined;
            const parsed = settingsV1Schema.safeParse(envelope?.data);
            return parsed.success ? parsed.data.uiLanguage : 'en';
        } catch {
            return 'en';
        }
    }
}
