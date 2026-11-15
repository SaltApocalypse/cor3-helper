import { render } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { settingsV1Schema } from '../../contracts/storage.js';
import { useT } from '../../ui/i18n-context.js';
import { LanguageProvider } from '../../ui/i18n-context.js';

interface ExportBundle {
    readonly exportedAt?: string;
    readonly diagnostics?: unknown;
    readonly logs?: readonly { at: number; level: string; scope: string; message: string; data?: unknown }[];
    readonly bridgeLogs?: readonly { at: number; ok: boolean; type: string; source: string; target: string; durationMs: number; code: string | null; payload?: string }[];
    readonly wsLogs?: readonly { at: number; direction: string; event: string; action: string; text: string; socketUrl?: string }[];
}

type Category = 'logs' | 'bridge' | 'ws';

function LogViewer() {
    const tr = useT();
    const [bundle, setBundle] = useState<ExportBundle | null>(null);
    const [error, setError] = useState('');
    const [category, setCategory] = useState<Category>('logs');
    const [filter, setFilter] = useState('');

    const importFile = async (file: File | null) => {
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text) as ExportBundle;
            if (!parsed || typeof parsed !== 'object') throw new Error('Invalid JSON');
            setBundle(parsed);
            setError('');
        } catch (err) {
            setBundle(null);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const needle = filter.trim().toLowerCase();
    const logs = useMemo(() => (bundle?.logs ?? []).filter((entry) =>
        !needle || `${entry.level} ${entry.scope} ${entry.message}`.toLowerCase().includes(needle)), [bundle, needle]);
    const bridge = useMemo(() => (bundle?.bridgeLogs ?? []).filter((entry) =>
        !needle || `${entry.type} ${entry.source} ${entry.target} ${entry.code ?? ''}`.toLowerCase().includes(needle)), [bundle, needle]);
    const ws = useMemo(() => (bundle?.wsLogs ?? []).filter((entry) =>
        !needle || `${entry.direction} ${entry.event} ${entry.action} ${entry.text}`.toLowerCase().includes(needle)), [bundle, needle]);

    return (
        <main class="devtools-shell">
            <header class="devtools-header">
                <div>
                    <p class="devtools-eyebrow">COR3 Helper · SaltA Fork</p>
                    <h1>{tr('Offline log viewer')}</h1>
                </div>
                <label class="devtools-link-button">
                    {tr('Import JSON')}
                    <input
                        type="file"
                        accept="application/json,.json"
                        style="display:none"
                        onChange={(event) => {
                            const input = event.currentTarget as HTMLInputElement;
                            const file = input.files?.[0] ?? null;
                            input.value = '';
                            void importFile(file);
                        }}
                    />
                </label>
            </header>
            {error ? <p class="devtools-status devtools-log-error">{error}</p> : null}
            <p class="devtools-status">
                {bundle
                    ? `Imported ${bundle.exportedAt ?? 'unknown time'} · ${bundle.logs?.length ?? 0} logs · ${bundle.bridgeLogs?.length ?? 0} bridge · ${bundle.wsLogs?.length ?? 0} WS`
                    : tr('Choose a DevTools JSON export to inspect it offline.')}
            </p>
            <div class="devtools-filters">
                <select value={category} onInput={(event) => setCategory((event.currentTarget as HTMLSelectElement).value as Category)}>
                    <option value="logs">{tr('Logs')}</option>
                    <option value="bridge">{tr('Bridge requests')}</option>
                    <option value="ws">{tr('WebSocket frames')}</option>
                </select>
                <input placeholder={tr('Filter')} value={filter} onInput={(event) => setFilter((event.currentTarget as HTMLInputElement).value)} />
            </div>
            {category === 'logs' ? (
                <ol class="devtools-log-list">
                    {logs.slice().reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} class={`devtools-log-${entry.level}`}>
                            <span>{new Date(entry.at).toLocaleTimeString()}</span>
                            <strong>{entry.level}</strong>
                            <span>{entry.scope}</span>
                            <span>{entry.message}</span>
                        </li>
                    ))}
                </ol>
            ) : null}
            {category === 'bridge' ? (
                <ol class="devtools-log-list">
                    {bridge.slice().reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} class={entry.ok ? 'devtools-bridge-ok' : 'devtools-bridge-error'}>
                            <span>{new Date(entry.at).toLocaleTimeString()}</span>
                            <strong>{entry.ok ? 'ok' : 'err'}</strong>
                            <span>{entry.type}</span>
                            <span>{entry.source} → {entry.target} · {entry.durationMs}ms{entry.code ? ` · ${entry.code}` : ''}</span>
                        </li>
                    ))}
                </ol>
            ) : null}
            {category === 'ws' ? (
                <ol class="devtools-log-list">
                    {ws.slice().reverse().map((entry, index) => (
                        <li key={`${entry.at}-${index}`} class={entry.direction === 'in' ? 'devtools-ws-in' : 'devtools-ws-out'}>
                            <span>{new Date(entry.at).toLocaleTimeString()}</span>
                            <strong>{entry.direction}</strong>
                            <span>{entry.event}/{entry.action}</span>
                            <span title={entry.text}>{entry.text.slice(0, 240)}</span>
                        </li>
                    ))}
                </ol>
            ) : null}
            {bundle?.diagnostics ? (
                <section class="devtools-json">
                    <h2>{tr('Diagnostics')}</h2>
                    <pre>{JSON.stringify(bundle.diagnostics, null, 2)}</pre>
                </section>
            ) : null}
        </main>
    );
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
async function bootstrap(): Promise<void> {
    let language: 'en' | 'zh' = 'en';
    try {
        const stored = await chrome.storage.local.get('v2.settings');
        const envelope = stored['v2.settings'] as { data?: unknown } | undefined;
        const parsed = settingsV1Schema.safeParse(envelope?.data);
        if (parsed.success) language = parsed.data.uiLanguage;
    } catch {
        // Default to English when storage is unavailable.
    }
    render(<LanguageProvider language={language}><LogViewer /></LanguageProvider>, root as HTMLElement);
}
void bootstrap();
