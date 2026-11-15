import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n-context.js';

export interface DebugLogLine {
    readonly at: number;
    readonly level: string;
    readonly scope: string;
    readonly message: string;
    readonly data?: unknown;
}

function compactData(data: unknown): string {
    if (data === undefined) return '';
    try {
        const text = JSON.stringify(data);
        if (typeof text !== 'string') return '';
        return text.length > 500 ? `${text.slice(0, 497)}...` : text;
    } catch {
        return '[unserializable]';
    }
}

export interface DebugConsoleProps {
    readonly lines: readonly DebugLogLine[];
    readonly title?: string;
    readonly defaultOpen?: boolean;
    readonly loading?: boolean;
    readonly live?: boolean;
    readonly onOpen?: () => void;
    readonly onRefresh?: () => void;
    readonly onCopy?: (text: string) => void | Promise<void>;
    readonly onExport?: (text: string) => void | Promise<void>;
    /** Render only the log body; the parent card owns the collapse header. */
    readonly embedded?: boolean;
}

export function DebugConsole({
    lines,
    title,
    defaultOpen = false,
    loading = false,
    live = false,
    onOpen,
    onRefresh,
    onCopy,
    onExport,
    embedded = false,
}: DebugConsoleProps) {
    const tr = useT();
    const resolvedTitle = title ?? tr('Debug console');
    const [openState, setOpen] = useState(defaultOpen);
    const open = embedded || openState;
    const [feedback, setFeedback] = useState<'copy' | 'export' | null>(null);
    const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const calledOpen = useRef(false);

    useEffect(() => {
        if (!open || calledOpen.current) return;
        calledOpen.current = true;
        onOpen?.();
    }, [open, onOpen]);

    useEffect(() => {
        if (!open || !live || !onRefresh) return;
        const timer = setInterval(() => onRefresh(), 2000);
        return () => clearInterval(timer);
    }, [open, live, onRefresh]);

    useEffect(() => () => {
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    }, []);

    const showFeedback = (kind: 'copy' | 'export') => {
        setFeedback(kind);
        if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
        feedbackTimer.current = setTimeout(() => setFeedback(null), 1800);
    };

    const text = lines
        .map((line) => {
            const data = compactData(line.data);
            return `${new Date(line.at).toLocaleTimeString()} [${line.level}] ${line.scope}: ${line.message}${data ? ` | ${data}` : ''}`;
        })
        .join('\n');

    const body = (
        <>
            <pre class="v2-debug-output">{loading ? tr('Loading logs...') : text || tr('No log lines.')}</pre>
            <div class="v2-debug-actions">
                <button
                    type="button"
                    class={feedback === 'copy' ? 'v2-debug-success' : ''}
                    disabled={lines.length === 0}
                    onClick={async () => {
                        await onCopy?.(text);
                        showFeedback('copy');
                    }}
                >
                    {feedback === 'copy' ? tr('Copied') : tr('Copy')}
                </button>
                <button
                    type="button"
                    class={feedback === 'export' ? 'v2-debug-success' : ''}
                    disabled={lines.length === 0}
                    onClick={async () => {
                        await onExport?.(text);
                        showFeedback('export');
                    }}
                >
                    {feedback === 'export' ? tr('Exported') : tr('Export')}
                </button>
            </div>
        </>
    );

    if (embedded) return <div class="v2-debug-embedded">{body}</div>;

    return (
        <section class="v2-debug-console">
            <button
                type="button"
                class="v2-debug-toggle"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <span>{open ? '▼' : '▶'} {resolvedTitle}</span>
            </button>
            {open ? body : null}
        </section>
    );
}
