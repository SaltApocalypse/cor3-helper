import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export interface InfoPanelProps {
    readonly title: string;
    readonly meta?: string;
    readonly defaultOpen?: boolean;
    readonly children: ComponentChildren;
}

export function InfoPanel({ title, meta, defaultOpen = false, children }: InfoPanelProps) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <section class="v2-debug-console v2-info-panel">
            <button
                type="button"
                class="v2-debug-toggle"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
            >
                <span>{open ? '▼' : '▶'} {title}</span>
                {meta ? <span class="v2-muted">{meta}</span> : null}
            </button>
            {open ? <div class="v2-info-panel-body">{children}</div> : null}
        </section>
    );
}
