import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DebugLogLine, PopupPortal } from '../../../application/popup/portal.js';
import type { PopupPage } from '../AppShell.js';
import { displayVersion } from '../view-models/version.js';

/**
 * Merged automation debug log (H8 phase 7).
 */

export interface DebugLogsDeps {
    readonly activePage: PopupPage;
    readonly jobRunId: string | null;
    readonly autoFinishRunId: string | null;
}

export interface DebugLogsState {
    readonly debugLogs: readonly DebugLogLine[];
    readonly debugLogsLoading: boolean;
    readonly loadDebugLogs: (silent?: boolean) => Promise<void>;
    readonly refreshDebugLogs: () => void;
    readonly copyDebugLogs: (text: string) => Promise<void>;
    readonly exportDebugLogs: (text: string) => void;
}

export function buildDebugLogStatusLine(
    versionInfo: { readonly version: string; readonly versionName: string; readonly build: string | null },
    lineCount: number,
    runId: string | null,
    refreshed: boolean,
): DebugLogLine {
    const display = displayVersion(versionInfo.versionName, versionInfo.build);
    return {
        at: Date.now(),
        level: 'info',
        scope: 'system',
        message: `COR3 Helper ${display} · logs ${refreshed ? 'refreshed' : 'loaded'} · ${lineCount} line(s)`,
        data: {
            version: versionInfo.version,
            versionName: versionInfo.versionName,
            build: versionInfo.build,
            runId,
            lines: lineCount,
            reason: refreshed ? 'refresh' : 'load',
        },
    };
}

export function useDebugLogs(portal: PopupPortal, deps: DebugLogsDeps): DebugLogsState {
    const { activePage, jobRunId, autoFinishRunId } = deps;
    const [debugLogs, setDebugLogs] = useState<readonly DebugLogLine[]>([]);
    const [debugLogsLoading, setDebugLogsLoading] = useState(false);

    const loadDebugLogs = useCallback(async (silent = false) => {
        if (!silent) setDebugLogsLoading(true);
        const runId = jobRunId ?? autoFinishRunId;
        const [global, run] = await Promise.all([
            portal.debugLogs(300),
            runId ? portal.runDebugLogs(runId, 300) : Promise.resolve(null),
        ]);
        const merged = new Map<string, DebugLogLine>();
        for (const line of global.ok ? global.value : []) {
            merged.set(`${line.at}:${line.level}:${line.scope}:${line.message}`, line);
        }
        if (run?.ok) {
            for (const line of run.value) {
                merged.set(`${line.at}:${line.level}:${line.scope}:${line.message}`, line);
            }
        }
        const sorted = [...merged.values()].sort((left, right) => left.at - right.at).slice(-299);
        const status = buildDebugLogStatusLine(portal.versionInfo(), sorted.length, runId, silent);
        setDebugLogs([status, ...sorted]);
        if (!silent) setDebugLogsLoading(false);
    }, [portal, jobRunId, autoFinishRunId]);

    useEffect(() => {
        if (activePage !== 'developer') return;
        void loadDebugLogs();
    }, [activePage, loadDebugLogs]);

    const refreshDebugLogs = useCallback(() => {
        void loadDebugLogs(true);
    }, [loadDebugLogs]);

    const copyDebugLogs = useCallback(async (text: string) => {
        await portal.copyText(text);
    }, [portal]);

    const exportDebugLogs = useCallback((text: string) => {
        portal.exportText(`cor3-auto-jobs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`, text);
    }, [portal]);

    return { debugLogs, debugLogsLoading, loadDebugLogs, refreshDebugLogs, copyDebugLogs, exportDebugLogs };
}
