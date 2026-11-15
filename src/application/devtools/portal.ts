export interface DevToolsLogLine {
    readonly at: number;
    readonly level: string;
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

export interface DevToolsBridgeLine {
    readonly at: number;
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly type: string;
    readonly ok: boolean;
    readonly code: string | null;
    readonly durationMs: number;
    readonly payload: string;
}

export interface DevToolsWsLine {
    readonly at: number;
    readonly direction: 'in' | 'out';
    readonly event: string;
    readonly action: string;
    readonly text: string;
    readonly socketUrl?: string;
}

export interface DevToolsSnapshot {
    readonly diagnostics: Record<string, unknown>;
    readonly logs: readonly DevToolsLogLine[];
    readonly bridgeLogs: readonly DevToolsBridgeLine[];
    readonly wsLogs: readonly DevToolsWsLine[];
}

export interface DevToolsStorageInspection {
    readonly databases: readonly string[];
    readonly localStorageKeys: readonly string[];
    readonly error: string | null;
}

export type DevToolsClearCategory = 'logs' | 'bridge' | 'ws';
export type DevToolsLanguage = 'en' | 'zh';

export interface DevToolsPortal {
    load(): Promise<DevToolsSnapshot>;
    clear(category: DevToolsClearCategory): Promise<void>;
    sendWs(message: string): Promise<void>;
    inspectStorage(): Promise<DevToolsStorageInspection>;
    download(filename: string, text: string, mimeType: string): void;
    language(): Promise<DevToolsLanguage>;
}
