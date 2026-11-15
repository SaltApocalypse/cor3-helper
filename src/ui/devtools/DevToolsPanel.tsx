import { useCallback, useEffect, useState } from 'preact/hooks';
import type { DevToolsPortal, DevToolsStorageInspection } from '../../application/devtools/portal.js';
import { useT } from '../i18n-context.js';
import { RefreshButton } from '../components/RefreshButton.js';

interface DevToolsPanelProps {
    readonly portal: DevToolsPortal;
}

export function DevToolsPanel({ portal }: DevToolsPanelProps) {
    const tr = useT();
    const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);
    const [status, setStatus] = useState('Connecting to background...');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [logs, setLogs] = useState<readonly { at: number; level: string; scope: string; message: string; data?: unknown }[]>([]);
    const [wsLogs, setWsLogs] = useState<readonly { at: number; direction: 'in' | 'out'; event: string; action: string; text: string; socketUrl?: string | undefined }[]>([]);
    const [bridgeLogs, setBridgeLogs] = useState<readonly { at: number; id: string; source: string; target: string; type: string; ok: boolean; code: string | null; durationMs: number; payload: string }[]>([]);
    const [bridgeFilter, setBridgeFilter] = useState('');
    const [storageInfo, setStorageInfo] = useState<{ databases: string[]; localStorageKeys: string[]; error: string | null } | null>(null);
    const [logFilter, setLogFilter] = useState('');
    const [logLevel, setLogLevel] = useState('all');
    const [wsFilter, setWsFilter] = useState('');
    const [wsDirection, setWsDirection] = useState<'all' | 'in' | 'out'>('all');
    const [wsSendText, setWsSendText] = useState('');
    const [actionStatus, setActionStatus] = useState('');

    const refresh = useCallback(async () => {
        try {
            const snapshot = await portal.load();
            setDiagnostics(snapshot.diagnostics);
            setLogs(snapshot.logs);
            setBridgeLogs(snapshot.bridgeLogs);
            setWsLogs(snapshot.wsLogs);
            setStatus(`Updated ${new Date().toLocaleTimeString()}`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
        }
    }, [portal]);

    const snapshot = useCallback(() => ({
        exportedAt: new Date().toISOString(),
        diagnostics,
        logs,
        bridgeLogs,
        wsLogs,
    }), [diagnostics, logs, bridgeLogs, wsLogs]);

    const exportJson = () => {
        portal.download(`cor3-helper-devtools-${Date.now()}.json`, JSON.stringify(snapshot(), null, 2), 'application/json');
        setActionStatus('Exported JSON');
    };

    const exportMarkdown = () => {
        const lines = ['# COR3 Helper DevTools export', '', `Exported: ${new Date().toISOString()}`, '', '## Diagnostics', '```json', JSON.stringify(diagnostics, null, 2), '```', '', '## Recent logs', '| Time | Level | Scope | Message |', '|---|---|---|---|'];
        for (const entry of logs) lines.push(`| ${new Date(entry.at).toLocaleTimeString()} | ${entry.level} | ${entry.scope} | ${entry.message.replace(/\|/g, '\\|')} |`);
        lines.push('', '## Bridge requests', '| Time | OK | Type | Source → Target | Duration | Code |', '|---|---|---|---|---|---|');
        for (const entry of bridgeLogs) lines.push(`| ${new Date(entry.at).toLocaleTimeString()} | ${entry.ok ? 'ok' : 'err'} | ${entry.type} | ${entry.source} → ${entry.target} | ${entry.durationMs}ms | ${entry.code ?? ''} |`);
        lines.push('', '## WebSocket frames', '| Time | Dir | Event/Action | Text |', '|---|---|---|---|');
        for (const frame of wsLogs) lines.push(`| ${new Date(frame.at).toLocaleTimeString()} | ${frame.direction} | ${frame.event}/${frame.action} | ${frame.text.replace(/\|/g, '\\|').slice(0, 500)} |`);
        portal.download(`cor3-helper-devtools-${Date.now()}.md`, lines.join('\n'), 'text/markdown');
        setActionStatus('Exported Markdown');
    };

    const clearCategory = useCallback(async (category: 'logs' | 'bridge' | 'ws') => {
        try {
            await portal.clear(category);
            setActionStatus(`Cleared ${category}`);
            await refresh();
        } catch (error) {
            setActionStatus(error instanceof Error ? error.message : String(error));
        }
    }, [portal, refresh]);

    const sendWs = useCallback(async () => {
        const text = wsSendText.trim();
        if (!text) return;
        try {
            await portal.sendWs(text);
            setActionStatus('WebSocket frame sent');
        } catch (error) {
            setActionStatus(error instanceof Error ? error.message : String(error));
        }
    }, [portal, wsSendText]);

    const inspectStorage = useCallback(async () => {
        const info: DevToolsStorageInspection = await portal.inspectStorage();
        setStorageInfo({ databases: [...info.databases], localStorageKeys: [...info.localStorageKeys], error: info.error });
    }, [portal]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!autoRefresh) return;
        const timer = setInterval(() => { void refresh(); }, 5000);
        return () => clearInterval(timer);
    }, [autoRefresh, refresh]);

    return (
        <main class="devtools-shell">
            <header class="devtools-header">
                <div>
                    <p class="devtools-eyebrow">cor3-helper 2.0 Dev</p>
                    <h1>{tr('Diagnostics')}</h1>
                </div>
                <div class="devtools-actions">
                    <label><input type="checkbox" checked={autoRefresh} onChange={() => setAutoRefresh((value) => !value)} /> {tr('Auto refresh')}</label>
                    <button type="button" onClick={exportJson}> {tr('Export JSON')}</button>
                    <button type="button" onClick={exportMarkdown}> {tr('Export MD')}</button>
                    <a class="devtools-link-button" href="devtools-log-viewer.html" target="_blank" rel="noreferrer"> {tr('Offline viewer')}</a>
                    <RefreshButton onClick={refresh} />
                </div>
            </header>
            <p class="devtools-status">{status}{actionStatus ? ` · ${actionStatus}` : ''}</p>
            <section class="devtools-grid">
                {diagnostics ? <DiagnosticsGrid data={diagnostics} /> : <p>{tr('Loading...')}</p>}
            </section>
            <section class="devtools-json">
                <h2>{tr('Recent logs')} <button type="button" onClick={() => void clearCategory('logs')}>{tr('Clear')}</button></h2>
                <div class="devtools-filters">
                    <input placeholder={tr('Filter logs')} value={logFilter} onInput={(event) => setLogFilter((event.currentTarget as HTMLInputElement).value)} />
                    <select value={logLevel} onInput={(event) => setLogLevel((event.currentTarget as HTMLSelectElement).value)}>
                        <option value="all">{tr('all levels')}</option>
                        {['debug', 'info', 'warn', 'error'].map((level) => <option key={level} value={level}>{level}</option>)}
                    </select>
                </div>
                <ol class="devtools-log-list">
                    {logs
                        .filter((event) => logLevel === 'all' || event.level === logLevel)
                        .filter((event) => logFilter.length === 0 || `${event.scope} ${event.message}`.toLowerCase().includes(logFilter.toLowerCase()))
                        .slice(-80)
                        .reverse()
                        .map((event, index) => (
                        <li key={`${event.at}-${index}`} class={`devtools-log-${event.level}`}>
                            <span>{new Date(event.at).toLocaleTimeString()}</span>
                            <strong>{event.level}</strong>
                            <span>{event.scope}</span>
                            <span>{event.message}</span>
                        </li>
                    ))}
                </ol>
            </section>
            <section class="devtools-json">
                <h2>{tr('Bridge requests')} <button type="button" onClick={() => void clearCategory('bridge')}>{tr('Clear')}</button></h2>
                <div class="devtools-filters">
                    <input placeholder={tr('Filter bridge type/source/code')} value={bridgeFilter} onInput={(event) => setBridgeFilter((event.currentTarget as HTMLInputElement).value)} />
                </div>
                <ol class="devtools-log-list">
                    {bridgeLogs
                        .filter((entry) => bridgeFilter.length === 0 || `${entry.type} ${entry.source} ${entry.code ?? ''}`.toLowerCase().includes(bridgeFilter.toLowerCase()))
                        .slice(-80)
                        .reverse()
                        .map((entry, index) => (
                            <li key={`${entry.id}-${index}`} class={entry.ok ? 'devtools-bridge-ok' : 'devtools-bridge-error'}>
                                <span>{new Date(entry.at).toLocaleTimeString()}</span>
                                <strong>{entry.ok ? 'ok' : 'err'}</strong>
                                <span>{entry.type}</span>
                                <span>{entry.source} → {entry.target} · {entry.durationMs}ms{entry.code ? ` · ${entry.code}` : ''}</span>
                                {entry.payload ? (
                                    <details><summary>{tr('payload')}</summary><pre>{entry.payload}</pre></details>
                                ) : null}
                            </li>
                        ))}
                </ol>
            </section>
            <section class="devtools-json">
                <h2>{tr('WebSocket frames')} <button type="button" onClick={() => void clearCategory('ws')}>{tr('Clear')}</button></h2>
                <div class="devtools-filters">
                    <input placeholder={tr('Filter event/action/text')} value={wsFilter} onInput={(event) => setWsFilter((event.currentTarget as HTMLInputElement).value)} />
                    <select value={wsDirection} onInput={(event) => setWsDirection((event.currentTarget as HTMLSelectElement).value as 'all' | 'in' | 'out')}>
                        <option value="all">{tr('all directions')}</option>
                        <option value="in">{tr('in')}</option>
                        <option value="out">{tr('out')}</option>
                    </select>
                </div>
                <div class="devtools-filters">
                    <input placeholder={tr('42[...] frame to send')} value={wsSendText} onInput={(event) => setWsSendText((event.currentTarget as HTMLInputElement).value)} />
                    <button type="button" disabled={wsSendText.trim().length === 0} onClick={() => void sendWs()}> {tr('Send WS')}</button>
                </div>
                <ol class="devtools-log-list">
                    {wsLogs
                        .filter((frame) => wsDirection === 'all' || frame.direction === wsDirection)
                        .filter((frame) => wsFilter.length === 0 || `${frame.event} ${frame.action} ${frame.socketUrl ?? ''} ${frame.text}`.toLowerCase().includes(wsFilter.toLowerCase()))
                        .slice(-80)
                        .reverse()
                        .map((frame, index) => (
                        <li key={`${frame.at}-${index}`} class={frame.direction === 'in' ? 'devtools-ws-in' : 'devtools-ws-out'}>
                            <span>{new Date(frame.at).toLocaleTimeString()}</span>
                            <strong>{frame.direction}</strong>
                            <span>{frame.event}/{frame.action}</span>
                            {frame.socketUrl ? <span title={frame.socketUrl}>{frame.socketUrl.replace(/^wss?:\/\//, '').slice(0, 32)}</span> : null}
                            <span title={frame.text}>{frame.text.slice(0, 180)}</span>
                        </li>
                    ))}
                </ol>
            </section>
            <section class="devtools-json">
                <h2>{tr('Inspected page storage')}</h2>
                <div class="devtools-actions">
                    <button type="button" onClick={inspectStorage}> {tr('Inspect IndexedDB / localStorage')}</button>
                </div>
                {storageInfo ? (
                    storageInfo.error ? <p class="devtools-status">{storageInfo.error}</p> : (
                        <div class="devtools-storage">
                            <p><strong>{tr('IndexedDB:')}</strong> {storageInfo.databases.join(', ') || 'none'}</p>
                            <p><strong>{tr('localStorage keys:')}</strong> {storageInfo.localStorageKeys.join(', ') || 'none'}</p>
                        </div>
                    )
                ) : <p class="devtools-status">{tr('Not inspected')}</p>}
            </section>
            <section class="devtools-json">
                <h2>{tr('Raw snapshot')}</h2>
                <pre>{diagnostics ? JSON.stringify(diagnostics, null, 2) : ''}</pre>
            </section>
        </main>
    );
}

function DiagnosticsGrid({ data }: { data: Record<string, unknown> }) {
    const tr = useT();
    const network = data.network as { serverCount?: number; connectionCount?: number; endpoint?: string | null } | null;
    const auth = data.auth as { authenticated?: boolean; source?: string } | undefined;
    const jobs = data.jobs as { queues?: number; running?: number } | undefined;
    return (
        <>
            <article><h2>{tr('Background')}</h2><p>{String(data.version ?? '?')} · {String(data.phase ?? '?')}</p></article>
            <article><h2>{tr('Auth')}</h2><p>{auth?.authenticated ? tr('authenticated') : tr('none')} · {auth?.source ?? '?'}</p></article>
            <article><h2>{tr('Network')}</h2><p>{network?.serverCount ?? '?'} {tr('servers')} · {network?.connectionCount ?? '?'} {tr('edges')}</p><p>{tr('Endpoint')}: {network?.endpoint ?? 'none'}</p></article>
            <article><h2>{tr('Job queues')}</h2><p>{jobs?.queues ?? 0} {tr('tracked')} · {jobs?.running ?? 0} {tr('running')}</p></article>
        </>
    );
}
